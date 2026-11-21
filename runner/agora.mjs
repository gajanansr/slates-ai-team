// Slates Calls: real voice calls through Agora Conversational AI, speaking with Murf voices.
//
// A call is a private link (no phone line needed). The person opens it, sees "Slates is calling", and accepts.
// Then a small "room" starts on one Agora channel:
//   - Slates (host): a conversational agent that listens to the person and talks back.
//   - Cast (optional, e.g. Claude and Gemini): speak-only agents with their own voices. They never listen;
//     the runner makes them say their findings through Agora's speak API, so the person hears the actual team.
// The page shows the participants with live speaking rings, live captions, and the decision buttons
// (the person can say the answer or tap it). We read the conversation from Agora and return the transcript.
//
// Env: AGORA_APP_ID, AGORA_APP_CERTIFICATE, PUBLIC_BASE_URL, MURF_API_KEY (required)
//      MURF_VOICE (host, default en-US-natalie), CAST_VOICES (JSON, default Claude=en-US-caleb, Gemini=en-IN-aarav)
//      ANTHROPIC_API_KEY (optional: host talks with Claude; otherwise Agora's managed gpt-4.1-mini)
//      AGORA_ASR_LANGUAGE (en-US), CALL_RING_SEC (300), CALL_SPEECH_THRESHOLD (0.7)

import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HOST_UID = "1000";
const PERSON_UID = 1001;
const CAST_UID0 = 2001;
const NOBODY_UID = "9999"; // cast agents "listen" to this uid, which never joins, so they never answer anyone
const API = "https://api.agora.io/api/conversational-ai-agent/v2/projects";
const DEFAULT_CAST_VOICES = { Claude: "en-US-caleb", Gemini: "en-IN-aarav" };

// ---------- pure helpers (tested) ----------

export function agoraMissing(env) {
  return ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "MURF_API_KEY", "PUBLIC_BASE_URL"].filter((k) => !env[k]);
}

export function systemPrompt({ ownerName, name, goal, notes, options, toOwner = false, cast = [] }) {
  if (toOwner) {
    return [
      `You are Slates, ${ownerName}'s own AI assistant, hosting a short call with ${ownerName} because their AI agents need a decision.`,
      cast.length ? `${cast.map((c) => c.name).join(" and ")} ${cast.length > 1 ? "are" : "is"} on the call and will speak first in their own voices. What they say:\n${cast.map((c) => `- ${c.name}: ${c.says}`).join("\n")}` : "",
      `The briefing: ${goal}`,
      options ? `Get one answer from: ${options.join(" / ")}. When they decide, repeat it back exactly as written, like "Okay, ${options[0]}."` : "",
      `Answer questions from the briefing and what the agents said; if you don't know, say the agents will add it to the Slates board.`,
      `One or two short sentences per reply; this is spoken audio, no lists or symbols.`,
      `Once they decide, say the agents are on it, then end with the word "Goodbye".`,
    ].filter(Boolean).join("\n");
  }
  return [
    `You are a friendly, brief AI assistant on a voice call on behalf of ${ownerName}, talking to ${name || "someone"}.`,
    `You already said you are an AI calling for ${ownerName}. If asked, say so again honestly. Never pretend to be human.`,
    `Your goal: ${goal}`,
    options ? `They must pick one of: ${options.join(" / ")}. When they choose, repeat it back exactly as written, like "Great, ${options[0]} it is."` : "",
    notes ? `Facts you may use: ${notes}` : "",
    `Keep every reply to one or two short sentences; this is spoken audio, no lists or symbols.`,
    `Do not agree to pay, sign up or share personal details. If they want something you can't do, say ${ownerName} will follow up.`,
    `When the goal is done or they want to stop, thank them and end with the word "Goodbye".`,
  ].filter(Boolean).join("\n");
}

