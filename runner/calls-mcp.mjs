#!/usr/bin/env node
// Local MCP server (stdio) giving the agent one tool: call_person.
// The runner does the real work and enforces the rules (owner approval, quiet hours,
// call limits, AI disclosure, transcript saved to Slates).
//
// Env (set by the runner): CALLS_URL, CALLS_SECRET, SLATES_TASK_ID.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const { CALLS_URL, GROUP_URL, DECIDE_URL, GEMINI_URL, CALLS_SECRET, SLATES_TASK_ID = "" } = process.env;

async function post(url, input) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${CALLS_SECRET}` }, body: JSON.stringify({ ...input, taskId: SLATES_TASK_ID }) });
  return res.json();
}
const server = new McpServer({ name: "calls", version: "0.1.0" });

server.registerTool(
  "call_person",
  {
    description:
      "Phone a person on the owner's behalf and have a short voice conversation toward one goal. " +
      "The owner must approve each call on their phone first; the callee is told it's an AI. " +
      "Returns the outcome and transcript; the transcript is also saved to Slates Notes.",
    inputSchema: {
      phone: z.string().describe("Number with country code, e.g. +919876543210"),
      name: z.string().max(80).optional().describe("Who you are calling"),
      goal: z.string().min(5).max(250).describe("What the call must achieve, e.g. 'Confirm Saturday 8pm dinner for 6 and ask about veg options'"),
      notes: z.string().max(1000).optional().describe("Facts the voice agent may use: budget, dates, what not to agree to"),
    },
  },
  async (input) => {
    try {
      const res = await fetch(CALLS_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${CALLS_SECRET}` },
        body: JSON.stringify({ ...input, taskId: SLATES_TASK_ID }),
      });
      const r = await res.json();
      if (r.error) return { content: [{ type: "text", text: `Call not made: ${r.error}` }], isError: true };
      const transcript = (r.transcript || []).map((l) => `${l.speaker}: ${l.text}`).join("\n");
      const text = [
        `Call status: ${r.status}`,
        `Outcome: ${r.summary}`,
        r.noteUrl ? `Saved to Slates: ${r.noteUrl}` : "",
        transcript ? `\nTranscript:\n${transcript}` : "",
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Call not made: ${err.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "coordinate_group",
  {
    description:
      "Get a group of people to agree on one option by phone. Calls each person, asks the question, records answers on a live " +
      "Slates board, retries anyone who didn't pick up once, picks the most-chosen option and calls back to confirm it. " +
      "The owner approves the whole list first. Returns the decision, vote counts and each person's answer. Can take several minutes.",
    inputSchema: {
      title: z.string().min(3).max(100).describe("e.g. 'Saturday dinner'"),
      question: z.string().min(5).max(200).describe("What to ask each person, e.g. 'Which time works for dinner this Saturday?'"),
      options: z.array(z.string().min(1).max(60)).min(2).max(5).describe("The choices, e.g. ['Sat 8pm', 'Sun 1pm']"),
      people: z.array(z.object({ name: z.string().min(1).max(60), phone: z.string() })).min(2).max(20),
      confirm: z.boolean().optional().describe("Call back to confirm the winning option (default true)"),
    },
  },
  async (input) => {
    try {
      const res = await fetch(GROUP_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${CALLS_SECRET}` },
        body: JSON.stringify({ ...input, taskId: SLATES_TASK_ID }),
      });
      const r = await res.json();
      if (r.error) return { content: [{ type: "text", text: `Group not coordinated: ${r.error}` }], isError: true };
      const decision = r.winner ? `Decision: ${r.winner}` : r.tie ? "Decision: tie, ask the owner to choose" : "Decision: none, nobody picked an option";
      const votes = Object.entries(r.counts).map(([o, n]) => `${o}: ${n}`).join(", ");
      const people = r.people.map((p) => `- ${p.name}: ${p.answer || p.status}${p.confirmed ? " (confirmed)" : ""}`).join("\n");
      return { content: [{ type: "text", text: `${decision}\nVotes: ${votes}\n${people}${r.boardUrl ? `\nBoard: ${r.boardUrl}` : ""}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Group not coordinated: ${err.message}` }], isError: true };
    }
  },
);

server.registerTool(
  "ask_owner_by_call",
  {
    description:
      "Phone the owner yourself when you need their decision now (an outage, something urgent). A voice assistant briefs them " +
      "in plain words and asks your question; returns the option they chose and the transcript. If they don't pick up, they get " +
      "Yes/No buttons on Telegram instead. Act only on the returned choice.",
    inputSchema: {
      headline: z.string().min(3).max(80).describe("A few words, e.g. 'Sahayak is down'"),
      briefing: z.string().min(10).max(600).describe("Spoken briefing, plain English, under 60 words: what happened, since when, likely cause, what you want to do"),
      question: z.string().min(5).max(200).describe("e.g. 'Should we go ahead and revert it?'"),
      options: z.array(z.string().min(1).max(40)).min(2).max(4).describe("e.g. ['Go ahead', 'Wait']. The first option means yes."),
      team_says: z.array(z.object({
        agent: z.enum(["Claude", "Gemini"]),
        says: z.string().min(5).max(450).describe("What this agent says on the call, first person, spoken English, under 50 words"),
      })).max(2).optional().describe("Your team speaks on the call in their own voices before Slates asks the question: Claude's finding, Gemini's verdict."),
    },
  },
  async (input) => {
    try {
      const r = await post(DECIDE_URL, input);
      if (r.error) return { content: [{ type: "text", text: `No decision: ${r.error}` }], isError: true };
      const transcript = (r.transcript || []).map((l) => `${l.speaker}: ${l.text}`).join("\n");
      return { content: [{ type: "text", text: `Owner's choice: ${r.choice || "NONE (do not act)"}\nHow: ${r.via}\n${r.noteUrl ? `Saved: ${r.noteUrl}\n` : ""}${transcript ? `\nTranscript:\n${transcript}` : ""}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `No decision: ${err.message}` }], isError: true };
    }
  },
);

if (GEMINI_URL) {
  server.registerTool(
    "ask_gemini",
    {
      description: "Get an independent second opinion from Google Gemini. Give it the question and all the evidence (errors, diffs, logs); it can't see anything else.",
      inputSchema: {
        question: z.string().min(5).max(500),
        evidence: z.string().max(20000).describe("Everything Gemini needs to judge: error output, commit diffs, your hypothesis"),
      },
    },
    async (input) => {
      try {
        const r = await post(GEMINI_URL, input);
        if (r.error) return { content: [{ type: "text", text: `Gemini unavailable: ${r.error}` }], isError: true };
        return { content: [{ type: "text", text: `Gemini (${r.model}) says:\n${r.answer}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Gemini unavailable: ${err.message}` }], isError: true };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
