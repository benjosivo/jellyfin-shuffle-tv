import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalize, Store } from "./store.js";

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "store-test-"));
}

describe("Store", () => {
  it("crée state.json avec les réglages par défaut", async () => {
    const dir = await tmp();
    const store = await Store.open(path.join(dir, "state.json"));
    const saved = JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8"));
    expect(saved.settings).toEqual({
      changeBeforeEndSec: 30,
      historyRatio: 0.95,
      queueSize: 5,
      pollIntervalMs: 3000,
      autoMode: true,
    });
    expect(store.state.pendingImport).toBeUndefined();
  });

  it("met l'ancien fichier history en attente d'import, une seule fois", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "history"), "a\nb\n\n c \n");
    const store = await Store.open(path.join(dir, "state.json"), path.join(dir, "history"));
    expect(store.state.pendingImport).toEqual(["a", "b", "c"]);
    delete store.state.pendingImport;
    await store.flush();
    const again = await Store.open(path.join(dir, "state.json"), path.join(dir, "history"));
    expect(again.state.pendingImport).toBeUndefined();
  });

  it("écrit de façon atomique sans laisser de fichier temporaire", async () => {
    const dir = await tmp();
    const store = await Store.open(path.join(dir, "state.json"));
    store.seriesState("s1").queue.push("x");
    store.save();
    store.save();
    await store.flush();
    expect(await fs.readdir(dir)).toEqual(["state.json"]);
    const saved = JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8"));
    expect(saved.series.s1.queue).toEqual(["x"]);
  });

  it("met de côté un state.json illisible au lieu de planter", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "state.json"), "{pas du json");
    const store = await Store.open(path.join(dir, "state.json"));
    expect(store.state.series).toEqual({});
    expect((await fs.readdir(dir)).some((f) => f.startsWith("state.json.corrompu-"))).toBe(true);
  });
});

describe("normalize", () => {
  it("accepte l'historique au format du brief (string[]) et borne les réglages", () => {
    const state = normalize({
      currentSeriesId: "s",
      settings: { queueSize: 999, historyRatio: 0.5, autoMode: false },
      series: { s: { history: ["a", { id: "b", at: 5 }, 42], queue: ["c", 1] } },
    });
    expect(state.series.s).toEqual({ history: [{ id: "a", at: 0 }, { id: "b", at: 5 }], queue: ["c"] });
    expect(state.settings.queueSize).toBe(50);
    expect(state.settings.historyRatio).toBe(0.5);
    expect(state.settings.autoMode).toBe(false);
  });
});