export function llmConfig(env, system, greeting) {
  const common = { system_messages: [{ role: "system", content: system }], max_history: 20, failure_message: "Sorry, could you say that again?", ...(greeting ? { greeting_message: greeting } : {}) };
  if (env.ANTHROPIC_API_KEY) {
    return {
      ...common, style: "anthropic", url: "https://api.anthropic.com/v1/messages", api_key: env.ANTHROPIC_API_KEY,
      headers: { "anthropic-version": "2023-06-01" }, params: { model: env.CALL_LLM_MODEL || "claude-haiku-5-5", max_tokens: 300 },
    };
  }
  return { ...common, credential_mode: "managed", vendor: "openai", style: "openai", url: "https://api.openai.com/v1/chat/completions", params: { model: env.CALL_LLM_MODEL || "gpt-4.1-mini" } };
}

export function murfTts(env, voiceId) {
  const voice = voiceId || env.MURF_VOICE || "en-US-natalie";
  const locale = (voice.match(/^([a-z]{2}-[A-Z]{2})-/) || [])[1] || env.MURF_LOCALE || "en-US";
  return { vendor: "murf", params: { api_key: env.MURF_API_KEY, voiceId: voice, locale, model: "FALCON", sample_rate: 24000 } };
}

const ASR = (env) => ({ credential_mode: "managed", vendor: "deepgram", params: { url: "wss://api.deepgram.com/v1/listen", model: "nova-3", language: env.AGORA_ASR_LANGUAGE || "en-US" } });

// The host: listens to the person and talks back. Speaker lock + a higher VAD threshold keep venue noise out.
export function joinBody(env, { name, channel, agentToken, system, greeting }) {
  return {
    name,
    properties: {
      channel,
      token: agentToken,
      agent_rtc_uid: HOST_UID,
      remote_rtc_uids: [String(PERSON_UID)],
      idle_timeout: 30,
      ...(env.CALL_SAL === "1" ? { advanced_features: { enable_sal: true }, sal: { sal_mode: "locking" } } : {}),
      turn_detection: { config: { speech_threshold: Number(env.CALL_SPEECH_THRESHOLD || 0.6) } },
      asr: ASR(env),
      llm: llmConfig(env, system, greeting),
      tts: murfTts(env),
      parameters: {
        silence_config: { timeout_ms: 12000, action: "think", content: "They have been quiet for a while. Briefly check if they are still there; if this is the second time, say Goodbye." },
        farewell_config: { graceful_enabled: true, graceful_timeout_seconds: 5 },
      },
    },
  };
}

// A cast member (Claude, Gemini): its own voice, speaks only what the runner tells it to.
export function castBody(env, { name, channel, token, uid, voice }) {
  return {
    name,
    properties: {
      channel,
      token,
      agent_rtc_uid: String(uid),
      remote_rtc_uids: [NOBODY_UID],
      idle_timeout: 600,
      asr: ASR(env),
      llm: llmConfig(env, "You only read out messages you are given. Never add anything.", ""),
      tts: murfTts(env, voice),
    },
  };
}

export function castVoices(env) {
  try {
    return { ...DEFAULT_CAST_VOICES, ...(env.CAST_VOICES ? JSON.parse(env.CAST_VOICES) : {}) };
  } catch {
    return DEFAULT_CAST_VOICES;
  }
}

// Agora's speak API takes at most 512 bytes. Cut at a sentence end when we can.
export function fitSpeech(text, maxBytes = 500) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (Buffer.byteLength(t) <= maxBytes) return t;
  while (Buffer.byteLength(t) > maxBytes) t = t.slice(0, -1);
  const end = Math.max(t.lastIndexOf(". "), t.lastIndexOf("? "), t.lastIndexOf("! "));
  return end > 80 ? t.slice(0, end + 1) : t;
}

// Roughly how long text takes to say, in ms (about 2.6 words a second).
export function speechMs(text) {
  return Math.round((String(text || "").split(/\s+/).filter(Boolean).length / 2.6) * 1000) + 600;
}

