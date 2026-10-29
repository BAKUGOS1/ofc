import test from "node:test";
import assert from "node:assert/strict";
import { createGameServer } from "../server.js";
import { GameService, phaseKey } from "../lib/service.js";
import { MemoryStore, RedisStore, getStore } from "../lib/store.js";
const id = () => crypto.randomUUID();
async function setup(n = 4) {
  const store = new MemoryStore();
  const services = [new GameService(store), new GameService(store)];
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const result = await services[i % 2].command(
      {
        type: i ? "join" : "create",
        data: { name: `Person ${i}`, code: sessions[0]?.code },
      },
      "test",
    );
    sessions.push(result.session);
  }
  const code = sessions[0].code;
  async function send(i, type, data = {}, requestId = id(), override = {}) {
    const r = await store.get(code);
    return services[i % 2].command(
      {
        type,
        ...sessions[i],
        data,
        phaseKey: phaseKey(r),
        requestId,
        ...override,
      },
      "test",
    );
  }
  return { store, services, sessions, code, send, read: () => store.get(code) };
}
test("shared state across independent services, concurrent readiness and vote updates", async () => {
  const { send, read, sessions } = await setup();
  await Promise.all(sessions.map((_, i) => send(i, "ready")));
  assert.ok((await read()).players.every((p) => p.ready));
  await send(0, "start");
  await Promise.all(sessions.map((_, i) => send(i, "revealed")));
  let r = await read();
  assert.equal(r.phase, "clues");
  for (let i = 0; i < 4; i++) await send(0, "clue-done");
  await send(0, "open-vote");
  r = await read();
  await Promise.all(
    sessions.map((_, i) =>
      send(i, "vote", {
        target:
          r.players[i].id === r.spyId
            ? r.players.find((p) => p.id !== r.spyId).id
            : r.spyId,
      }),
    ),
  );
  r = await read();
  assert.equal(r.phase, "finished");
  assert.equal(r.winner, "civilians");
  assert.ok(
    r.players.filter((p) => p.id !== r.spyId).every((p) => p.score === 1),
  );
  await send(0, "lobby");
  assert.equal((await read()).phase, "lobby");
});
test("idempotent actions and stale phase clicks cannot skip two speakers", async () => {
  const { send, read, sessions } = await setup();
  const requestId = id();
  await send(0, "ready", {}, requestId);
  await send(0, "ready", {}, requestId);
  assert.equal((await read()).players[0].ready, true);
  for (let i = 1; i < 4; i++) await send(i, "ready");
  await send(0, "start");
  for (let i = 0; i < 4; i++) await send(i, "revealed");
  const oldKey = phaseKey(await read());
  await send(0, "clue-done");
  await assert.rejects(
    send(0, "clue-done", {}, id(), { phaseKey: oldKey }),
    /moved on/,
  );
  assert.equal((await read()).turn, 1);
  assert.equal(sessions.length, 4);
});
test("refresh retains identity; presence timeout transfers host", async () => {
  const { send, read, store, code } = await setup();
  const original = (await send(1, "resume")).state.me;
  assert.equal((await send(1, "resume")).state.me, original);
  let r = await read();
  r.players[0].seen = Date.now() - 60000;
  await store.cas(code, r.version, { ...r, version: r.version + 1 });
  assert.equal((await send(1, "sync")).state.hostId, original);
  await send(1, "kick", { target: (await read()).players[0].id });
  assert.equal((await read()).players.length, 3);
});
test("invalid tokens and private state never reveal secrets", async () => {
  const { send, read, services, sessions } = await setup();
  await assert.rejects(
    services[0].command({ type: "sync", code: sessions[0].code, token: id() }),
    /expired/,
  );
  for (let i = 0; i < 4; i++) await send(i, "ready");
  await send(0, "start");
  const a = (await send(1, "sync")).state;
  assert.ok(a.word);
  assert.equal(a.solution, null);
  assert.ok(a.players.every((p) => !p.token && !p.word && !p.seen));
  assert.equal(
    JSON.stringify(a).includes((await read()).players[0].token),
    false,
  );
});
test("HTTP routes, origin guard, QR and request size limit", async () => {
  const server = createGameServer();
  await new Promise((r) => server.http.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.http.address().port}`;
  try {
    const post = (payload, headers = {}) =>
      fetch(`${base}/api/game`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const create = await post({ type: "create", data: { name: "Host" } });
    const result = await create.json();
    assert.ok(result.session.token);
    assert.match(create.headers.get("cache-control"), /no-store/);
    assert.match(
      await (await fetch(`${base}/api/qr?room=${result.session.code}`)).text(),
      /<svg/,
    );
    assert.equal((await fetch(`${base}/lib/words.js`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal(
      (
        await post(
          { type: "create", data: { name: "Evil" } },
          { Origin: "https://elsewhere.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await post({ type: "create", data: { name: "A".repeat(5000) } })).status,
      413,
    );
  } finally {
    await server.close();
  }
});
test("Redis store uses NX creation, CAS and TTL; production refuses ephemeral rooms", async () => {
  let saved, evalCall;
  const fake = {
    set: async (k, v, opts) => {
      saved = { k, v, opts };
      return "OK";
    },
    get: async () => saved?.v,
    eval: async (...args) => {
      evalCall = args;
      return 1;
    },
  };
  const store = new RedisStore(fake, "test");
  assert.equal(await store.create("ABC234", { version: 1 }), true);
  assert.deepEqual(saved.opts, { nx: true, ex: 7200 });
  assert.equal(await store.cas("ABC234", 1, { version: 2 }), true);
  assert.match(evalCall[0], /cjson.decode/);
  assert.equal(evalCall[2][0], 1);
  assert.equal(evalCall[2][2], 7200);
  assert.throws(() => getStore({ VERCEL: "1" }), /not configured/);
});

test("missing storage has a stable error code without exposing credentials", async () => {
  const { storageFailure } = await import("../lib/http.js");
  const { StorageSetupError } = await import("../lib/store.js");
  const missing = storageFailure(new StorageSetupError());
  assert.equal(missing.code, "STORAGE_NOT_CONFIGURED");
  assert.match(missing.error, /host/);
  const unavailable = storageFailure(
    new Error("secret-provider-url-and-token"),
  );
  assert.equal(unavailable.code, "STORAGE_UNAVAILABLE");
  assert.equal(JSON.stringify(unavailable).includes("secret-provider"), false);
});
