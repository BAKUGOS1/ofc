import { cp, mkdir, rm, readFile } from "node:fs/promises";
const config = JSON.parse(
  await readFile(new URL("../vercel.json", import.meta.url)),
);
if (config.outputDirectory !== "dist")
  throw new Error("Unexpected output directory");
await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../dist", import.meta.url));
await cp(
  new URL("../public", import.meta.url),
  new URL("../dist", import.meta.url),
  { recursive: true },
);
console.log(
  "Built static client in dist/. Server-only words and tokens are excluded.",
);
