import QRCode from "qrcode";
import { GameService } from "./service.js";
import { GameError } from "./game.js";
export function registerRoutes(app, getStore) {
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
    next();
  });
  app.get(["/health", "/api/health"], async (_req, res) => {
    try {
      const store = getStore();
      await store.get("HEALTH");
      res.json({
        ok: true,
        mode: store.constructor.name === "MemoryStore" ? "local" : "shared",
      });
    } catch {
      res
        .status(503)
        .json({
          ok: false,
          error:
            "Multiplayer storage is unavailable. Connect Upstash Redis in Vercel Storage, then redeploy.",
        });
    }
  });
  app.get(["/qr", "/api/qr"], async (req, res) => {
    const code = String(req.query.room || "");
    if (!/^[A-Z2-9]{6}$/.test(code)) return res.sendStatus(400);
    try {
      if (!(await getStore().get(code))) return res.sendStatus(404);
      // Hosted requests use HTTPS. The explicit PUBLIC_URL is optional.
      const proto = process.env.VERCEL ? "https" : req.protocol;
      const base = process.env.PUBLIC_URL || `${proto}://${req.get("host")}`;
      res
        .type("svg")
        .send(
          await QRCode.toString(`${base}/?room=${code}`, {
            type: "svg",
            margin: 2,
            width: 220,
          }),
        );
    } catch {
      res.sendStatus(503);
    }
  });
  app.post("/api/game", async (req, res) => {
    const origin = req.get("origin");
    try {
      if (origin && new URL(origin).host !== req.get("host"))
        return res
          .status(403)
          .json({ ok: false, error: "Open the game on its own website." });
    } catch {
      return res.sendStatus(403);
    }
    if (!req.is("application/json"))
      return res.status(415).json({ ok: false, error: "Expected JSON." });
    try {
      const identity = process.env.VERCEL
        ? req.get("x-vercel-forwarded-for") || req.ip
        : req.ip;
      const result = await new GameService(getStore()).command(
        req.body,
        identity,
      );
      res.json(result);
    } catch (error) {
      if (error instanceof GameError)
        return res.status(400).json({ ok: false, error: error.message });
      console.error("game_request_failed", error.name);
      res
        .status(503)
        .json({
          ok: false,
          error:
            "Multiplayer is temporarily unavailable. Please try again shortly.",
        });
    }
  });
}
