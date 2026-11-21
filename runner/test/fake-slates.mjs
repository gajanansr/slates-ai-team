// A tiny stand-in for the Slates MCP server, for end-to-end tests.
// Implements check_desk, resolve_desk_item, log_activity, end_session, ask_user.

import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// tokens: { "<token>": "<agent name>" }. check_desk only shows handoffs for that agent (or untagged).
// failTools: tool names that always return an error (to test best-effort writes).
export async function startFakeSlates({ token = "slt_test", tokens = null, desk = {}, failTools = [] } = {}) {
  tokens = tokens || { [token]: "Claude" };
  const calls = []; // every tool call, in order: { name, args, agent }
  let handoffSeq = 0;
  const boards = {}; // slug → data, updated by create_slate / patch_items
  const state = {
    instructions: desk.instructions || [],
    handoffs: desk.handoffs || [],
    answers: desk.answers || [],
  };

  function buildServer(agent) {
    const server = new McpServer({ name: "fake-slates", version: "0.0.1" });
    const json = (v) => ({ content: [{ type: "text", text: JSON.stringify(v) }] });
    const realRegister = server.registerTool.bind(server);
    server.registerTool = (name, def, fn) => realRegister(name, def, failTools.includes(name)
      ? async (args) => { calls.push({ name, args, agent, failed: true }); return { content: [{ type: "text", text: `${name} is down` }], isError: true }; }
      : fn);

    server.registerTool("check_desk", { description: "desk" }, async () => {
      calls.push({ name: "check_desk", args: {}, agent });
      // Like real Slates: an agent never sees handoffs it sent itself.
      const mine = (x) => (!x.to || x.to.toLowerCase() === agent.toLowerCase()) && x.from !== agent;
      return json({ ...state, handoffs: state.handoffs.filter(mine), waiting_on_user: [], last_sessions: [] });
    });
    server.registerTool(
      "resolve_desk_item",
      { description: "resolve", inputSchema: { id: z.string(), reply: z.string().optional() } },
      async (args) => {
        calls.push({ name: "resolve_desk_item", args, agent });
        state.handoffs = state.handoffs.filter((h) => h.id !== args.id);
        state.instructions = state.instructions.filter((i) => i.id !== args.id);
        return json({ ok: true });
      },
    );
    server.registerTool(
      "hand_off",
      { description: "hand off", inputSchema: { task: z.string(), to: z.string().optional(), context: z.string().optional() } },
      async (args) => {
        calls.push({ name: "hand_off", args, agent });
        const id = `h-${++handoffSeq}`;
        state.handoffs.push({ id, from: agent, to: args.to, task: args.task, context: args.context });
        return json({ ok: true, id });
      },
    );
    server.registerTool(
      "create_slate",
      { description: "board", inputSchema: { title: z.string(), kind: z.string(), data: z.record(z.string(), z.any()), slug: z.string().optional(), icon: z.string().optional(), category: z.string().optional(), pinned: z.boolean().optional(), note: z.string().optional() } },
      async (args) => {
        calls.push({ name: "create_slate", args, agent });
        const slug = args.slug || "board";
        boards[slug] = structuredClone(args.data);
        return json({ slug, url: `https://slates.test/s/${slug}` });
      },
    );
    server.registerTool(
      "patch_items",
      { description: "patch", inputSchema: { slug: z.string(), upsert: z.array(z.record(z.string(), z.any())).optional(), remove: z.array(z.string()).optional(), note: z.string().optional() } },
      async (args) => {
        calls.push({ name: "patch_items", args, agent });
        const b = boards[args.slug];
        if (!b) return { content: [{ type: "text", text: "no such slate" }], isError: true };
        const key = b.rows ? "rows" : "items";
        for (const u of args.upsert || []) {
          const i = b[key].findIndex((r) => r.id === u.id);
          if (i >= 0) b[key][i] = { ...b[key][i], ...u }; else b[key].push(u);
        }
        if (args.remove?.length) b[key] = b[key].filter((r) => !args.remove.includes(r.id));
        return json({ ok: true });
      },
    );
    server.registerTool(
      "add_note",
      { description: "note", inputSchema: { title: z.string(), body: z.string(), id: z.string().optional(), tags: z.array(z.string()).optional() } },
      async (args) => {
        calls.push({ name: "add_note", args, agent });
        return json({ id: args.id, url: `https://slates.test/notes/${args.id}` });
      },
    );
    for (const name of ["log_activity", "end_session", "ask_user"]) {
      server.registerTool(name, { description: name, inputSchema: { message: z.string().optional(), text: z.string().optional(), did: z.string().optional(), note: z.string().optional() } }, async (args) => {
        calls.push({ name, args, agent });
        return json({ ok: true });
      });
    }
    return server;
  }

  const httpServer = http.createServer(async (req, res) => {
    const agent = tokens[(req.headers.authorization || "").replace(/^Bearer /, "")];
    if (!agent) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const server = buildServer(agent);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); // stateless
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
  });

  await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
  const { port } = httpServer.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    calls,
    state,
    boards,
    addHandoff: (h) => state.handoffs.push(h),
    close: () => new Promise((r) => { httpServer.closeAllConnections?.(); httpServer.close(r); }),
  };
}
