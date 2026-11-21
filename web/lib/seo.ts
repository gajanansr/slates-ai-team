import { SITE_URL } from '@/lib/env';

export const SITE_NAME = 'Slates';
export const TAGLINE = 'One board for you and all your AI agents';

export type Faq = { q: string; a: string };
export type SeoPage = {
  slug: string;
  /** <title> (the root template adds " · Slates"). Keep under ~50 characters. */
  title: string;
  /** meta description, 120-155 characters. */
  description: string;
  kicker: string;
  h1: string;
  intro: string;
  sections: { h: string; p: string }[];
  faq: Faq[];
  related: string[];
};

const AGENTS = 'Claude, ChatGPT, Grok or any MCP or REST agent';

/** Keyword landing pages. Every claim here describes what Slates does today. */
export const SEO_PAGES: SeoPage[] = [
  {
    slug: 'agentic-notes',
    title: 'Agentic notes your AI agents can read and write',
    description: 'Agentic notes in Slates: Markdown notes that Claude, ChatGPT, Grok or any MCP agent can search, read and write, with version history and per-agent access.',
    kicker: 'Agentic notes',
    h1: 'Agentic notes: notes your AI agents can write too.',
    intro: `Most notes apps are built for one human typing. Slates is built for you and your agents. Notes are Markdown, tagged and searchable, and ${AGENTS} can read them, add to them and tidy them, so every assistant starts from what you already wrote instead of from zero.`,
    sections: [
      { h: 'Notes that agents can actually use', p: 'Each note is structured data, not a screenshot or a pasted blob. Agents can search by title or tag, read a note, append to it or create a new one through MCP or the REST API, and you see the change straight away.' },
      { h: 'You stay in control', p: 'Every agent gets its own token. Make it read-only or read and write, limit it to certain boards, set an expiry and revoke it any time. Every change an agent makes shows up in Activity with the agent\'s name, and every version of a note can be restored.' },
      { h: 'Capture from anywhere', p: 'Send text, links and images to your Slates inbox from the phone share sheet, or just ask Slates in plain language. Notes sit next to your lists, reminders, habits and goals, so context is never split across seven apps.' },
    ],
    faq: [
      { q: 'What are agentic notes?', a: 'Notes that AI agents can read, write and organise alongside you, instead of notes only a human edits. In Slates an agent connects over MCP or REST and works on the same notes you see.' },
      { q: 'Which AI agents can use Slates notes?', a: `${AGENTS}. One-tap connectors exist for claude.ai and ChatGPT.` },
      { q: 'Can I stop an agent changing my notes?', a: 'Yes. Give an agent read-only access, limit it to certain boards, or revoke its token at any time. Changes are logged with the agent name and can be restored from version history.' },
    ],
    related: ['agentic-docs', 'shared-memory-for-ai-agents', 'ai-agent-workspace'],
  },
  {
    slug: 'agentic-docs',
    title: 'Agentic docs: documents your AI agents can edit',
    description: 'Agentic docs in Slates: long-form documents and Markdown pages that your AI agents draft, update and keep current, with version history and access control.',
    kicker: 'Agentic docs',
    h1: 'Agentic docs: documents that keep themselves current.',
    intro: `A doc goes stale the moment it is written. In Slates, documents live on the same board your agents write to, so ${AGENTS} can draft a plan, update a status page or refresh a runbook while you get on with your day.`,
    sections: [
      { h: 'Docs next to the data they describe', p: 'A document can sit beside a task list, a metrics board or a chart. Agents update the numbers and the write-up together, so the doc never drifts from the facts.' },
      { h: 'Safe for several agents at once', p: 'Writes are versioned. An agent passes the version it read, and if someone else changed the doc in between, the write is rejected and the agent re-reads and retries. Two agents do not overwrite each other.' },
      { h: 'History you can trust', p: 'Every change is recorded with who made it, human or agent, and any version can be restored. You can also export your boards whenever you want.' },
    ],
    faq: [
      { q: 'What are agentic docs?', a: 'Documents that AI agents can create and keep up to date, not only humans. Slates exposes documents to agents through MCP and a REST API.' },
      { q: 'Can two agents edit the same document?', a: 'Yes. Writes are versioned with an expected-version check, so a conflicting write is rejected and retried instead of silently overwriting.' },
      { q: 'Is there version history?', a: 'Yes. Each version is stored and can be restored, and Activity shows which agent or person changed what.' },
    ],
    related: ['agentic-notes', 'ai-agent-dashboard', 'ai-agent-workspace'],
  },
  {
    slug: 'agentic-ui',
    title: 'Agentic UI: typed boards your AI agents render',
    description: 'Agentic UI in Slates: instead of walls of chat text, agents write typed boards (lists, charts, metrics, tables, habits) that render as real interface.',
    kicker: 'Agentic UI',
    h1: 'Agentic UI: agents that build real interface, not chat text.',
    intro: 'Chat is a poor place to keep anything. Slates gives agents a typed UI to write to. They create lists you can tick off, habits with streaks, charts, metrics and tables, and the app renders them as real screens on your phone or desktop.',
    sections: [
      { h: 'Typed boards, not blobs', p: 'Boards have kinds: lists, notes, documents, reminders, habits, goals, countdowns, tables, charts, metrics, links, trackers, timelines and dashboards. Each has a schema, so an agent writes valid data and the interface always renders it correctly.' },
      { h: 'Ask for a screen, get a screen', p: 'Tell your agent "make me a dashboard for my launch" and it builds boards you can use: tasks to tick, numbers to watch, a chart that updates. You just look, edit or ask for changes by typing or talking.' },
      { h: 'Built for MCP', p: 'Agents discover the available kinds and their schemas through the MCP server, then write with small patch operations that merge by item id. No scraping, no screenshots, no guessing at layouts.' },
    ],
    faq: [
      { q: 'What is agentic UI?', a: 'Interface that AI agents create and update for you, instead of replying only in chat. In Slates an agent writes typed boards and the app renders them.' },
      { q: 'What kinds of boards can agents create?', a: 'Lists, notes, documents, reminders, habits, goals, countdowns, tables, charts, metrics, links, trackers, timelines and dashboards.' },
      { q: 'Do agents need special code to use it?', a: 'No. Any MCP client works, and there is a REST API with an OpenAPI spec for everything else.' },
    ],
    related: ['ai-agent-dashboard', 'mcp-server-for-notes-and-tasks', 'ai-agent-workspace'],
  },
  {
    slug: 'ai-agent-workspace',
    title: 'AI agent workspace: one board for every agent',
    description: 'Slates is a shared AI agent workspace: one board where you and every agent (Claude, ChatGPT, Grok, MCP) keep tasks, notes, reminders, habits and data.',
    kicker: 'AI agent workspace',
    h1: 'The AI agent workspace: one board for you and every agent.',
    intro: 'Everyone now uses a few AI assistants and too many apps. Each assistant starts from zero, and each app holds a slice of your life, so you end up as the glue. Slates is the common board they all share: your context in one place, with the features of seven apps.',
    sections: [
      { h: 'Replaces seven apps', p: 'To-do lists, notes, reminders, a habit tracker, a budget spreadsheet, a goal and countdown tracker, and bookmarks all exist as board types, so you stop switching between tools and your agents stop working from partial context.' },
      { h: 'Every agent connects', p: `${AGENTS}. They read the board, write to it and see each other's work, so what you told one agent, the next one already knows.` },
      { h: 'Private and invite-only', p: 'Slates opens to a few people at a time. Your boards are private by design, with per-agent access, privacy mode and an app lock on the phone.' },
    ],
    faq: [
      { q: 'What is an AI agent workspace?', a: 'A shared place where you and your AI agents keep tasks, notes and data, so every agent works from the same context.' },
      { q: 'Does Slates work with ChatGPT and Claude?', a: 'Yes. Both have one-tap connectors, and Grok, Duet, Instinct, Muse or any MCP or REST agent can connect too.' },
      { q: 'How do I get access?', a: 'Slates is invite-only right now. Join the waitlist at slates.space/waitlist and you will get an invite when it is your turn.' },
    ],
    related: ['shared-memory-for-ai-agents', 'agentic-notes', 'mcp-server-for-notes-and-tasks'],
  },
  {
    slug: 'mcp-server-for-notes-and-tasks',
    title: 'MCP server for notes, tasks and dashboards',
    description: 'Slates exposes an MCP server and REST API so Claude, ChatGPT, Grok and other agents can read and write your notes, tasks, reminders, habits and charts.',
    kicker: 'MCP server',
    h1: 'An MCP server for your notes, tasks and dashboards.',
    intro: 'Slates runs a remote MCP server (Streamable HTTP) so any MCP-capable agent can work on your boards. Add the connector URL, approve access, and your agent can list, read, create and patch notes, tasks, reminders, habits, tables and charts.',
    sections: [
      { h: 'Connect in a minute', p: 'claude.ai and ChatGPT connect with OAuth: add the server URL and approve. Other clients can use a bearer token created in the Agents screen. A REST API with an OpenAPI 3.1 spec covers anything that does not speak MCP.' },
      { h: 'Typed tools and schemas', p: 'Agents call describe_kinds to learn each board type, then write with patch operations that merge by item id. Writes are versioned, so concurrent agents do not clobber each other.' },
      { h: 'Scoped, logged, revocable', p: 'Each token can be read-only or read and write, limited to specific boards, given an expiry and revoked at any time. Every agent change is logged in Activity with the agent\'s name.' },
    ],
    faq: [
      { q: 'What can an MCP agent do in Slates?', a: 'List and read boards, create and update notes, tasks, reminders, habits, tables and charts, and patch individual items, within the access you grant.' },
      { q: 'Is there a REST API too?', a: 'Yes. Every tool is available over REST with the same bearer token, and an OpenAPI 3.1 spec is published.' },
      { q: 'Is the connection secure?', a: 'Connectors use OAuth 2.1, tokens are per agent, and you can scope, expire or revoke them at any time.' },
    ],
    related: ['ai-agent-workspace', 'agentic-ui', 'shared-memory-for-ai-agents'],
  },
  {
    slug: 'shared-memory-for-ai-agents',
    title: 'Shared memory for AI agents (Claude, ChatGPT, Grok)',
    description: 'Give Claude, ChatGPT, Grok and other agents one shared memory. Slates keeps your context on a common board every agent can read, write and trust.',
    kicker: 'Shared agent memory',
    h1: 'Shared memory for AI agents: tell one, they all know.',
    intro: 'Every AI assistant starts from zero, and your context is scattered across chats. Slates is a common board all your agents read and write, so a preference, a plan or a deadline you gave one assistant is already there for the next.',
    sections: [
      { h: 'Structured, not a pile of chat history', p: 'Context lives as typed boards: tasks, notes, goals, numbers. Agents read exactly what they need and write back cleanly, instead of re-parsing old conversations.' },
      { h: 'Portable across assistants', p: 'Switch from Claude to ChatGPT to Grok and keep your context. The board belongs to you, not to any one assistant, and you can export it.' },
      { h: 'Auditable', p: 'You can see which agent wrote what in Activity, restore any version, and cut an agent off in one tap.' },
    ],
    faq: [
      { q: 'How do AI agents share memory in Slates?', a: 'They connect to the same board over MCP or REST. Whatever one agent writes, another can read.' },
      { q: 'Do I own the data?', a: 'Yes. Your boards are private to you, and you can export them at any time.' },
      { q: 'Can I see what each agent changed?', a: 'Yes. Activity shows every change with the agent name, and each version can be restored.' },
    ],
    related: ['ai-agent-workspace', 'agentic-notes', 'mcp-server-for-notes-and-tasks'],
  },
  {
    slug: 'ai-agent-dashboard',
    title: 'AI agent dashboard: tasks, metrics and charts',
    description: 'A personal dashboard that your AI agents keep current: tasks, habits, goals, metrics and charts on one board, updated by Claude, ChatGPT or any MCP agent.',
    kicker: 'AI agent dashboard',
    h1: 'A dashboard your AI agents keep current.',
    intro: 'Slates dashboards put several boards on one screen: today\'s tasks, habit streaks, goals, key numbers and charts. Your agents update them as things change, so you open one page and see where everything stands.',
    sections: [
      { h: 'Several boards, one screen', p: 'Combine lists, metrics, charts, tables and countdowns into a single dashboard. Templates such as a monthly budget get you started quickly.' },
      { h: 'Updated by agents, not by you', p: 'Ask an agent to log numbers, tick off tasks or refresh a chart, and the dashboard reflects it. You can also change anything by typing or talking to Slates.' },
      { h: 'Reminders that reach you', p: 'Reminders can push to your phone, repeat and snooze, and a this-week agenda keeps the next few days in view.' },
    ],
    faq: [
      { q: 'What is an AI agent dashboard?', a: 'A dashboard whose contents are written and refreshed by AI agents, so it stays current without manual updates.' },
      { q: 'What can I put on it?', a: 'Lists, notes, habits, goals, countdowns, metrics, charts and tables, in any mix.' },
      { q: 'Is there a demo?', a: 'Yes. The public demo at slates.space/demo shows sample boards rendered by the real app.' },
    ],
    related: ['agentic-ui', 'agentic-docs', 'ai-agent-workspace'],
  },
];

