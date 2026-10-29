import { Redis } from "@upstash/redis";
export class StorageSetupError extends Error {
  constructor() {
    super("Game storage is not configured.");
    this.name = "StorageSetupError";
    this.code = "STORAGE_NOT_CONFIGURED";
  }
}
const TTL = 7200;
// Compare versions inside Redis: simultaneous votes can never overwrite one another.
const CAS = `local old=redis.call('GET',KEYS[1]); if not old then return 0 end; if cjson.decode(old).version ~= tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1`;
const RATE = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
export class MemoryStore {
  constructor() {
    this.rooms = new Map();
    this.limits = new Map();
  }
  async get(code) {
    const value = this.rooms.get(code);
    if (!value) return null;
    if (value.expires < Date.now()) {
      this.rooms.delete(code);
      return null;
    }
    return structuredClone(value.data);
  }
  async create(code, data) {
    const old = this.rooms.get(code);
    if (old && old.expires > Date.now()) return false;
    this.rooms.set(code, {
      data: structuredClone(data),
      expires: Date.now() + TTL * 1000,
    });
    return true;
  }
  async cas(code, version, data) {
    const old = this.rooms.get(code);
    if (!old || old.data.version !== version) return false;
    this.rooms.set(code, {
      data: structuredClone(data),
      expires: Date.now() + TTL * 1000,
    });
    return true;
  }
  async rate(key, max, seconds) {
    const now = Date.now();
    if (this.limits.size > 5000)
      for (const [k, v] of this.limits)
        if (v.until < now) this.limits.delete(k);
    let v = this.limits.get(key);
    if (!v || v.until < now) {
      v = { count: 0, until: now + seconds * 1000 };
      this.limits.set(key, v);
    }
    return ++v.count <= max;
  }
}
export class RedisStore {
  constructor(redis, prefix = "ofc:production") {
    this.redis = redis;
    this.prefix = prefix;
  }
  key(code) {
    return `${this.prefix}:room:${code}`;
  }
  async get(code) {
    return this.redis.get(this.key(code));
  }
  async create(code, data) {
    return (
      (await this.redis.set(this.key(code), data, { nx: true, ex: TTL })) ===
      "OK"
    );
  }
  async cas(code, version, data) {
    return (
      Number(
        await this.redis.eval(
          CAS,
          [this.key(code)],
          [version, JSON.stringify(data), TTL],
        ),
      ) === 1
    );
  }
  async rate(key, max, seconds) {
    return (
      Number(
        await this.redis.eval(RATE, [`${this.prefix}:rate:${key}`], [seconds]),
      ) <= max
    );
  }
}
let store;
export function getStore(env = process.env) {
  if (store) return store;
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim();
  const token = (
    env.UPSTASH_REDIS_REST_TOKEN ||
    env.KV_REST_API_TOKEN ||
    ""
  ).trim();
  if (url && token) {
    const prefix =
      env.ROOM_NAMESPACE ||
      (env.VERCEL_ENV === "preview"
        ? `ofc:preview:${env.VERCEL_GIT_COMMIT_REF || "default"}`
        : "ofc:production");
    store = new RedisStore(
      new Redis({ url, token, retry: { retries: 0 } }),
      prefix,
    );
  } else if (env.VERCEL || env.NODE_ENV === "production")
    throw new StorageSetupError();
  else store = new MemoryStore();
  return store;
}
