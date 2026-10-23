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
      skipCredits: true,
      historyRatio: 0.95,
      queueSize: 5,
      pollIntervalMs: 3000,
      autoMode: true,
      preventSleep: true,
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

  it("lit la liste de films et skipCredits ; un ancien fichier sans ces clés reste valide", () => {
    const state = normalize({ movies: ["a", "b", "a", 7], settings: { skipCredits: false } });
    expect(state.movies).toEqual(["a", "b"]);
    expect(state.settings.skipCredits).toBe(false);

    const old = normalize({ currentSeriesId: "s", settings: { autoMode: true } });
    expect(old.movies).toEqual([]);
    expect(old.settings.skipCredits).toBe(true);
  });

  it("lit preventSleep, activé par défaut pour un ancien fichier qui ne l'a pas", () => {
    expect(normalize({ settings: { preventSleep: false } }).settings.preventSleep).toBe(false);
    expect(normalize({ settings: { autoMode: false } }).settings.preventSleep).toBe(true);
    expect(normalize({ settings: { preventSleep: "non" } }).settings.preventSleep).toBe(true);
  });

  it("garde le point de reprise valide d'une série et rejette les valeurs invalides", () => {
    const state = normalize({
      series: {
        ok: { resume: { id: "ep1", positionTicks: 6000, at: 12 } },
        sansDate: { resume: { id: "ep2", positionTicks: 0 } },
        negatif: { resume: { id: "ep3", positionTicks: -5, at: 1 } },
        texte: { resume: { id: "ep4", positionTicks: "10", at: 1 } },
        sansId: { resume: { positionTicks: 10, at: 1 } },
        aucun: {},
      },
    });
    expect(state.series.ok?.resume).toEqual({ id: "ep1", positionTicks: 6000, at: 12 });
    expect(state.series.sansDate?.resume).toEqual({ id: "ep2", positionTicks: 0, at: 0 });
    for (const key of ["negatif", "texte", "sansId", "aucun"]) expect(state.series[key]?.resume).toBeUndefined();
  });
});
