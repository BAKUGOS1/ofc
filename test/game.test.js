import test from "node:test";
import assert from "node:assert/strict";
import { player, room, action, tick, view } from "../lib/game.js";
function setup(n = 5) {
  const host = player("Host");
  const r = room("TEST23", host);
  for (let i = 1; i < n; i++) r.players.push(player(`Player ${i}`));
  r.players.forEach((p) => action(r, p.id, "ready"));
  action(r, host.id, "start");
  return r;
}
function voting(r) {
  r.players.forEach((p) => action(r, p.id, "revealed"));
  while (r.phase === "clues") action(r, r.hostId, "clue-done");
  action(r, r.hostId, "open-vote");
}
test("secret views never expose another word, token or role", () => {
  const r = setup();
  for (const p of r.players) {
    const s = view(r, p.id);
    assert.equal(s.word, p.word);
    assert.equal(s.solution, null);
    assert.equal("spyId" in s, false);
    for (const x of s.players) {
      assert.equal("word" in x, false);
      assert.equal("token" in x, false);
    }
  }
  assert.equal(r.players.filter((p) => p.word === r.words[1]).length, 1);
});
test("readiness, host rights and turn validation", () => {
  const h = player("Host"),
    r = room("TEST23", h);
  assert.throws(() => action(r, h.id, "start"), /4–10/);
  for (let i = 0; i < 3; i++) r.players.push(player(`User ${i}`));
  assert.throws(() => action(r, h.id, "start"), /ready/);
  r.players.forEach((p) => action(r, p.id, "ready"));
  assert.throws(() => action(r, r.players[1].id, "start"), /host/);
  action(r, h.id, "start");
  r.players.forEach((p) => action(r, p.id, "revealed"));
  const other = r.players.find((p) => p.id !== r.order[0] && p.id !== r.hostId);
  assert.throws(() => action(r, other.id, "clue-done"), /turn/);
});
test("civilians win by eliminating Undercover; points awarded once", () => {
  const r = setup();
  voting(r);
  const spy = r.players.find((p) => p.id === r.spyId);
  for (const p of r.players) {
    action(r, p.id, "vote", {
      target: p === spy ? r.players.find((x) => x !== spy).id : spy.id,
    });
  }
  assert.equal(r.phase, "finished");
  assert.equal(r.winner, "civilians");
  assert.equal(spy.score, 0);
  assert.ok(r.players.filter((p) => p !== spy).every((p) => p.score === 1));
  assert.equal(view(r, spy.id).solution.spyId, spy.id);
  assert.throws(() => action(r, r.hostId, "open-vote"));
});
test("Undercover wins by surviving to final three", () => {
  const r = setup(4);
  voting(r);
  const target = r.players.find((p) => p.id !== r.spyId);
  for (const p of r.players)
    action(r, p.id, "vote", {
      target: p === target ? r.players.find((x) => x !== p).id : target.id,
    });
  assert.equal(r.phase, "finished");
  assert.equal(r.winner, "undercover");
  assert.equal(r.players.find((p) => p.id === r.spyId).score, 1);
});
test("one runoff then nobody eliminated after repeated tie; self and duplicate votes rejected", () => {
  const r = setup(4);
  voting(r);
  const [a, b, c, d] = r.players;
  assert.throws(() => action(r, a.id, "vote", { target: a.id }), /another/);
  action(r, a.id, "vote", { target: b.id });
  assert.throws(() => action(r, a.id, "vote", { target: c.id }), /locked/);
  action(r, b.id, "vote", { target: a.id });
  action(r, c.id, "vote", { target: a.id });
  action(r, d.id, "vote", { target: b.id });
  assert.equal(r.runoff, true);
  assert.deepEqual(new Set(r.candidates), new Set([a.id, b.id]));
  action(r, a.id, "vote", { target: b.id });
  action(r, b.id, "vote", { target: a.id });
  action(r, c.id, "vote", { target: a.id });
  action(r, d.id, "vote", { target: b.id });
  assert.equal(r.phase, "result");
  assert.equal(r.lastResult.eliminated, null);
  assert.equal(r.players.filter((p) => p.alive).length, 4);
  action(r, r.hostId, "next");
  assert.equal(r.round, 2);
});
test("timers progress clues and discussion, including disconnected players", () => {
  const r = setup();
  r.players.forEach((p) => action(r, p.id, "revealed"));
  assert.equal(tick(r, r.deadline - 1), false);
  tick(r, r.deadline);
  assert.equal(r.turn, 1);
  while (r.phase === "clues") tick(r, r.deadline);
  assert.equal(r.phase, "discussion");
  tick(r, r.deadline);
  assert.equal(r.phase, "voting");
  tick(r, r.deadline);
  assert.equal(r.runoff, true);
  tick(r, r.deadline);
  assert.equal(r.phase, "result");
});
test("settings validate input and reset readiness; canceled games award no points", () => {
  const r = setup();
  action(r, r.hostId, "cancel");
  action(r, r.hostId, "ready");
  assert.throws(() =>
    action(r, r.hostId, "settings", { pack: "__proto__", seconds: 45 }),
  );
  action(r, r.hostId, "settings", { pack: "hinglish", seconds: 30 });
  assert.ok(r.players.every((p) => !p.ready));
  assert.ok(r.players.every((p) => p.score === 0));
  assert.equal(view(r, r.hostId).word, null);
});

test("an abandoned reveal moves to clues after two minutes", () => {
  const r = setup();
  assert.equal(r.phase, "reveal");
  assert.ok(r.deadline);
  tick(r, r.deadline);
  assert.equal(r.phase, "clues");
  assert.equal(r.round, 1);
});
