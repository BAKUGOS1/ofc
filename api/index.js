import express from "express";
import { getStore } from "../lib/store.js";
import { registerRoutes } from "../lib/http.js";
const app = express();
app.use(express.json({ limit: "4kb" }));
registerRoutes(app, getStore);
app.use((err, _req, res, _next) =>
  res.status(err.status || 500).json({ ok: false, error: "Invalid request." }),
);
export default app;
