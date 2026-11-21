/**
 * How each agent connects. `connector` = OAuth custom connector (URL only, sign in to
 * Slates, no token). Token methods: `mcp` (MCP server config with a Bearer header),
 * `claude-code`, `prompt` (paste instructions; the agent calls the API itself), `rest`.
 */
export type Method = 'pair' | 'connector' | 'mcp' | 'claude-code' | 'prompt' | 'rest';

export type Preset = {
  kind: string;
  name: string;
  methods: Method[];
  /** Steps for the OAuth connector, when supported. */
  connectorSteps?: string[];
  note?: string;
};

/** The one message that lets an agent pair itself: it shows a code, the person taps Allow, no token to copy. */
export const pairMessage = (origin: string) =>
  `Connect yourself to my Slates (${origin}). Read ${origin}/llms.txt and follow the "Self-pairing" steps: start pairing, show me the code and the link, wait until I press Allow, then save your token somewhere safe. After that, read what Slates knows about me (get_about_me). If it is empty, interview me for two minutes about my work, projects, people and what I want to keep track of, save what you learn with remember, and set up my first spaces.`;

export const AGENT_PRESETS: Preset[] = [
  {
    kind: 'instinct',
    name: 'Instinct',
    methods: ['pair', 'mcp', 'prompt', 'rest'],
    note: 'Store the token in your Instinct vault (e.g. “Slates agent token”) so Instinct can reuse it.',
  },
  {
    kind: 'claude',
    name: 'Claude',
    methods: ['connector', 'claude-code', 'mcp'],
    connectorSteps: [
      'claude.ai → Settings → Connectors → Add custom connector',
      'Paste the URL below, then Connect',
      'Sign in to Slates and tap Allow',
      'It also works in the Claude apps once added',
    ],
  },
  {
    kind: 'chatgpt',
    name: 'ChatGPT',
    methods: ['connector', 'prompt'],
    connectorSteps: [
      'ChatGPT → Settings → Connectors (enable developer mode if asked) → Create',
      'Paste the URL below and choose OAuth',
      'Sign in to Slates and tap Allow',
    ],
  },
  {
    kind: 'grok',
    name: 'Grok',
    methods: ['connector', 'rest'],
    connectorSteps: ['grok.com/connectors → New Connector → Custom', 'Paste the URL below', 'Sign in to Slates and tap Allow'],
  },
  {
    kind: 'duet',
    name: 'Duet',
    methods: ['connector', 'pair', 'mcp', 'prompt'],
    connectorSteps: ['In your Duet workspace, add an MCP server', 'Paste the URL below and complete sign-in', 'Sign in to Slates and tap Allow'],
  },
  {
    kind: 'muse',
    name: 'Muse',
    methods: ['pair', 'prompt', 'mcp', 'rest'],
    note: 'The Muse app has no MCP menu, but Muse can build the connection itself from the prompt. Muse Code can use the MCP config.',
  },
  { kind: 'gemini', name: 'Gemini', methods: ['pair', 'prompt', 'rest'], note: 'The Gemini mobile app cannot connect to custom servers. Sign in to Gemini in a web browser (gemini.google.com) and paste the pairing message there. It pairs itself when it can browse the web or run code. Otherwise use a Prompt token.' },
  { kind: 'dots', name: 'Dots', methods: ['pair', 'mcp', 'prompt', 'rest'] },
  { kind: 'other', name: 'Other', methods: ['pair', 'connector', 'mcp', 'prompt', 'rest'], connectorSteps: ['Add a custom / remote MCP connector', 'Paste the URL below', 'Sign in to Slates and tap Allow'] },
];

export const METHOD_LABEL: Record<Method, string> = {
  pair: 'One paste',
  connector: 'Connector',
  mcp: 'MCP config',
  'claude-code': 'Claude Code',
  prompt: 'Prompt',
  rest: 'REST',
};

export function snippet(method: Exclude<Method, 'connector' | 'pair'>, origin: string, token: string) {
  const mcp = `${origin}/mcp`;
  switch (method) {
    case 'mcp':
      return {
        hint: 'Add as a remote (Streamable HTTP) MCP server. Field names vary slightly by client.',
        text: JSON.stringify({ mcpServers: { slates: { type: 'http', url: mcp, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
      };
    case 'claude-code':
      return { hint: 'Run once in your terminal.', text: `claude mcp add --transport http slates ${mcp} \\\n  --header "Authorization: Bearer ${token}"` };
    case 'prompt':
      return {
        hint: 'Paste this to the agent. It reads the guide and calls the API itself.',
        text: `Connect to my Slates dashboard. Read ${origin}/llms.txt for how it works, then use the API with the header "Authorization: Bearer ${token}". Start by listing my slates. Keep item ids stable, keep text short (I read it on my phone), and log what you change with log_activity. Only use notify for things that need me now.`,
      };
    case 'rest':
      return {
        hint: `Every tool is POST ${origin}/api/v1/tools/<name>. OpenAPI: ${origin}/api/v1/openapi.json`,
        text: `curl -X POST ${origin}/api/v1/tools/list_slates \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" -d '{}'`,
      };
  }
}

/** The first message to send a newly connected agent, so it knows what Slates is for. */
export const STARTER_MESSAGE = `You're now connected to Slates, my personal dashboard (slates.space). Please use it to keep my life organised:

1. First, list my boards (list_slates) so you know what's there.
2. When I mention tasks, groceries, money, habits, plans or things to remember, update the right board, or create a new one if nothing fits.
3. Set reminders for anything with a time, and keep "today's brief" current when I ask what's on today.
4. Never delete a board or item without asking me, and always tell me what you changed.

Reply with a one-line summary of my boards to confirm it works.`;
