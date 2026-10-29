import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { MemoryStore } from "./lib/store.js";
import { registerRoutes } from "./lib/http.js";
export function createGameServer({ store = new MemoryStore() } = {}) {
  const app = express();
  app.use(express.json({ limit: "4kb" }));
  registerRoutes(app, () => store);
  app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));
  app.use((err, _req, res, _next) =>
    res
      .status(err.status || 500)
      .json({ ok: false, error: "Invalid request." }),
  );
  const http = createServer(app);
  return {
    app,
    http,
    store,
    close: () => new Promise((resolve) => http.close(resolve)),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { getStore } = await import("./lib/store.js");
  const server = createGameServer({ store: getStore() });
  const port = Number(process.env.PORT) || 3000;
  server.http.listen(port, "0.0.0.0", () => {
    console.log(`\nUNDERCVR · Office Club\nLocal: http://localhost:${port}`);
    try {
      for (const entries of Object.values(networkInterfaces()))
        for (const ip of entries || [])
          if (ip.family === "IPv4" && !ip.internal)
            console.log(`Wi-Fi: http://${ip.address}:${port}`);
    } catch {
      console.log("Use your computer’s Wi-Fi IPv4 address with port " + port);
    }
  });
}
