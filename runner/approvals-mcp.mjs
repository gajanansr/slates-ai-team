#!/usr/bin/env node
// Local MCP server (stdio) started by the agent for one task. Gives it one tool:
// request_approval, which asks the owner on Telegram (Yes/No buttons) through the
// runner and waits for the answer. No answer in time counts as NO.
//
// Env (set by the runner): APPROVAL_URL, APPROVAL_SECRET, SLATES_TASK_ID.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const { APPROVAL_URL, APPROVAL_SECRET, SLATES_TASK_ID = "" } = process.env;

const server = new McpServer({ name: "approvals", version: "0.1.0" });

server.registerTool(
  "request_approval",
  {
    description:
      "Ask the owner for a yes/no decision on their phone (Telegram) and wait for the answer. " +
      "Use before anything risky or hard to undo: contacting people, spending money, booking, deleting, deploying. " +
      "Returns APPROVED, DECLINED, or NO ANSWER (treat NO ANSWER as declined).",
    inputSchema: {
      question: z.string().min(3).max(300).describe("One clear yes/no question, e.g. 'Book table for 6 at Toit, Sat 8pm, ₹6,000?'"),
      details: z.string().max(700).optional().describe("Short extra context the owner needs to decide."),
    },
  },
  async ({ question, details }) => {
    try {
      const res = await fetch(APPROVAL_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${APPROVAL_SECRET}` },
        body: JSON.stringify({ question, details, taskId: SLATES_TASK_ID }),
      });
      const { answer, error } = await res.json();
      if (error) return { content: [{ type: "text", text: `Could not ask the owner: ${error}. Treat as declined.` }], isError: true };
      const text = answer === "yes" ? "APPROVED by the owner." : answer === "no" ? "DECLINED by the owner. Do not do it." : "NO ANSWER in time. Treat as declined; do not do it.";
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Could not ask the owner: ${err.message}. Treat as declined.` }], isError: true };
    }
  },
);

await server.connect(new StdioServerTransport());
