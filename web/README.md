# Slates

One board for you and all your AI agents.

A personal HQ as an installable PWA. Agents (Instinct, Claude, Grok, Duet, Dots, Muse, …)
create and update typed sections ("slates") over MCP or REST; you read them on your phone,
tick things off, pin, reorder and archive. Changes appear live.

## Stack

- **Next.js 16** (App Router, Turbopack, `proxy.ts`), React 19, TypeScript 7, Tailwind v4.
- **Supabase**: Postgres + RLS, Auth (Google OAuth + email link/code), Realtime.
- Hosted on **Vercel** (`vercel.json` pins the Next.js preset).

## Architecture

```
 phone / desktop ──cookie session──▶ Next.js (server components, server actions)
                                          │
 agents ──Bearer slt_…──▶ /mcp  (MCP, Streamable HTTP, JSON-RPC)
                          /api/v1/* (REST + OpenAPI)
                                          │  supabase-js, anon key only
                                          ▼
                         public.slates_exec(op, args, token)   SECURITY DEFINER
                         resolves caller → owner, scopes every statement
                                          ▼
                     slates · agents · activity   (RLS: owner reads own rows)
```

- **One write path.** UI and agents both call `slates_exec`. For a signed-in user the
  owner is `auth.uid()`; for an agent it is the owner of the token (stored as sha256).
  Tables have no client write grants at all; the service-role key is never used.
- **Typed slates.** `lib/kinds.ts` defines the kinds (`brief`, `list`, `links`, `metrics`,
  `timeline`, `table`, `markdown`) with zod schemas. Data is validated on write and
  re-validated on render, so a bad agent write degrades to a notice, never a crash.
- **One tool set.** `lib/agent/tools.ts` defines the agent tools once; the MCP server
  (`lib/agent/mcp.ts`) and the REST routes both call them.
- **Optimistic concurrency.** Every slate has a `version`; `patch_items` does
  read-modify-write with `expected_version` and retries, so parallel agents don't clobber
  each other.

## Agent tools

`list_slates`, `get_slate`, `describe_kinds`, `create_slate`, `update_slate`,
`patch_items`, `set_today_brief`, `archive_slate`, `reorder_slates`, `log_activity`,
`recent_activity`.

- MCP: `POST https://www.slates.space/mcp` with `Authorization: Bearer slt_…`
- REST: `POST /api/v1/tools/<name>` (plus resource aliases), OpenAPI at `/api/v1/openapi.json`
- Tokens: create/revoke in the app under **Agents**; the screen shows copy-paste setup
  for MCP clients, Claude Code, curl and a plain-language prompt.

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest: runs the real migrations in PGlite (in-process Postgres)
npm run build
```

Supabase URL and publishable key default to production in `lib/env.ts` (public by design);
override with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Database

Migrations live in `supabase/migrations/`. Apply them in order in the Supabase SQL editor
(or `supabase db push`). `20261103000100_import_money.sql` adds a one-time importer for the
legacy single-row payload; see `HANDOFF.md`.

## Layout

```
app/                 routes: / (landing), (app)/{home,s/[slug],activity,agents,settings}
  api/v1/            agent REST API      mcp/      MCP endpoint
  auth/              callback + signout  sw.js/    generated service worker
components/          UI (slate renderers, shell, sheets)
lib/                 kinds, slates service, agent tools, supabase clients
proxy.ts             session refresh + route gating
supabase/migrations  schema, RLS, functions
tests/               DB isolation, service and MCP tests
```

License: MIT (see LICENSE).
