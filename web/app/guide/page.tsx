import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/logo';
import { IllustrationPanel } from '@/components/illustrations';
import { CopyBlock } from '@/components/copy';
import { AgentPicker, type PickerAgent } from '@/components/marketing/agent-picker';
import { JsonLd } from '@/components/marketing/json-ld';
import { STARTER_MESSAGE } from '@/components/agents/presets';
import { abs, faqLd, type Faq } from '@/lib/seo';

export const revalidate = 86400;

const TITLE = 'How to use Slates with Claude, ChatGPT, Gemini and other AI agents';
const DESC =
  'A simple step-by-step guide: join Slates, make your first board, and connect Claude, ChatGPT, Gemini, Grok, Instinct, Muse, Duet or any bot. For beginners and developers.';
export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: '/guide' },
  openGraph: { type: 'article', url: '/guide', title: TITLE, description: DESC, siteName: 'Slates', images: [{ url: '/og.png?v=1', width: 1200, height: 630 }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: ['/og.png?v=1'] },
};

const ORIGIN = 'https://www.slates.space';
const PROMPT = `Connect to my Slates dashboard. Read ${ORIGIN}/llms.txt for how it works, then use the API with the header "Authorization: Bearer slt_YOUR_TOKEN". Start by listing my slates. Keep item ids stable, keep text short (I read it on my phone), and log what you change with log_activity. Only use notify for things that need me now.`;
const MCP_JSON = JSON.stringify({ mcpServers: { slates: { type: 'http', url: `${ORIGIN}/mcp`, headers: { Authorization: 'Bearer slt_YOUR_TOKEN' } } } }, null, 2);
const CLAUDE_CODE = `claude mcp add --transport http slates ${ORIGIN}/mcp \\\n  --header "Authorization: Bearer slt_YOUR_TOKEN"`;
const GEMINI_CLI = `gemini mcp add --transport http \\\n  --header "Authorization: Bearer slt_YOUR_TOKEN" \\\n  slates ${ORIGIN}/mcp`;
const CURL = `curl -X POST ${ORIGIN}/api/v1/tools/list_slates \\\n  -H "Authorization: Bearer slt_YOUR_TOKEN" \\\n  -H "Content-Type: application/json" -d '{}'`;

const PAIR_PROMPT = `Connect yourself to my Slates (${ORIGIN}). Read ${ORIGIN}/llms.txt and follow the "Self-pairing" steps: start pairing, show me the code and the link, wait until I press Allow, then save your token somewhere safe. After that, list my boards.`;

const pair = (name: string, extra: string[] = []): string[] => [
  `Copy the message below and paste it to ${name}.`,
  `${name} replies with a short code and a link. Open the link on your phone or computer.`,
  'Sign in to Slates if it asks. Pick read only or read and write, then press Allow.',
  `${name} saves its own key and says it is connected. You never copy a token.`,
  ...extra,
];
const connector = (name: string, first: string[]): string[] => [...first, 'Sign in to Slates and press Allow.'];