export const pageBySlug = (slug: string) => SEO_PAGES.find((p) => p.slug === slug);
export const abs = (path: string) => new URL(path, SITE_URL).toString();

/** JSON-LD must not contain a literal "</script>"; escape "<". */
export const ld = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

export const faqLd = (faq: Faq[]) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

export const HOME_FAQ: Faq[] = [
  { q: 'What is Slates?', a: 'Slates is the common board for you and all your AI agents. Your context lives in one place, with the features of seven apps: lists, notes, reminders, habits, goals, tables and charts, and links.' },
  { q: 'Which AI agents work with Slates?', a: `${AGENTS}. One-tap connectors exist for claude.ai and ChatGPT.` },
  { q: 'Is Slates free? How do I get in?', a: 'Slates is invite-only and opening to a few people at a time. Join the waitlist at slates.space/waitlist.' },
  { q: 'Can I control what agents do?', a: 'Yes. Each agent gets its own token, read-only or read and write, limited to certain boards, with an expiry. You can revoke it any time and see every change in Activity.' },
];

export const softwareLd = () => ({
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  url: abs('/'),
  applicationCategory: 'ProductivityApplication',
  operatingSystem: 'Web, iOS, Android',
  description: 'A shared AI agent workspace: one board for you and all your AI agents, with notes, docs, tasks, reminders, habits, goals, tables and charts.',
  image: abs('/og.png'),
  featureList: ['MCP server and REST API for AI agents', 'Notes and documents', 'Lists, reminders and habits', 'Goals and countdowns', 'Tables, charts and metrics', 'Per-agent access control and activity log', 'Version history'],
});
