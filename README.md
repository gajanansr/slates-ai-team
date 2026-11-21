# Slates: a team of AI employees that talk to you and do your work

**Tell Slates what you need handled, and it builds you an AI employee: a real Agora voice agent with its own Murf voice, boards and routines. Your team holds standups with you in a voice call. Each agent reports in its own voice and takes your orders. When one needs a decision, it calls you.**

Built at *Build with Agora*, Bengaluru, Nov 21, 2026. Track 3: AI Agents That Get Things Done.

---

## The problem

AI can now do real work: chase payments, find deals, run a small business's admin, fix code. But:

1. **Every AI lives in its own app.** Claude, ChatGPT, Gemini and Codex each remember only themselves.
2. **You have to babysit chats.** Nothing runs while you're away.
3. **Agents can't reach you** when they need a decision, so they stall or guess.
4. **You can't see what they did.**

## What Slates does

| | |
|---|---|
| **Agents on demand** | Say *"manage my dairy business"*. Agent Studio builds a **Dairy Manager** in seconds: a dashboard, a milk log, customer dues, a cattle-health tracker, daily routines, reminders and a playbook. It gets its **own Murf voice** and introduces itself aloud. |
| **Call Slates** | Tap *Call Slates* and talk. Slates (an **Agora Conversational AI** agent) reads and edits your boards, sets reminders, hands work to your agents, and can build new agents mid-conversation, through Slates' own **MCP server**, live in the call. |
| **Standup with your AI team** | One tap. Slates hosts; each built agent reports from its own boards in its own voice. Your **real** coding agents (Claude Code, Codex CLI, Antigravity CLI) running on your laptop join too, and answer questions **in their own voices**. |
| **A real meeting, not a chatbot** | The agents share one transcript, so they hear each other. An agent can **jump in** to add or disagree. The current speaker **yields** (Agora `interrupt`). **You always win**: start talking and every agent stops. |
| **Agents call you** | When an agent needs a decision ("the site is down, should we revert?"), Slates rings you three ways at once: an Agora call room in the app, a real phone call (Twilio), and a Slates push. Say "go ahead" and it acts. |
| **Agents at work** | A live board shows what every agent is doing right now: working, needs you, done or failed. |

Honesty rule: agents that live in other apps (ChatGPT, Gemini app, Instinct) can't be pulled into a call, because MCP is one-way. Slates narrates their work in its own voice. **Every voice you hear is a real agent.**

## How it's built

```
 Phone / browser ──Agora RTC──▶ Agora Conversational AI ◀──speak / interrupt / history──┐
   (web app, Next.js)              │ host: Slates (managed ASR + LLM, Murf TTS)            │
                                   │   ├─ llm.mcp_servers ──▶ Slates MCP (boards, notes,   │
                                   │   │                       reminders, hand_off, build) │
                                   │   └─ llm.tools: ask_agent ──HTTPS──▶ Slates runner ───┘
                                   │ cast: one speak-only agent per voice      (your laptop)
                                   │   (Claude, Codex, Antigravity, built agents) runs real CLIs:
                                   │                                          claude -p, codex exec,
                                   │                                          agy -p, with Slates
                                   │                                          context; room/floor
                                   │                                          control; moderator
                                   ▼
                     Supabase (boards, notes, agents, RLS) ◀── Slates MCP / REST
```

- **Agora Conversational AI (REST v2):** `join` with managed Deepgram ASR, a managed LLM and **Murf** TTS; `llm.mcp_servers` (Slates tools in the call); `llm.tools` (a custom `ask_agent` HTTPS tool, synchronous, 90 s); `speak`, `interrupt` and `think` for floor control; `history` for captions; per-agent ConvoAI tokens. **Agora Web SDK 4.24** in the browser, with echo cancellation, noise suppression and barge-in.
- **Murf Falcon:** a voice per agent (Indian, American and British English), streamed through Agora for calls, plus the Murf streaming API for each agent's spoken intro.
- **Slates web app** (`web/`): Next.js 16 + Supabase. Per-call Slates tokens that expire after a day, are limited to the agent's own boards, and are revoked when the call ends. Agent Studio blueprints are validated against every board kind's schema.
- **Slates runner** (`runner/`): a Node service on your laptop. It polls the Slates desk and runs agents with spend and time caps. It also handles owner approvals (Telegram), call-backs (Agora room + Twilio + Slates push), the meeting room (shared transcript, floor control, a moderator for jump-ins), the "Agents at work" board, Playwright browser tools, and watchers.

## Guardrails (in code, not prompts)

- Every outbound call opens by saying it's an AI calling for the owner. Calls need the owner's approval, and there are quiet hours and call caps.
- Decisions count only when Slates confirms them *after* you speak. Negations are never read as a yes (tested).
- Agent-call tokens are limited to that agent's boards and carry no destructive tools. Live CLI agents get read-only Slates tools.
- The runner's public endpoints need a bearer secret plus an HMAC-signed call context, and Twilio webhooks are signature-checked.
- No secrets in the repo; `.env.example` lists every setting.

## Run it

```bash
# Web app
cd web && npm ci
cp .env.example .env.local   # AGORA_APP_ID, AGORA_APP_CERTIFICATE, MURF_API_KEY, SLATES_ENC_KEY, (RUNNER_URL, ASK_SECRET)
npm run dev

# Runner (on the laptop where Claude Code / Codex / Antigravity are signed in)
cd runner && npm ci
cp .env.example .env          # SLATES_TOKEN, AGORA_*, MURF_API_KEY, ASK_SECRET, PUBLIC_BASE_URL, ...
cloudflared tunnel --url http://localhost:8787   # public URL for Agora tools + Twilio
npm start
npm test                      # 129 tests
```

The web app has about 355 tests (vitest). The runner tests use fake Slates, Telegram, Agora and Claude, so they never touch real accounts.

## Status

A hackathon build. It works end to end against the real Agora, Murf, Twilio and CLI agents (see the commit history). Still open: an Agora SIP phone leg instead of Twilio, real-time captions over RTM, and hosting the runner in the cloud.

---

*Voice by Murf · Calls by Agora*
