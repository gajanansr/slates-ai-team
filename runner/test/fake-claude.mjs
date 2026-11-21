#!/usr/bin/env node
// Stand-in agent for tests.
//  - Claude mode (called with -p ... --mcp-config FILE): reads Slates details from the config file, like `claude -p`.
//  - Command mode (called with just the prompt): reads SLATES_MCP_URL / SLATES_TOKEN from env, like a `codex exec` wrapper.
// It resolves the task id named in the prompt.
// FAKE_CLAUDE_MODE=fail exits 1 without resolving. FAKE_CLAUDE_RESULT sets the final answer text. FAKE_CLAUDE_SLEEP_MS delays the work (for concurrency tests).

import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = process.argv.slice(2);
const started = Date.now();
fs.writeFileSync("fake-claude-args.json", JSON.stringify(argv));

if (process.env.FAKE_CLAUDE_MODE === "fail") {
  console.error("fake claude: simulated failure");
  process.exit(1);
}

let prompt, url, headers, mcpServers = {};
if (argv.includes("-p")) {
  prompt = argv[argv.indexOf("-p") + 1];
  mcpServers = JSON.parse(fs.readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8")).mcpServers;
  ({ url, headers } = mcpServers.slates);
  fs.writeFileSync("mcp-servers.json", JSON.stringify(Object.keys(mcpServers))); // names only, never the token
} else {
  prompt = argv[0];
  url = process.env.SLATES_MCP_URL;
  headers = { Authorization: `Bearer ${process.env.SLATES_TOKEN}` };
}

const sleepMs = Number(process.env.FAKE_CLAUDE_SLEEP_MS || 0);
if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs));

const id = prompt.match(/resolve_desk_item with id "([^"]+)"/)[1];

// FAKE_CLAUDE_MODE=call: phone someone through the calls MCP server (FAKE_CALL_PHONE overrides the number).
if (process.env.FAKE_CLAUDE_MODE === "call") {
  const a = mcpServers.calls;
  const cc = new Client({ name: "fake-claude", version: "0" });
  await cc.connect(new StdioClientTransport({ command: a.command, args: a.args, env: { ...a.env, PATH: process.env.PATH } }));
  const res = await cc.callTool({ name: "call_person", arguments: { phone: process.env.FAKE_CALL_PHONE || "+91 98765 43210", name: "Ramesh", goal: "Confirm Saturday 8pm dinner for 6" } });
  fs.writeFileSync("call-result.txt", `${res.isError ? "ERROR " : ""}${res.content[0].text}`);
  await cc.close();
}

// FAKE_CLAUDE_MODE=group: coordinate a group of four (FAKE_GROUP_JSON overrides the input).
if (process.env.FAKE_CLAUDE_MODE === "group") {
  const a = mcpServers.calls;
  const gc = new Client({ name: "fake-claude", version: "0" });
  await gc.connect(new StdioClientTransport({ command: a.command, args: a.args, env: { ...a.env, PATH: process.env.PATH } }));
  const input = process.env.FAKE_GROUP_JSON ? JSON.parse(process.env.FAKE_GROUP_JSON) : {
    title: "Saturday dinner",
    question: "Which time works for dinner this weekend?",
    options: ["Sat 8pm", "Sun 1pm"],
    people: [
      { name: "Ramesh", phone: "+919800000001" },
      { name: "Priya", phone: "+919800000002" },
      { name: "Amit", phone: "+919800000003" },
      { name: "Neha", phone: "+919800000004" },
    ],
  };
  const res = await gc.callTool({ name: "coordinate_group", arguments: input });
  fs.writeFileSync("group-result.txt", `${res.isError ? "ERROR " : ""}${res.content[0].text}`);
  await gc.close();
}

// FAKE_CLAUDE_MODE=incident: phone the owner for a decision, like the incident playbook says.
if (process.env.FAKE_CLAUDE_MODE === "incident") {
  const a = mcpServers.calls;
  const dc = new Client({ name: "fake-claude", version: "0" });
  await dc.connect(new StdioClientTransport({ command: a.command, args: a.args, env: { ...a.env, PATH: process.env.PATH } }));
  const res = await dc.callTool({ name: "ask_owner_by_call", arguments: { headline: "Demo site is down", briefing: "The demo site has returned errors for two minutes. Commit abc123 broke the header. We want to revert it.", question: "Should we go ahead and revert it?", options: ["Go ahead", "Wait"] } });
  fs.writeFileSync("decide-result.txt", `${res.isError ? "ERROR " : ""}${res.content[0].text}`);
  fs.writeFileSync("prompt.txt", prompt);
  await dc.close();
  // Then ask for approval to revert, like real Claude sometimes does: it must not ask the owner again.
  if (mcpServers.approvals && /Owner's choice: Go ahead/.test(res.content[0].text)) {
    const ac = new Client({ name: "fake-claude", version: "0" });
    const ap = mcpServers.approvals;
    await ac.connect(new StdioClientTransport({ command: ap.command, args: ap.args, env: { ...ap.env, PATH: process.env.PATH } }));
    const ar = await ac.callTool({ name: "request_approval", arguments: { question: "Revert commit abc123?" } });
    fs.writeFileSync("followup-approval.txt", ar.content[0].text);
    await ac.close();
  }
}

// FAKE_CLAUDE_MODE=approve: ask for approval through the approvals MCP server first, like Claude would.
let approvalAnswer = "";
if (process.env.FAKE_CLAUDE_MODE === "approve") {
  const a = mcpServers.approvals;
  const ac = new Client({ name: "fake-claude", version: "0" });
  await ac.connect(new StdioClientTransport({ command: a.command, args: a.args, env: { ...a.env, PATH: process.env.PATH } }));
  const res = await ac.callTool({ name: "request_approval", arguments: { question: "Book table for 6 at Toit, Sat 8pm, ₹6,000?" } });
  approvalAnswer = res.content[0].text;
  fs.writeFileSync("approval-answer.txt", approvalAnswer);
  await ac.close();
}
const client = new Client({ name: "fake-claude", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
await client.callTool({ name: "resolve_desk_item", arguments: { id, reply: "done by fake agent" } });
await client.callTool({ name: "end_session", arguments: { did: `resolved ${id}` } });
await client.close();

fs.writeFileSync("fake-claude-timing.json", JSON.stringify({ started, ended: Date.now() }));
console.log(JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.01, num_turns: 2, result: process.env.FAKE_CLAUDE_RESULT || (approvalAnswer ? `Done with ${id}. Approval said: ${approvalAnswer}` : `Done with ${id}.`) }));
