import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { createGameServer } from "../server.js";
async function until(fn, message) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out: ${message}`);
}
function click(w, selector) {
  const el = w.document.querySelector(selector);
  assert.ok(el, selector);
  assert.equal(el.disabled, false, `${selector} disabled`);
  el.click();
}
test(
  "four independent rendered clients complete a game and replay",
  { timeout: 45000 },
  async () => {
    const server = createGameServer();
    await new Promise((r) => server.http.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.http.address().port}`;
    const pages = [],
      errors = [];
    try {
      const virtualConsole = new VirtualConsole();
      virtualConsole.on("jsdomError", (e) => errors.push(e.message));
      for (let i = 0; i < 4; i++) {
        const code = [...server.store.rooms.keys()][0];
        const dom = await JSDOM.fromURL(i ? `${url}/?room=${code}` : url, {
          runScripts: "dangerously",
          resources: "usable",
          pretendToBeVisual: true,
          virtualConsole,
          beforeParse(w) {
            w.fetch = (path, options) => fetch(new URL(path, url), options);
            w.AbortController = AbortController;
          },
        });
        pages.push(dom);
        const w = dom.window;
        await until(
          () =>
            w.document.querySelector("#connection-label")?.textContent ===
            "Ready to play",
          "client connected",
        );
        w.document.querySelector("#name").value = `Office ${i}`;
        click(w, "#entry button[type=submit]");
        await until(
          () => w.document.querySelector("[data-action=ready]"),
          "joined room",
        );
      }
      const code = [...server.store.rooms.keys()][0];
      const read = () => server.store.rooms.get(code).data;
      let r = read();
      for (const dom of pages) click(dom.window, "[data-action=ready]");
      await until(
        () =>
          pages[0].window.document.querySelector("[data-action=start]")
            ?.disabled === false,
        "everyone ready",
      );
      click(pages[0].window, "[data-action=start]");
      for (const dom of pages) {
        const w = dom.window;
        await until(() => w.document.querySelector("#secret"), "reveal screen");
        assert.equal(w.document.querySelector(".secret-word"), null);
        click(w, "#secret");
        assert.ok(w.document.querySelector(".secret-word").textContent);
        click(w, "[data-action=revealed]");
      }
      await until(() => read().phase === "clues", "clue phase");
      for (let i = 0; i < 4; i++) {
        await until(
          () =>
            pages[0].window.document.querySelector("[data-action=clue-done]"),
          "next clue",
        );
        click(pages[0].window, "[data-action=clue-done]");
        await until(
          () => read().turn >= i + 1 || read().phase === "discussion",
          "turn advanced",
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      await until(
        () => pages[0].window.document.querySelector("[data-action=open-vote]"),
        "discussion screen",
      );
      click(pages[0].window, "[data-action=open-vote]");
      for (let i = 0; i < 4; i++) {
        const w = pages[i].window;
        await until(() => w.document.querySelector("#lock-vote"), "voting");
        r = read();
        const p = r.players[i];
        const target =
          p.id === r.spyId ? r.players.find((x) => x !== p).id : r.spyId;
        click(w, `[data-vote="${target}"]`);
        click(w, "#lock-vote");
      }
      await until(
        () => pages[0].window.document.querySelector("[data-action=lobby]"),
        "finished screen",
      );
      assert.equal(read().winner, "civilians");
      assert.match(
        pages[0].window.document.querySelector(".game-main").textContent,
        /Cover blown/,
      );
      click(pages[0].window, "[data-action=lobby]");
      await until(
        () =>
          pages.every((d) =>
            d.window.document.querySelector("[data-action=ready]"),
          ),
        "all returned to lobby",
      );
      assert.equal(read().phase, "lobby");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      for (const dom of pages) {
        dom.window.dispatchEvent(new dom.window.Event("pagehide"));
        dom.window.close();
      }
      await server.close();
    }
  },
);
