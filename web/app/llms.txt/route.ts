import { TOOLS, SERVER_INSTRUCTIONS } from '@/lib/agent/tools';
import { ALL_KIND_SCHEMAS as KIND_SCHEMAS, EXAMPLES, SLATE_KINDS, COLLECTION_KEY } from '@/lib/kinds';

/** Public, secret-free guide for agents (llms.txt convention). Generated from the real tool set. */
export function GET(req: Request) {
  const o = new URL(req.url).origin;
  const tools = TOOLS.map((t) => `- ${t.name}${t.readOnly ? ' (read)' : ''}: ${t.description}`).join('\n');
  const kinds = SLATE_KINDS.map(
    (k) =>
      `### ${k}\n${KIND_SCHEMAS[k].description}${COLLECTION_KEY[k] ? ` Items live in "${COLLECTION_KEY[k]}".` : ''}\nExample data: ${JSON.stringify(EXAMPLES[k])}`,
  ).join('\n\n');
  const body = `# Slates

> Slates is a shared workspace (one board) for you and all your AI agents: agentic notes, docs, tasks, reminders, habits, goals, tables and charts, with an MCP server and REST API. Invite-only; waitlist at ${o}/waitlist.
> ${SERVER_INSTRUCTIONS.split('\n')[0]}

## Connect
- MCP (Streamable HTTP): ${o}/mcp
  - OAuth 2.1 connectors (claude.ai, ChatGPT, Grok, Duet): just add the URL; discovery at ${o}/.well-known/oauth-protected-resource/mcp
  - Or send "Authorization: Bearer slt_..." (token from the user's Slates -> Agents screen)
- Self-pairing (no token to copy; use this if you have no connector and the user has not given you a token):
  1. POST ${o}/api/v1/pair with {"name": "<your name>"}. You get user_code, verification_url_complete and device_secret.
  2. Tell the user to open verification_url_complete and press Allow (they sign in to Slates and pick access).
  3. POST ${o}/api/v1/pair/poll with {"device_secret": "..."} every 3 seconds until status is "approved". The reply holds your token, shown once. Store it in your own memory or vault, then send it as "Authorization: Bearer <token>".
  Codes last 10 minutes. status "denied" or "expired" means stop and tell the user.
- REST: POST ${o}/api/v1/tools/<tool_name> with the tool arguments as a JSON body, same Bearer header. Responses are {"data": ...} or {"error": {"code", "message"}}.
- OpenAPI 3.1: ${o}/api/v1/openapi.json

## How to work
${SERVER_INSTRUCTIONS}
- Call describe_kinds for exact JSON schemas before writing new data.
- Prefer patch_items (merge by item id) over replacing whole slates.
- update_slate with data replaces the whole slate and requires expected_version (the version from get_slate); update_note with body requires expected_version (board_version from get_note). A 409 means someone changed it: re-read, re-apply your change, retry. patch_items and append merge without a version.
- Links must be http(s) or mailto.

## Customization
- Dashboards: set_layout changes order, size (s|m|l|xl), view (auto|ring|bars|heatmap|dots|compact), hidden, section and the overall look (cards|compact|focus) without touching data.
- App: the bottom bar is the same for everyone: Today (generated: what needs the user, what changed and who changed it, what is coming up), the Ask bar, and Apps (every feature, then the user's shortcuts). set_app_layout changes the shortcuts (pins: boards or notes, up to 12) and the colour (palette, or accent: one hex colour). Spaces group boards by category and notes by a tag with the same name.
- Start every conversation with get_about_me (memory shared by all the user's agents; add to it with remember) and check_desk (instructions the user left, answers to questions asked with ask_user, decisions on approvals). archive_slate and delete_note wait for the user's approval.

## Tools
${tools}

## Slate kinds
${kinds}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