// Which option did they pick? Prefer what the agent repeated back last, then what the person said last.
// Which option did they pick? Only the host's CONFIRMATION after the person has spoken counts
// ("Okay, Go ahead." / "Great, Sun 1pm it is."). Never a question ("Should we go ahead…?"), never the
// person's raw words (negations like "don't go ahead" contain the option), and the latest confirmation wins.
export function pickChoice(contents, options) {
  const list = contents || [];
  const firstUser = list.findIndex((c) => c.role === "user" && String(c.content || "").trim());
  if (firstUser < 0) return null;
  const esc = (o) => o.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const confirms = (text, o) => {
    const t = String(text || "").toLowerCase();
    if (t.includes("?")) return false;
    const e = esc(o);
    return new RegExp(`\\b(okay|ok|great|alright|got it|perfect|done)[,!.]?\\s+${e}\\b`).test(t) || new RegExp(`\\b${e}\\s+it is\\b`).test(t);
  };
  for (let i = list.length - 1; i > firstUser; i--) {
    const c = list[i];
    if (c.role !== "assistant") continue;
    const hits = options.filter((o) => confirms(c.content, o));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

export function toTranscript(contents, name, hostName = "Agent") {
  return (contents || []).filter((c) => c.content).map((c) => ({ speaker: c.who || (c.role === "assistant" ? hostName : name || "Callee"), text: c.content }));
}

export function isGoodbye(contents) {
  const last = [...(contents || [])].reverse().find((c) => c.role === "assistant");
  return Boolean(last && /\bgoodbye\b/i.test(last.content || ""));
}

// Captions in speaking order: the host's greeting, then the cast's lines, then the rest of the conversation.
// Lines the host's history repeats from the speak API are dropped so nothing shows twice.
export function mergeCaptions(contents, script, { hostName, personName }) {
  const said = new Set(script.map((s) => s.text));
  const host = (contents || []).filter((c) => c.content && !said.has(c.content));
  const out = [];
  const [first, ...rest] = host;
  if (first && first.role === "assistant") out.push({ who: hostName, text: first.content });
  else if (first) rest.unshift(first);
  for (const s of script) out.push({ who: s.who, text: s.text });
  for (const c of rest) out.push({ who: c.role === "assistant" ? hostName : personName, text: c.content });
  return out;
}

// ---------- the call page ----------

export function callPageHtml(id) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f1110"><title>Slates Call</title><style>
:root{--bg:#0f1110;--panel:#191b1a;--line:#2a2d2b;--fg:#f2f1ed;--muted:#9a9b95;--slates:#4cc38a;--claude:#e8915b;--gemini:#6ea8fe;--you:#b8b6ae;--danger:#e5484d}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-tap-highlight-color:transparent}
.wrap{max-width:560px;margin:0 auto;min-height:100%;display:flex;flex-direction:column;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.2px}
.logo{width:28px;height:28px;border-radius:8px;background:var(--slates);color:#06110b;display:grid;place-items:center;font-weight:800}
.top{display:flex;justify-content:space-between;align-items:center}
.live{font-size:13px;color:var(--muted);display:none;align-items:center;gap:6px}.live i{width:8px;height:8px;border-radius:50%;background:var(--danger);display:inline-block}
#ring{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px}
.pulse{width:112px;height:112px;border-radius:50%;background:var(--slates);color:#06110b;display:grid;place-items:center;font-size:48px;font-weight:800;box-shadow:0 0 0 0 rgba(76,195,138,.5);animation:p 1.6s infinite}
@keyframes p{70%{box-shadow:0 0 0 26px rgba(76,195,138,0)}100%{box-shadow:0 0 0 0 rgba(76,195,138,0)}}
@media (prefers-reduced-motion:reduce){.pulse{animation:none}}
h1{font-size:24px;margin:6px 0 0}.sub{color:var(--muted);margin:0;max-width:340px}
.who{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:4px}.chip{font-size:13px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.actions{display:flex;gap:56px;justify-content:center;margin:28px 0 12px}
.round{width:68px;height:68px;border-radius:50%;border:0;color:#fff;font-size:15px;font-weight:600;cursor:pointer;display:grid;place-items:center}
.round.ok{background:var(--slates);color:#06110b}.round.no{background:var(--danger)}
.lbl{font-size:13px;color:var(--muted);margin-top:8px;text-align:center}
#room{display:none;flex:1;flex-direction:column;gap:14px;padding-top:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px}
.headline{font-weight:650}.q{color:var(--muted);margin-top:4px;font-size:15px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 10px;display:flex;flex-direction:column;align-items:center;gap:8px;transition:border-color .15s}
.av{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:22px;color:#0b0c0c;transition:box-shadow .12s}
.tile.speaking{border-color:var(--c)}.tile.speaking .av{box-shadow:0 0 0 4px var(--bg),0 0 0 7px var(--c)}
.nm{font-weight:600;font-size:15px}.rl{font-size:12px;color:var(--muted);text-align:center}
.caps{min-height:120px;max-height:34vh;overflow:auto;display:flex;flex-direction:column;gap:8px;font-size:15px}
.cap b{font-weight:650;margin-right:6px}.cap{color:var(--fg)}.cap.old{color:var(--muted)}
.decide{display:none;gap:10px}.decide button{flex:1;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font:inherit;font-weight:650;cursor:pointer}
.decide button.primary{background:var(--slates);border-color:var(--slates);color:#06110b}
.decide button[disabled]{opacity:.5}
.hint{font-size:13px;color:var(--muted);text-align:center}
.end{align-self:center;padding:12px 28px;border-radius:999px;border:0;background:var(--danger);color:#fff;font:inherit;font-weight:650;cursor:pointer}
#done{display:none;flex:1;align-items:center;justify-content:center;text-align:center;flex-direction:column;gap:8px}
</style></head><body><div class="wrap">
<div class="top"><div class="brand"><div class="logo">S</div>Slates</div><div class="live" id="live"><i></i><span id="clock">0:00</span></div></div>
<section id="ring"><div class="pulse">S</div><h1 id="title">Slates is calling</h1><p class="sub" id="headline">Loading…</p><div class="who" id="who"></div>
<div class="actions"><div><button class="round no" id="decline" aria-label="Decline">✕</button><div class="lbl">Decline</div></div>
<div><button class="round ok" id="accept" aria-label="Accept" disabled>✓</button><div class="lbl">Accept</div></div></div>
<p class="hint" id="hint">Uses your microphone. Headphones give the best sound.</p></section>
<section id="room"><div class="card"><div class="headline" id="rh"></div><div class="q" id="rq"></div></div>
<div class="grid" id="tiles"></div>
<div class="card caps" id="caps" aria-live="polite"></div>
<div class="decide" id="decide"></div><div class="hint" id="dhint"></div>
<button class="end" id="end">End call</button></section>
<section id="done"><h1>Call ended</h1><p class="sub" id="dsum">Thanks. Your agents have it from here.</p></section>
</div>
<script src="https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.24.9/AgoraRTC_N-production.js"></script>
<script>
const id=${JSON.stringify(id)},$=(x)=>document.getElementById(x);
const COLORS={Slates:"var(--slates)",Claude:"var(--claude)",Gemini:"var(--gemini)"};
let cfg,client,mic,joined=false,t0=0,poll=null,levels=null,choiceMade=false;
const tracks={},loudAt={},talking={};
// Who is speaking right now, from real audio levels. Tells the runner when an agent finished a line
// (so the next voice waits its turn) and mutes the mic while agents talk (no echo back into the call).
function meter(){
  const now=Date.now();let agentTalking=false;
  for(const uid in tracks){
    const lv=tracks[uid].getVolumeLevel?tracks[uid].getVolumeLevel():0;
    if(lv>0.04)loudAt[uid]=now;
    const on=now-(loudAt[uid]||0)<650;
    if(talking[uid]&&!on)fetch("/c/"+id+"/quiet?uid="+uid,{method:"POST"}).catch(()=>{});
    talking[uid]=on;if(on)agentTalking=true;
    const t=$("t"+uid);if(t)t.classList.toggle("speaking",on);
  }
  if(mic){mic.setMuted(agentTalking);const me=$("t"+cfg.uid);if(me){me.classList.toggle("speaking",!agentTalking&&mic.getVolumeLevel()>0.04);me.querySelector(".rl").textContent=agentTalking?"Listening…":"Your turn"}}
}
const post=(p)=>fetch("/c/"+id+"/"+p,{method:"POST"}).catch(()=>{});
fetch("/c/"+id+"/config").then(r=>r.json()).then(c=>{
  if(c.error){$("headline").textContent=c.error;$("decline").disabled=true;return}
  cfg=c;$("title").textContent=c.title;$("headline").textContent=c.headline||"";
  $("who").innerHTML=c.participants.map(p=>'<span class="chip">'+esc(p.name)+'</span>').join("");
  $("accept").disabled=false;
});
function esc(s){return String(s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
function tiles(){
  const people=[...cfg.participants,{uid:cfg.uid,name:"You",role:cfg.personName||"",me:true}];
  $("tiles").innerHTML=people.map(p=>'<div class="tile" id="t'+p.uid+'" style="--c:'+(COLORS[p.name]||"var(--you)")+'"><div class="av" style="background:'+(COLORS[p.name]||"var(--you)")+'">'+esc(p.name[0])+'</div><div class="nm">'+esc(p.name)+'</div><div class="rl">'+esc(p.role||"")+'</div></div>').join("");
}
function decide(){
  if(!cfg.options||!cfg.options.length)return;
  $("decide").style.display="flex";
  $("decide").innerHTML=cfg.options.map((o,i)=>'<button data-i="'+i+'" class="'+(i===0?"primary":"")+'">'+esc(o)+'</button>').join("");
  $("dhint").textContent="Say it, or tap.";
  $("decide").querySelectorAll("button").forEach(b=>b.onclick=()=>{if(choiceMade)return;choiceMade=true;fetch("/c/"+id+"/choose?i="+b.dataset.i,{method:"POST"});lock(cfg.options[b.dataset.i])});
}
function lock(o){$("decide").querySelectorAll("button").forEach(b=>{b.disabled=true;if(b.textContent===o)b.classList.add("primary");else b.classList.remove("primary")});$("dhint").textContent="Decision: "+o}
$("decline").onclick=()=>{post("decline");show("done");$("dsum").textContent="Declined. You'll get the question on Telegram instead."};
$("accept").onclick=async()=>{
  $("accept").disabled=true;$("hint").textContent="Connecting…";
  try{
    client=AgoraRTC.createClient({mode:"rtc",codec:"vp8"});
    client.on("user-published",async(u,k)=>{await client.subscribe(u,k);if(k==="audio"){u.audioTrack.play();tracks[u.uid]=u.audioTrack}});
    client.on("user-unpublished",(u)=>{delete tracks[u.uid]});
    await client.join(cfg.appId,cfg.channel,cfg.token,cfg.uid);
    mic=await AgoraRTC.createMicrophoneAudioTrack({AEC:true,ANS:true,AGC:true,encoderConfig:"speech_standard"});
    await client.publish([mic]);
    joined=true;post("joined");show("room");tiles();decide();levels=setInterval(meter,150);
    $("rh").textContent=cfg.headline||cfg.title;$("rq").textContent=cfg.question||"";
    t0=Date.now();$("live").style.display="flex";setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);$("clock").textContent=Math.floor(s/60)+":"+String(s%60).padStart(2,"0")},1000);
    poll=setInterval(refresh,1500);
  }catch(e){$("hint").textContent="Couldn't connect: "+e.message;$("accept").disabled=false}
};
async function refresh(){
  const s=await fetch("/c/"+id+"/state").then(r=>r.json()).catch(()=>null);if(!s)return;
  const caps=s.captions||[];
  $("caps").innerHTML=caps.slice(-8).map((c,i,a)=>'<div class="cap'+(i<a.length-2?" old":"")+'"><b style="color:'+(COLORS[c.who]||"var(--you)")+'">'+esc(c.who)+'</b>'+esc(c.text)+'</div>').join("")||'<div class="cap old">Captions appear here.</div>';
  $("caps").scrollTop=1e6;
  if(s.choice&&!choiceMade){choiceMade=true;lock(s.choice)}
  if(s.ended)leave(s.choice?"Decision: "+s.choice+". Your agents are on it.":"");
}
async function leave(msg){if(!joined)return;joined=false;clearInterval(poll);clearInterval(levels);try{mic&&mic.close();await client.leave()}catch(e){}post("left");show("done");if(msg)$("dsum").textContent=msg}
$("end").onclick=()=>leave();
function show(x){["ring","room","done"].forEach(s=>$(s).style.display=s===x?"flex":"none")}
window.addEventListener("pagehide",()=>{if(joined)navigator.sendBeacon("/c/"+id+"/left")});
</script></body></html>`;
}

// ---------- provider ----------

export function agoraProvider(env, { fetchImpl = fetch, log = () => {} } = {}) {
  const missing = agoraMissing(env);
  const live = new Map(); // call id → call state

  async function api(path, { method = "POST", body, token } = {}) {
    const auth = env.AGORA_CUSTOMER_ID && env.AGORA_CUSTOMER_SECRET
      ? `Basic ${Buffer.from(`${env.AGORA_CUSTOMER_ID}:${env.AGORA_CUSTOMER_SECRET}`).toString("base64")}`
      : `agora token="${token}"`;
    const res = await fetchImpl(`${API}/${env.AGORA_APP_ID}${path}`, {
      method, headers: { "content-type": "application/json", authorization: auth }, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Agora ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    name: "agora",
    parallel: true, // group calls can ring everyone at once
    missing,

    // Routes for the public call page. Returns true if handled.
    async handlePage(req, res) {
      const u = new URL(req.url, "http://x");
      const m = u.pathname.match(/^\/c\/([a-f0-9]{32})(?:\/(config|state|joined|left|decline|choose|quiet))?$/);
      if (!m) return false;
      const call = live.get(m[1]);
      const json = (code, body) => res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
      if (!m[2]) { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(callPageHtml(m[1])); return true; }
      if (!call) { json(404, { error: "This call has ended or the link expired." }); return true; }
      switch (m[2]) {
        case "config":
          json(200, {
            appId: env.AGORA_APP_ID, channel: call.channel, token: call.personToken, uid: PERSON_UID,
            title: call.title, headline: call.headline, question: call.question, options: call.options || [],
            participants: call.participants, personName: call.personName,
          });
          break;
        case "state":
          json(200, { captions: call.captions(), choice: call.choice || null, ended: call.ended });
          break;
        case "joined": call.onJoin(); json(200, { ok: true }); break;
        case "quiet": call.quietAt[String(u.searchParams.get("uid"))] = Date.now(); json(200, { ok: true }); break;
        case "decline": call.declined = true; call.onJoin(); json(200, { ok: true }); break;
        case "choose": {
          const i = Number(u.searchParams.get("i"));
          if (call.options && call.options[i] && !call.choice) { call.choice = call.options[i]; call.tapped = true; }
          json(200, { ok: true });
          break;
        }
        default: call.left = true; json(200, { ok: true });
      }
      return true;
    },

    // cast: [{ name: "Claude", says: "..." }]; room: { headline, question } for the page.
    async call({ name, goal, notes, greeting, options, maxMinutes = 5, notify = async () => {}, ownerName = env.OWNER_NAME || "the owner", toOwner = false, notifyText, cast = [], room = {}, ringSec, onLink, external = null }) {
      const withChoice = (r) => (options ? { choice: null, ...r } : r);
      if (missing.length) return withChoice({ status: "failed", transcript: [], summary: `Calling isn't set up on this runner (missing ${missing.join(", ")}).`, durationSec: 0 });
      const { RtcTokenBuilder, RtcRole, ConvoAITokenBuilder } = require("agora-token");
      const id = crypto.randomBytes(16).toString("hex");
      const channel = `call-${id.slice(0, 12)}`;
      const ttl = 3600;
      const tok = (uid) => ConvoAITokenBuilder.buildToken(env.AGORA_APP_ID, env.AGORA_APP_CERTIFICATE, channel, String(uid), ttl, ttl);
      const voices = castVoices(env);
      const members = cast.filter((c) => c && c.name && c.says).slice(0, 3).map((c, i) => ({ name: c.name, says: fitSpeech(c.says), uid: CAST_UID0 + i, token: tok(CAST_UID0 + i), voice: voices[c.name] || "en-US-daniel", role: c.role || "" }));
      const hostName = toOwner ? "Slates" : `${ownerName}'s assistant`;
      const personName = toOwner ? ownerName : name || "Guest";
      const script = []; // lines the cast (and the host's scripted question) said, in order
      let contents = [];
      const call = {
        channel, left: false, declined: false, ended: false, choice: null, tapped: false, quietAt: {},
        title: toOwner ? "Slates is calling" : `${ownerName}'s AI assistant is calling`,
        headline: room.headline || (toOwner ? "" : `A quick call${name ? ` with ${name}` : ""} on behalf of ${ownerName}.`),
        question: room.question || "",
        options,
        personName,
        participants: [{ uid: Number(HOST_UID), name: toOwner ? "Slates" : "Slates", role: toOwner ? "Host" : `AI assistant for ${ownerName}` }, ...members.map((c) => ({ uid: c.uid, name: c.name, role: c.role }))],
        personToken: RtcTokenBuilder.buildTokenWithUid(env.AGORA_APP_ID, env.AGORA_APP_CERTIFICATE, channel, PERSON_UID, RtcRole.PUBLISHER, ttl, ttl),
        captions: () => mergeCaptions(contents, script, { hostName, personName }),
      };
      const hostToken = tok(HOST_UID);
      const joined = new Promise((r) => { call.onJoin = r; });
      live.set(id, call);
      const link = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/c/${id}`;
      const started = Date.now();
      let hostId = null;
      try {
        if (onLink) await Promise.resolve(onLink(link)).catch(() => {});
        await notify(notifyText ? `${notifyText}\n${link}` : `📞 Slates call link for ${name || "them"}. Send it to them (or open it yourself to test):\n${link}`);
        let ringTimer, extTimer;
        const opened = await Promise.race([
          joined.then(() => true),
          new Promise((r) => { ringTimer = setTimeout(() => r(false), Number(ringSec || env.CALL_RING_SEC || 300) * 1000); }),
          // Answered somewhere else first (e.g. their phone rang): stop waiting.
          new Promise((r) => { extTimer = setInterval(() => { if (external?.choice) r(false); }, 300); }),
        ]);
        clearTimeout(ringTimer);
        clearInterval(extTimer);
        if (!opened && external?.choice) return withChoice({ status: "completed", transcript: [], summary: `${personName} answered on ${external.via || "another device"}.`, durationSec: 0, ...(options ? { choice: external.choice } : {}) });
        if (!opened || call.declined) return withChoice({ status: "no_answer", transcript: [], summary: call.declined ? `${personName} declined the call.` : `${personName} didn't open the call link in time.`, durationSec: 0 });

        // Start the host and the cast together.
        const system = systemPrompt({ ownerName, name, goal, notes, options, toOwner, cast: members });
        const [host] = await Promise.all([
          api("/join", { body: joinBody(env, { name: channel, channel, agentToken: hostToken, system, greeting }), token: hostToken }),
          ...members.map((c) => api("/join", { body: castBody(env, { name: `${channel}-${c.uid}`, channel, token: c.token, uid: c.uid, voice: c.voice }), token: c.token })
            .then((r) => { c.agentId = r.agent_id; })
            .catch((err) => log(`  cast ${c.name} could not join: ${err.message}`))),
        ]);
        hostId = host.agent_id;
        log(`  agora room ${channel}: host ${hostId}${members.length ? ` + ${members.filter((c) => c.agentId).map((c) => c.name).join(", ")}` : ""}`);

        const say = async (agentId, token, text, interruptable) => {
          if (!agentId) return;
          await api(`/agents/${agentId}/speak`, { body: { text, priority: "INTERRUPT", interruptable }, token }).catch((err) => log(`  speak failed: ${err.message}`));
        };

        // Wait until `uid` has said its line: the call page reports when that voice goes quiet.
        // Falls back to an estimate if the page never reports (old browser, muted tab).
        const waitTurn = async (uid, since, text) => {
          const limit = since + speechMs(text) + 4000;
          while (Date.now() < limit && !call.left && !call.choice) {
            if ((call.quietAt[String(uid)] || 0) > since + 400) return;
            await sleep(150);
          }
        };
        // Scripted opening, one voice at a time: greeting → Claude → "Gemini, do you agree?" → Gemini → the question.
        const opening = (async () => {
          if (!members.length && !room.question) return;
          await waitTurn(HOST_UID, Date.now(), `${greeting} padding words for connection time`);
          for (const [i, c] of members.entries()) {
            if (call.left || call.choice || !c.agentId) continue;
            if (i > 0) {
              const handover = `${c.name}, ${c.name === "Gemini" ? "do you agree?" : "go ahead."}`;
              const at = Date.now();
              await say(hostId, hostToken, handover, false);
              script.push({ who: hostName, text: handover });
              await waitTurn(HOST_UID, at, handover);
            }
            const at = Date.now();
            await say(c.agentId, c.token, c.says, false);
            script.push({ who: c.name, text: c.says });
            await waitTurn(c.uid, at, c.says);
          }
          if (room.question && !call.left && !call.choice) {
            await say(hostId, hostToken, room.question, true);
            script.push({ who: hostName, text: room.question });
          }
        })();

        const deadline = Date.now() + maxMinutes * 60 * 1000;
        let goodbyeAt = 0;
        let tapHandled = false;
        while (Date.now() < deadline && !call.left) {
          await sleep(2000);
          if (external?.choice && !call.choice) { call.choice = external.choice; break; }
          try {
            const h = await api(`/agents/${hostId}/history`, { method: "GET", token: hostToken });
            if (Array.isArray(h.contents)) contents = h.contents;
            if (["STOPPED", "FAILED"].includes(h.status)) break;
          } catch (err) {
            if (/404|not found|stopped/i.test(err.message)) break;
          }
          if (call.tapped && !tapHandled) {
            tapHandled = true;
            const bye = `Okay, ${call.choice}. The agents are on it. Goodbye.`;
            await say(hostId, hostToken, bye, false);
            script.push({ who: hostName, text: bye });
            goodbyeAt = Date.now();
          }
          if (options && !call.tapped && !external?.choice) call.choice = pickChoice(contents, options); // latest confirmation wins
          if (!goodbyeAt && isGoodbye(contents)) goodbyeAt = Date.now();
          if (goodbyeAt && Date.now() - goodbyeAt > 4500) break; // let the goodbye finish playing
        }
        await opening.catch(() => {});
        call.ended = true;
        const choice = options ? call.choice || pickChoice(contents, options) : undefined;
        const transcript = toTranscript(call.captions().map((c) => ({ who: c.who, content: c.text })), personName, hostName);
        const lastPerson = [...contents].reverse().find((c) => c.role === "user")?.content || "";
        const lastAgent = [...contents].reverse().find((c) => c.role === "assistant")?.content || "";
        const summary = options
          ? choice ? `${personName} chose ${choice}${call.tapped ? " (tapped on the call screen)" : ""}.` : `${personName} didn't pick an option${lastPerson ? `; last said: "${lastPerson}"` : ""}.`
          : lastPerson ? `${personName} said: "${lastPerson}". ${hostName}: "${lastAgent}"` : "The call connected but nothing was said.";
        const spoke = contents.some((c) => c.role === "user") || call.tapped;
        return withChoice({ status: spoke ? "completed" : "no_answer", transcript, summary, durationSec: Math.round((Date.now() - started) / 1000), ...(options ? { choice } : {}) });
      } catch (err) {
        return withChoice({ status: "failed", transcript: toTranscript(contents, personName, hostName), summary: `Call failed: ${err.message}`, durationSec: Math.round((Date.now() - started) / 1000) });
      } finally {
        call.ended = true;
        if (hostId) await api(`/agents/${hostId}/leave`, { token: hostToken }).catch(() => {});
        await Promise.all(members.filter((c) => c.agentId).map((c) => api(`/agents/${c.agentId}/leave`, { token: c.token }).catch(() => {})));
        setTimeout(() => live.delete(id), 60_000).unref();
      }
    },
  };
}
