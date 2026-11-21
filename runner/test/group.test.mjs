import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGroup, tally, maskPhone, boardData, boardRow, groupApprovalDetails, groupSummaryNote } from "../group.mjs";

const two = [{ name: "A", phone: "+911111111111" }, { name: "B", phone: "+912222222222" }];

test("validateGroup catches bad input with clear reasons", () => {
  assert.equal(validateGroup({ question: "q", options: ["a", "b"], people: two }).reason, "title is required");
  assert.equal(validateGroup({ title: "t", question: "q", options: ["a"], people: two }).reason, "give 2 to 5 options");
  assert.equal(validateGroup({ title: "t", question: "q", options: ["a", "a"], people: two }).reason, "give 2 to 5 options"); // duplicates removed
  assert.equal(validateGroup({ title: "t", question: "q", options: ["a", "b"], people: [two[0]] }).reason, "a group needs at least 2 people");
  assert.match(validateGroup({ title: "t", question: "q", options: ["a", "b"], people: [two[0], { name: "C", phone: "12345" }] }).reason, /^C: phone must include the country code/);
  assert.match(validateGroup({ title: "t", question: "q", options: ["a", "b"], people: [two[0], { ...two[0], name: "Z" }] }).reason, /listed twice/);
  assert.match(validateGroup({ title: "t", question: "q", options: ["a", "b"], people: Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, phone: `+9100000000${i}` })) }, { maxPeople: 8 }).reason, /at most 8/);
  const ok = validateGroup({ title: " t ", question: "q", options: ["a", "b"], people: two });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.people.map((p) => p.id), ["p1", "p2"]);
});

test("tally: winner, tie, nobody", () => {
  assert.deepEqual(tally(["a", "a", "b", null], ["a", "b"]), { counts: { a: 2, b: 1 }, winner: "a", tie: false });
  assert.deepEqual(tally(["a", "b"], ["a", "b"]), { counts: { a: 1, b: 1 }, winner: null, tie: true });
  assert.deepEqual(tally([null, "x"], ["a", "b"]), { counts: { a: 0, b: 0 }, winner: null, tie: false });
});

test("the shared board never shows full phone numbers", () => {
  assert.equal(maskPhone("+919876543210"), "••••3210");
  const d = boardData([{ id: "p1", name: "A", phone: "+919876543210" }]);
  assert.equal(d.rows[0].cells.phone, "••••3210");
  assert.equal(d.columns.length, 4);
  assert.deepEqual(boardRow({ id: "p1", name: "A", phone: "+91123456" }, "answered", "a").cells, { person: "A", phone: "••••3456", status: "answered", answer: "a" });
});

test("the owner sees full numbers in the approval, and the note reads well", () => {
  assert.match(groupApprovalDetails({ question: "q?", people: [{ name: "A", phone: "+911111111111" }] }), /• A \+911111111111/);
  const n = groupSummaryNote({ title: "Dinner", question: "q", options: ["a", "b"], people: [{ id: "p1", name: "A" }],
    results: { p1: { answer: "a", confirmed: true } }, result: { counts: { a: 1, b: 0 }, winner: "a", tie: false }, boardUrl: "u" });
  assert.match(n.body, /## Decision\n\*\*a\*\*/);
  assert.match(n.body, /- \*\*A\*\*: a ✓ confirmed/);
});