const AGENTS: PickerAgent[] = [
  {
    id: 'claude', name: 'Claude', way: 'Easiest: paste one link. No token.',
    steps: connector('Claude', ['Open claude.ai, then Settings, then Connectors, then Add custom connector.', `Paste this link and press Connect.`]),
    blocks: [{ label: 'Connector link', text: `${ORIGIN}/mcp` }],
    note: 'Once added, it also works in the Claude apps.',
    more: [{ label: 'Claude Code (terminal)', text: CLAUDE_CODE }, { label: 'Or let Claude pair itself', text: PAIR_PROMPT }],
  },
  {
    id: 'chatgpt', name: 'ChatGPT', way: 'Easiest: paste one link. No token.',
    steps: connector('ChatGPT', ['In ChatGPT open Settings, then Connectors. Turn on developer mode if it asks. Choose Create.', 'Paste this link and choose OAuth.']),
    blocks: [{ label: 'Connector link', text: `${ORIGIN}/mcp` }],
    note: 'No connector option on your plan? Use the pairing message instead.',
    more: [{ label: 'Pairing message', text: PAIR_PROMPT }],
  },
  {
    id: 'gemini', name: 'Gemini', way: 'Pairing message, or Gemini CLI.',
    steps: pair('Gemini'),
    blocks: [{ label: 'Pairing message', text: PAIR_PROMPT }],
    note: 'The Gemini mobile app cannot connect to custom servers. Instead, log in to Gemini in a web browser (gemini.google.com) on your phone or computer and paste the pairing message there. It needs to be able to make web requests. If it cannot, use Gemini CLI (open "Other ways").',
    more: [{ label: 'Gemini CLI (needs a token from Agents, Connect agent)', text: GEMINI_CLI }],
  },
  {
    id: 'grok', name: 'Grok', way: 'Easiest: paste one link. No token.',
    steps: connector('Grok', ['Go to grok.com/connectors, then New Connector, then Custom.', 'Paste this link.']),
    blocks: [{ label: 'Connector link', text: `${ORIGIN}/mcp` }],
    more: [{ label: 'Pairing message', text: PAIR_PROMPT }],
  },
  {
    id: 'instinct', name: 'Instinct', way: 'Pairing message. Instinct keeps its key in its vault.',
    steps: pair('Instinct', ['Tip: ask Instinct to save the key in your vault as "Slates agent token".']),
    blocks: [{ label: 'Pairing message', text: PAIR_PROMPT }],
    more: [{ label: 'MCP config (needs a token)', text: MCP_JSON }],
  },
  {
    id: 'muse', name: 'Muse', way: 'Pairing message. Muse builds the connection itself.',
    steps: pair('Muse'),
    blocks: [{ label: 'Pairing message', text: PAIR_PROMPT }],
    note: 'The Muse app has no MCP menu, so this message is the simplest way. Muse Code can also use the MCP config.',
    more: [{ label: 'MCP config for Muse Code (needs a token)', text: MCP_JSON }],
  },
  {
    id: 'duet', name: 'Duet', way: 'Easiest: add an MCP server. No token.',
    steps: connector('Duet', ['In your Duet workspace, add an MCP server.', 'Paste this link and finish the sign-in.']),
    blocks: [{ label: 'Connector link', text: `${ORIGIN}/mcp` }],
    more: [{ label: 'Pairing message', text: PAIR_PROMPT }, { label: 'MCP config (needs a token)', text: MCP_JSON }],
  },
  {
    id: 'other', name: 'Any other bot', way: 'Pairing message works with any bot that can call web APIs.',
    steps: pair('your bot'),
    blocks: [{ label: 'Pairing message', text: PAIR_PROMPT }],
    note: 'If your bot supports remote MCP connectors, you can paste the connector link instead.',
    more: [{ label: 'Connector link', text: `${ORIGIN}/mcp` }, { label: 'MCP config (needs a token)', text: MCP_JSON }, { label: 'REST call', text: CURL }],
  },
];

const KINDS: [string, string][] = [
  ['List', 'Things to tick off: tasks, groceries'],
  ['Notes', 'Text you write, with tags'],
  ['Reminders', 'Pings on your phone, even when the app is closed'],
  ['Habits', 'Daily check-offs with streaks'],
  ['Goals and Countdown', 'Progress to a number, days until a date'],
  ['Table, Chart, Metrics', 'Money, numbers and graphs'],
  ['Links', 'Bookmarks and feeds'],
  ['Document and Timeline', 'Long pages and dated logs'],
];

const FAQ: Faq[] = [
  { q: 'Do I need to know how to code to use Slates with an agent?', a: 'No. For Claude, ChatGPT, Grok and Duet you paste one link, sign in and press Allow. Code is only needed for the token methods, and you can copy and paste those.' },
  { q: 'Which agents work with Slates?', a: 'Claude, ChatGPT, Gemini (through Gemini CLI), Grok, Instinct, Muse, Duet, and any bot that speaks MCP or can call a REST API.' },
  { q: 'Can an agent delete my stuff?', a: 'Only if you let it. Give an agent read only access, or limit it to some boards. Every change is saved as a version and you can restore it.' },
  { q: 'Can my agent connect itself?', a: 'Yes. Paste the pairing message. The agent asks Slates for a short code, you open the link and press Allow, and the agent receives its own token. You never copy a token.' },
  { q: 'I lost my token. What now?', a: 'Slates shows a token once. Make a new one in Agents and revoke the old one.' },
  { q: 'How do I get in?', a: 'Slates is invite only. Join the waitlist at slates.space/waitlist, or use an invite code at slates.space/join.' },
];

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <section className="mt-12" aria-labelledby={`s${n}`}>
    <div className="mb-3 flex items-center gap-3">
      <span className="tabular grid size-8 flex-none place-items-center rounded-full bg-accent text-[14px] font-semibold text-on-accent">{n}</span>
      <h2 id={`s${n}`} className="text-[24px] font-medium leading-tight tracking-[-0.04em]">{title}</h2>
    </div>
    <div className="space-y-3 text-[15px] leading-relaxed text-fg-2">{children}</div>
  </section>
);

