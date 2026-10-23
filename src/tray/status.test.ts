import { describe, expect, it } from "vitest";
import type { PublicState } from "../shared/types.js";
import { renderIcon } from "./icon.js";
import { buildMenu } from "./linux.js";
import { STOPPED, traySummary } from "./status.js";

const base: PublicState = {
  configured: true,
  jellyfin: "ok",
  player: "ok",
  settings: { changeBeforeEndSec: 30, historyRatio: 0.95, queueSize: 5, pollIntervalMs: 3000, autoMode: true, skipCredits: true, preventSleep: true },
  series: { id: "s", name: "The Office", episodeCount: 200, kind: "series" },
  nowPlaying: null,
  volume: 50,
  muted: false,
  audioIndex: null,
  subtitleIndex: null,
  audioTracks: [],
  subtitleTracks: [],
  queue: [],
  history: [],
  historyCount: 0,
  historyLimit: 190,
  order: "shuffle",
  canPrevious: true,
  sampledAt: 0,
  movieCount: 0,
  remoteClients: 0,
};
const episode = { id: "e", name: "Pilote", seriesName: "The Office", season: 1, episode: 1, positionSec: 10, canSeek: true, managed: true };

describe("traySummary", () => {
  it("lecture en cours : vert, avec l'épisode", () => {
    const s = traySummary({ ...base, nowPlaying: { ...episode, isPaused: false } });
    expect(s).toMatchObject({ level: "playing", title: "Lecture en boucle", detail: "The Office · S01E01 Pilote", canPause: true, canSkip: true });
  });

  it("pause, attente, problèmes", () => {
    expect(traySummary({ ...base, nowPlaying: { ...episode, isPaused: true } })).toMatchObject({ level: "paused", canResume: true });
    expect(traySummary(base).level).toBe("idle");
    expect(traySummary({ ...base, configured: false })).toMatchObject({ level: "warning", title: "À configurer" });
    expect(traySummary({ ...base, jellyfin: "unreachable" })).toMatchObject({ level: "warning", title: "Jellyfin injoignable" });
    expect(traySummary({ ...base, player: "missing" })).toMatchObject({ level: "warning", title: "MPV Shim introuvable" });
  });
});

describe("menu de l'icône", () => {
  const noop = { open() {}, qr() {}, pause() {}, resume() {}, skip() {}, previous() {}, shuffle() {}, sequential() {}, restart() {}, quit() {} };
  it("propose Reprendre en pause et Démarrer quand le serveur est arrêté", () => {
    const paused = buildMenu(traySummary({ ...base, nowPlaying: { ...episode, isPaused: true } }), noop);
    expect(paused.find((i) => i.id === 20)?.label).toBe("Reprendre");
    const stopped = buildMenu(STOPPED, noop);
    expect(stopped.find((i) => i.id === 30)?.label).toBe("Démarrer le serveur");
    expect(stopped.find((i) => i.id === 10)?.enabled).toBe(false);
    expect(stopped.find((i) => i.id === 23)?.enabled).toBe(false);
  });

  it("coche le mode de lecture courant et propose l'épisode précédent", () => {
    const menu = buildMenu(traySummary({ ...base, order: "sequential", nowPlaying: { ...episode, isPaused: false } }), noop);
    expect(menu.find((i) => i.id === 24)).toMatchObject({ radio: true, checked: true });
    expect(menu.find((i) => i.id === 23)?.checked).toBe(false);
    expect(menu.find((i) => i.id === 19)?.enabled).toBe(true);
  });
});

describe("renderIcon", () => {
  it("disque opaque au centre, transparent dans les coins", () => {
    const px = renderIcon("playing", 32);
    expect(px[3]).toBe(0);
    expect(px[(16 * 32 + 4) * 4 + 3]).toBe(255);
  });
});
