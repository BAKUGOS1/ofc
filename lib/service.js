import { randomInt, createHash } from "node:crypto";
import { player, room, action, tick, view, GameError } from "./game.js";
const requireValue = (ok, message) => {
  if (!ok) throw new GameError(message);
};
const codeValid = (c) => typeof c === "string" && /^[A-Z2-9]{6}$/.test(c);
const tokenValid = (t) => typeof t === "string" && /^[\da-f-]{36}$/.test(t);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function advance(r, now) {
  for (const p of r.players) p.connected = now - (p.seen || 0) < 45000;
  if (!r.players.some((p) => p.id === r.hostId && p.connected))
    r.hostId = r.players.find((p) => p.connected)?.id || r.hostId;
  // Timers are advanced by requests, not a background process. Inactive rooms pause
  // at the next phase instead of simulating an entire game with nobody present.
  tick(r, now);
}
export class GameService {
  constructor(store) {
    this.store = store;
  }
  async command(payload, identity = "local") {
    requireValue(
      payload &&
        typeof payload === "object" &&
        typeof payload.type === "string",
      "Invalid request.",
    );
    const { type } = payload;
    const data =
      payload.data && typeof payload.data === "object" ? payload.data : {};
    const code = String(payload.code || data.code || "")
      .toUpperCase()
      .trim();
    const token = payload.token;
    const requestId = payload.requestId;
    const bucket = createHash("sha256")
      .update(String(identity))
      .digest("hex")
      .slice(0, 32);
    if (type === "create" || type === "join")
      requireValue(
        await this.store.rate(`entry:${bucket}`, 30, 60),
        "Too many attempts. Try again in a minute.",
      );
    if (type === "create") {
      const p = player(data.name);
      p.seen = Date.now();
      for (let n = 0; n < 5; n++) {
        const c = Array.from(
          { length: 6 },
          () => alphabet[randomInt(alphabet.length)],
        ).join("");
        const r = room(c, p);
        r.version = 1;
        r.receipts = [];
        if (await this.store.create(c, r))
          return {
            ok: true,
            session: { code: c, token: p.token },
            state: view(r, p.id),
            serverTime: Date.now(),
          };
      }
      throw new GameError("Could not create a room. Try again.");
    }
    requireValue(codeValid(code), "Enter a valid six-character room code.");
    if (type !== "join")
      requireValue(
        tokenValid(token),
        "Your session has expired. Join the room again.",
      );
    // Shared across instances; sync is limited per session, commands per identity.
    if (type === "sync")
      requireValue(
        await this.store.rate(`sync:${code}:${token}`, 90, 60),
        "Too many sync requests.",
      );
    if (type !== "sync")
      requireValue(
        await this.store.rate(`action:${bucket}`, 120, 60),
        "Too many actions. Please wait a moment.",
      );
    for (let attempt = 0; attempt < 12; attempt++) {
      const r = await this.store.get(code);
      requireValue(
        r,
        "Room not found or expired. Ask the host for a new invite.",
      );
      const before = JSON.stringify(r),
        now = Date.now();
      advance(r, now);
      let p = r.players.find((p) => p.token === token);
      if (type === "join") {
        requireValue(
          r.phase === "lobby",
          "Game in progress. Join when the next lobby opens.",
        );
        requireValue(r.players.length < 10, "This room is full (10 players).");
        p = player(data.name);
        requireValue(
          !r.players.some((x) => x.name.toLowerCase() === p.name.toLowerCase()),
          "That name is taken. Try another one.",
        );
        p.seen = now;
        r.players.push(p);
        if (!r.players.some((x) => x.id === r.hostId)) r.hostId = p.id;
      } else {
        requireValue(p, "Your session has expired or the host removed you.");
        if (now - (p.seen || 0) > 12000) p.seen = now;
        p.connected = true;
        if (!r.players.some((x) => x.id === r.hostId && x.connected))
          r.hostId = p.id;
        const duplicate =
          typeof requestId === "string" &&
          r.receipts?.includes(`${p.id}:${requestId}`);
        if (type !== "sync" && type !== "resume" && !duplicate) {
          requireValue(
            typeof requestId === "string" &&
              requestId.length >= 8 &&
              requestId.length <= 80,
            "Missing action ID. Refresh and try again.",
          );
          // Prevent an old click from affecting a new round/turn after a timeout.
          requireValue(
            payload.phaseKey === phaseKey(r),
            "The game moved on. Your screen has been updated.",
          );
          if (type === "leave") {
            requireValue(
              r.phase === "lobby",
              "Finish the game or ask the host to end it before leaving.",
            );
            r.players = r.players.filter((x) => x !== p);
            if (r.hostId === p.id)
              r.hostId =
                r.players.find((x) => x.connected)?.id || r.players[0]?.id;
          } else if (type === "kick") {
            requireValue(
              p.id === r.hostId && r.phase === "lobby",
              "Only the host can remove players in the lobby.",
            );
            requireValue(
              data.target !== p.id &&
                r.players.some((x) => x.id === data.target),
              "Choose another player.",
            );
            r.players = r.players.filter((x) => x.id !== data.target);
          } else action(r, p.id, type, data);
          r.receipts = [...(r.receipts || []), `${p.id}:${requestId}`].slice(
            -80,
          );
        }
      }
      const response = () => ({
        ok: true,
        ...(type === "join" ? { session: { code, token: p.token } } : {}),
        state: type === "leave" ? null : view(r, p.id),
        serverTime: now,
      });
      if (JSON.stringify(r) === before) return response();
      const version = r.version;
      r.version++;
      r.updated = now;
      if (await this.store.cas(code, version, r)) return response();
    }
    throw new GameError("The room is busy. Please try again.");
  }
}
export function phaseKey(r) {
  return [r.match, r.round, r.phase, r.turn || 0, r.runoff ? 1 : 0].join(":");
}