const Steps = ({ items }: { items: string[] }) => (
  <ol className="space-y-2.5">
    {items.map((s, i) => (
      <li key={i} className="flex gap-3">
        <span className="grid size-6 flex-none place-items-center rounded-full border border-line font-mono text-[11px] text-fg-3">{i + 1}</span>
        <span className="pt-0.5">{s}</span>
      </li>
    ))}
  </ol>
);

export default function Guide() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'HowTo', name: TITLE, description: DESC, step: [
        { '@type': 'HowToStep', name: 'Get in', text: 'Join the waitlist or use an invite code, then sign in.' },
        { '@type': 'HowToStep', name: 'Make your first board', text: 'Pick a template or ask Slates to make one.' },
        { '@type': 'HowToStep', name: 'Connect an agent', text: 'Open Agents, press Connect agent, and follow the steps for Claude, ChatGPT, Gemini, Grok, Instinct, Muse or Duet.' },
        { '@type': 'HowToStep', name: 'Send the starter message', text: 'Tell the agent what Slates is for and ask it to list your boards.' },
        { '@type': 'HowToStep', name: 'Stay in control', text: 'Set read only access, limit boards, set an expiry, and watch Activity.' },
      ] },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Slates', item: abs('/') },
        { '@type': 'ListItem', position: 2, name: 'Guide', item: abs('/guide') },
      ] },
      faqLd(FAQ),
    ],
  };
  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-[calc(24px+var(--safe-top))] sm:px-6">
      <JsonLd data={graph} />
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="text-[20px] font-semibold tracking-[-0.05em]">slates</span>
        </Link>
        <Link href="/waitlist" className="btn btn-primary h-10 px-4 text-[14px]">Join the waitlist</Link>
      </header>

      <IllustrationPanel name="connect" className="mb-6 h-[clamp(110px,18dvh,170px)]" />
      <p className="kicker mb-2">Guide · about 10 minutes</p>
      <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.045em] sm:text-[44px]">Use Slates with all your AI agents.</h1>
      <p className="mt-4 max-w-[58ch] text-[16px] leading-relaxed text-fg-2">
        Slates is one board that you and your AI agents share. You tell any agent something once. Every other agent can see it. This guide works for everyone. If you do not code, follow the easy steps. If you do, jump to{' '}
        <a href="#developers" className="text-fg underline decoration-fg-4 underline-offset-4">the developer section</a>.
      </p>

      <nav aria-label="On this page" className="card mt-6 flex flex-wrap gap-x-4 gap-y-1.5 p-4 text-[14px]">
        {[['#s1', '1 Get in'], ['#s2', '2 First board'], ['#s3', '3 Connect an agent'], ['#s4', '4 Say hello'], ['#s5', '5 Stay in control'], ['#s6', '6 Daily use'], ['#developers', 'Developers'], ['#help', 'Help']].map(([h, t]) => (
          <a key={h} href={h} className="text-fg underline decoration-fg-4 underline-offset-4">{t}</a>
        ))}
      </nav>

      <section className="mt-10" aria-labelledby="how">
        <h2 id="how" className="mb-3 text-[24px] font-medium tracking-[-0.04em]">How it works</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {[['You', 'Open the Slates app on your phone or computer. Add, tick and read.'], ['The board', 'Lists, notes, reminders, habits, numbers and charts. All in one place.'], ['Your agents', 'Claude, ChatGPT, Gemini, Grok, Instinct, Muse, Duet and more. They read and write the same board.']].map(([t, d], i) => (
            <div key={t} className="card p-4">
              <p className="tabular mb-1 text-[13px] text-fg-3">{i + 1}</p>
              <p className="text-[16px] font-medium">{t}</p>
              <p className="mt-1 text-[13px] text-fg-3">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <Step n={1} title="Get in">
        <Steps items={[
          'Slates is invite only. Go to slates.space/waitlist and leave your email. You get a "you are on the list" email.',
          'When it is your turn you get a "You are in" email. Or, if a friend gave you a code, go to slates.space/join and enter the code and your email.',
          'Open the link in the email and sign in with Google or an email link.',
          'Put it on your home screen. iPhone: tap Share, then Add to Home Screen. Android: open the menu, then Install app. Computer: use the install icon in the address bar.',
        ]} />
      </Step>

      <Step n={2} title="Make your first board">
        <p>A board is one page for one job. Each board has a type, so your agents write things that look right.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map(([k, d]) => (
            <div key={k} className="card p-3.5">
              <p className="text-[15px] font-medium text-fg">{k}</p>
              <p className="text-[13px] text-fg-3">{d}</p>
            </div>
          ))}
        </div>
        <p>Not sure where to start? Press New board and pick a template: monthly budget, trip planner, job hunt, reading list, habits, goals, countdowns or launch dashboard. Or just tell Slates what you want in the Ask box (type or talk): &quot;make me a board for my gym habits&quot;.</p>
      </Step>

      <Step n={3} title="Connect an agent">
        <p>Pick your agent below. You only see the steps for that one. In Slates you can also press <span className="text-fg">Agents</span>, then <span className="text-fg">Connect agent</span>. New here? Home shows a <span className="text-fg">Connect your first agent</span> card and a short tour of every button. Replay it any time from <span className="text-fg">Settings</span> (in Apps), under Help, then <span className="text-fg">Take the tour</span>.</p>
        <div className="card p-4">
          <p className="text-[15px] font-medium text-fg">Three ways, from easiest</p>
          <p className="mt-1.5"><span className="text-fg">Connector.</span> Paste one link, sign in, press Allow. Works in Claude, ChatGPT, Grok and Duet.</p>
          <p className="mt-1.5"><span className="text-fg">Pairing.</span> Paste one message. Your agent shows a code, you press Allow, and the agent gets its own key. Works with almost any agent, including Instinct, Muse and Gemini.</p>
          <p className="mt-1.5"><span className="text-fg">Token.</span> You make a key in Slates and paste it into the agent. For developers and old tools. Treat it like a password.</p>
        </div>
        <AgentPicker agents={AGENTS} />
        <p className="text-[13px] text-fg-3">Replace <span className="font-mono">slt_YOUR_TOKEN</span> with a token from Agents, Connect agent. Slates shows a token once. If you lose it, make a new one. Pairing codes last 10 minutes.</p>
      </Step>

      <Step n={4} title="Say hello to your agent">
        <p>Once it is connected, send this first message. It tells the agent what Slates is for, and asks it to confirm that it works.</p>
        <CopyBlock label="Starter message" text={STARTER_MESSAGE} />
        <p>If the agent answers with a short summary of your boards, you are done. In Slates, the agent also appears under Agents once it is connected.</p>
      </Step>

      <Step n={5} title="Stay in control">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><span className="text-fg">Read only or read and write.</span> Read only means the agent can look but never change.</li>
          <li><span className="text-fg">Limit to some boards.</span> Give a bot only the boards it needs.</li>
          <li><span className="text-fg">Set an expiry.</span> The access ends by itself after the days you choose.</li>
          <li><span className="text-fg">Revoke any time.</span> One tap in Agents cuts an agent off.</li>
          <li><span className="text-fg">See everything.</span> Activity shows every change with the agent&apos;s name. Any board can go back to an older version.</li>
          <li><span className="text-fg">Extra privacy.</span> App lock (Face ID, Touch ID or passcode) and privacy mode, which blurs amounts on screen.</li>
        </ul>
      </Step>

      <Step n={6} title="Use it every day">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ['Tell any agent', '"Add milk and eggs to groceries." "Remind me to call mom at 6." "Log 5 km in my running habit."'],
            ['Ask Slates', '"What is due this week?" "How much did I spend?" Type it or say it. Quick actions like add, tick and move run instantly.'],
            ['Inbox', 'Share a link or text from any app into your Inbox. File it by hand, or let Slates sort it.'],
            ['Automations', 'A morning brief, a weekly recap, auto-filing the Inbox, and feeds like Hacker News or BBC. They run on a schedule.'],
          ].map(([t, d]) => (
            <div key={t} className="card p-4">
              <p className="text-[15px] font-medium text-fg">{t}</p>
              <p className="mt-1 text-[13px] text-fg-3">{d}</p>
            </div>
          ))}
        </div>
        <div className="card p-4">
          <p className="text-[15px] font-medium text-fg">Make it yours</p>
          <p className="mt-1 text-[13px] text-fg-3">The bottom bar has Today (what needs you, what changed, what is coming up), the Ask bar, and Apps. Apps opens every feature (Notes, Reminders, Inbox, Spaces and more) and, under the dashed line, your own shortcuts: tap Add to put any board or note there. Your profile picture opens About me and Settings.</p>
        </div>
        <p>The real power: tell one agent, and the next one already knows. Say your plan to ChatGPT in the morning. Ask Claude about it at night. Both read the same board.</p>
      </Step>

      <section className="mt-14" id="developers" aria-labelledby="dev">
        <h2 id="dev" className="mb-3 text-[24px] font-medium tracking-[-0.04em]">For developers</h2>
        <div className="space-y-3 text-[15px] leading-relaxed text-fg-2">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>MCP (Streamable HTTP): <span className="font-mono text-[13px] text-fg">{ORIGIN}/mcp</span>. OAuth 2.1 for claude.ai, ChatGPT, Grok and Duet. Or send <span className="font-mono text-[13px]">Authorization: Bearer slt_...</span>.</li>
            <li>Self-pairing (device-code style, no token copy): <span className="font-mono text-[13px] text-fg">POST /api/v1/pair</span> with <span className="font-mono text-[13px]">{'{"name": "my-agent"}'}</span> returns <span className="font-mono text-[13px]">user_code</span>, <span className="font-mono text-[13px]">verification_url_complete</span> and <span className="font-mono text-[13px]">device_secret</span>. Show the link to the user, then poll <span className="font-mono text-[13px] text-fg">POST /api/v1/pair/poll</span> with <span className="font-mono text-[13px]">{'{"device_secret": "..."}'}</span> every 3 seconds. On <span className="font-mono text-[13px]">approved</span> you get your token once.</li>
            <li>REST: <span className="font-mono text-[13px] text-fg">POST {ORIGIN}/api/v1/tools/&lt;tool_name&gt;</span> with a JSON body. Replies are <span className="font-mono text-[13px]">{'{"data": ...}'}</span> or <span className="font-mono text-[13px]">{'{"error": {...}}'}</span>.</li>
            <li>OpenAPI 3.1: <a className="text-fg underline decoration-fg-4 underline-offset-4" href="/api/v1/openapi.json">/api/v1/openapi.json</a>. Agent guide: <a className="text-fg underline decoration-fg-4 underline-offset-4" href="/llms.txt">/llms.txt</a>.</li>
            <li>Call <span className="font-mono text-[13px]">describe_kinds</span> first for exact JSON schemas. Prefer <span className="font-mono text-[13px]">patch_items</span> (merge by item id) over replacing a whole board.</li>
            <li>Pass <span className="font-mono text-[13px]">expected_version</span> to <span className="font-mono text-[13px]">update_slate</span>. A 409 means someone else wrote first: re-read, then retry.</li>
            <li>Layout tools: <span className="font-mono text-[13px] text-fg">set_layout</span> (dashboard order, size, view, hidden, section, look) and <span className="font-mono text-[13px] text-fg">get_app_layout</span> / <span className="font-mono text-[13px] text-fg">set_app_layout</span> (3 tabs, up to 12 shortcuts, and the Home screen blocks, quick buttons or a dashboard as home) and the app palette.</li>
            <li>Tokens are per agent, stored hashed, and can be read only, limited to boards, expiring and revocable.</li>
          </ul>
          <CopyBlock label="Try it" text={CURL} />
        </div>
      </section>

      <section className="mt-14" id="help" aria-labelledby="faq">
        <h2 id="faq" className="mb-3 text-[24px] font-medium tracking-[-0.04em]">Help</h2>
        <div className="grid gap-2">
          {[...FAQ, { q: 'The agent says unauthorized or 401.', a: 'The token is wrong, expired or revoked. Make a new one in Agents. Check there is no extra space and that the header says "Bearer " before the token.' }, { q: 'The agent cannot see my boards.', a: 'It may be limited to some boards, or set to read only. Open Agents and check its access. Then ask it to list your boards again.' }, { q: 'My connector does not appear in ChatGPT.', a: 'Turn on developer mode in ChatGPT settings, then create the connector again. Some plans do not offer custom connectors. Use the prompt and a token instead.' }].map((f) => (
            <details key={f.q} className="card p-4">
              <summary className="cursor-pointer text-[15px] font-medium text-fg">{f.q}</summary>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="mt-12 flex flex-wrap gap-2">
        <Link href="/waitlist" className="btn btn-primary">Join the waitlist <ArrowRight className="size-4" strokeWidth={1.75} /></Link>
        <Link href="/demo" className="btn btn-glass">See the demo</Link>
        <Link href="/" className="btn btn-glass">Sign in</Link>
      </div>
    </main>
  );
}
