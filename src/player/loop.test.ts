import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { JellyfinError, type JellyfinApi } from "../jellyfin/client.js";
import type { JfItem, JfMediaSegment, JfSession } from "../jellyfin/types.js";
import { MOVIES_SOURCE_ID } from "../shared/types.js";
import { Store } from "../store.js";
import { Library } from "./library.js";
import { IDLE_GRACE_MS, PENDING_TIMEOUT_MS, PlayerLoop, SETTLE_MS } from "./loop.js";

const SEC = 10_000_000;
const SERIES = "series-office";

function episodes(n: number): JfItem[] {
  return Array.from({ length: n }, (_, i) => ({
    Id: `ep${i + 1}`,
    Name: `Episode ${i + 1}`,
    Type: "Episode",
    SeriesId: SERIES,
    SeriesName: "The Office",
    ParentIndexNumber: 1,
    IndexNumber: i + 1,
    RunTimeTicks: 1300 * SEC,
  }));
}

function movies(n: number): JfItem[] {
  return Array.from({ length: n }, (_, i) => ({
    Id: `mv${i + 1}`,
    Name: `Film ${i + 1}`,
    Type: "Movie",
    ProductionYear: 2000 + i,
    RunTimeTicks: 6000 * SEC,
    UserData: { Played: i % 2 === 0 }, // mv1, mv3, mv5… sont marqués « vus »
  }));
}

const outro = (startSec: number): JfMediaSegment[] => [{ Type: "Outro", StartTicks: startSec * SEC, EndTicks: 6000 * SEC }];

class FakeJellyfin implements JellyfinApi {
  calls: string[] = [];
  playing?: { item: JfItem; position: number; paused: boolean };
  reachable = true;
  failPlay = false;
  items = episodes(30);
  movies: JfItem[] = [];
  outros: Record<string, JfMediaSegment[]> = {};
  extraSessions: JfSession[] = [];

  session(): JfSession {
    return {
      Id: "sess-mpv",
      UserName: "Salon",
      Client: "Jellyfin MPV Shim",
      DeviceName: "cachyos",
      DeviceId: "mpv-device",
      SupportsRemoteControl: true,
      NowPlayingItem: this.playing?.item,
      PlayState: this.playing
        ? { PositionTicks: this.playing.position, IsPaused: this.playing.paused, VolumeLevel: 80, CanSeek: true }
        : {},
      Capabilities: { SupportedCommands: ["SetVolume", "SetAudioStreamIndex", "SetSubtitleStreamIndex"] },
    };
  }

  async getSessions() {
    if (!this.reachable) throw new JellyfinError("unreachable", "down");
    return [
      // La session du token de l'application elle-même : ne doit jamais être prise pour MPV Shim.
      { Id: "sess-self", UserName: "Salon", Client: "CachyOS Office Auto", DeviceId: "self", SupportsRemoteControl: true },
      ...this.extraSessions,
      this.session(),
    ] as JfSession[];
  }
  async play(sessionId: string, itemId: string) {
    this.calls.push(`play:${sessionId}:${itemId}`);
    if (this.failPlay) throw new JellyfinError("http", "boom", 500);
    const item =
      this.items.find((i) => i.Id === itemId) ??
      this.movies.find((i) => i.Id === itemId) ?? { Id: itemId, Name: itemId, RunTimeTicks: 1300 * SEC };
    this.playing = { item, position: 0, paused: false };
  }
  async playstate(sessionId: string, command: string, query?: Record<string, unknown>) {
    this.calls.push(`playstate:${sessionId}:${command}${query ? ":" + JSON.stringify(query) : ""}`);
    if (command === "Stop") this.playing = undefined;
    if (command === "Pause" && this.playing) this.playing.paused = true;
  }
  async command(sessionId: string, name: string, args?: Record<string, string>) {
    this.calls.push(`command:${sessionId}:${name}:${JSON.stringify(args ?? {})}`);
  }
  async getItem(itemId: string) {
    return { Id: itemId, MediaStreams: [{ Type: "Audio", Index: 1, DisplayTitle: "English" }] };
  }
  async listSeries() {
    return [{ Id: SERIES, Name: "The Office" }, { Id: "other", Name: "Other" }];
  }
  async listEpisodes(seriesId: string) {
    return seriesId === SERIES ? this.items : [];
  }
  async listMovies() {
    return this.movies;
  }
  async getOutroSegments(itemId: string) {
    return this.outros[itemId] ?? [];
  }
}

let clock: number;
let fake: FakeJellyfin;
let store: Store;
let loop: PlayerLoop;
let dir: string;

async function setup(opts: { legacy?: string[] } = {}) {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "loop-test-"));
  if (opts.legacy) await fs.writeFile(path.join(dir, "history"), opts.legacy.join("\n") + "\n");
  clock = 1_000_000;
  fake = new FakeJellyfin();
  store = await Store.open(path.join(dir, "state.json"), path.join(dir, "history"));
  loop = new PlayerLoop({
    api: fake,
    store,
    library: new Library(fake, () => clock),
    match: () => ({ userName: "Salon", ownDeviceId: "self", pattern: /mpv/i }),
    isConfigured: async () => true,
    defaultSeriesName: () => "The Office",
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

const advance = (ms: number) => {
  clock += ms;
};
const plays = () => fake.calls.filter((c) => c.startsWith("play:"));

/** Démarre la boucle jusqu'au lancement du premier épisode. */
async function startFirst() {
  await loop.tick(); // détecte l'inactivité
  advance(IDLE_GRACE_MS);
  await loop.tick(); // lance l'épisode
  expect(plays()).toHaveLength(1);
  advance(SETTLE_MS);
  await loop.tick(); // confirme le démarrage (pending)
}

describe("PlayerLoop", () => {
  beforeEach(async () => {
    await setup();
  });

  it("ignore la session de son propre token et lance un premier épisode quand rien ne joue", async () => {
    await loop.tick();
    expect(loop.snapshot().player).toBe("ok");
    expect(loop.snapshot().session?.id).toBe("sess-mpv");
    expect(plays()).toHaveLength(0); // délai de grâce
    advance(IDLE_GRACE_MS);
    await loop.tick();
    expect(plays()).toEqual([`play:sess-mpv:${fake.playing!.item.Id}`]);
    const state = loop.snapshot();
    expect(state.queue).toHaveLength(5);
    expect(state.history[0]?.id).toBe(fake.playing!.item.Id);
  });

  it("à moins de 30 s de la fin : Stop authentifié, puis PlayNow de la tête de file", async () => {
    await startFirst();
    const next = loop.snapshot().queue[0]!.id;
    fake.playing!.position = 1275 * SEC; // reste 25 s
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual(["playstate:sess-mpv:Stop", `play:sess-mpv:${next}`]);
    expect(store.state.lastStarted?.id).toBe(next);
  });

  it("ne coupe pas avant le seuil", async () => {
    await startFirst();
    fake.playing!.position = 1260 * SEC; // reste 40 s
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);
  });

  it("ne fait rien en pause, même près de la fin", async () => {
    await startFirst();
    fake.playing!.position = 1295 * SEC;
    fake.playing!.paused = true;
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);
  });

  it("ne coupe pas si RunTimeTicks est absent ou nul", async () => {
    await startFirst();
    fake.playing!.item = { ...fake.playing!.item, RunTimeTicks: 0 };
    fake.playing!.position = 5 * SEC;
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);
  });

  it("ignore la session juste après un changement (elle remonte encore l'ancien épisode)", async () => {
    await startFirst();
    const first = fake.playing!.item;
    fake.playing!.position = 1290 * SEC;
    await loop.tick(); // change d'épisode
    expect(plays()).toHaveLength(2);
    // La session renvoie encore l'ancien épisode presque fini.
    fake.playing = { item: first, position: 1295 * SEC, paused: false };
    fake.calls = [];
    advance(3000);
    await loop.tick();
    expect(fake.calls).toEqual([]);
  });

  it("ne force pas un contenu lancé manuellement, puis reprend la main à l'arrêt", async () => {
    await startFirst();
    fake.playing = { item: { Id: "film", Name: "Un film", RunTimeTicks: 100 * SEC }, position: 95 * SEC, paused: false };
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);
    expect(loop.snapshot().nowPlaying?.managed).toBe(false);

    fake.playing = undefined; // le film se termine
    await loop.tick();
    expect(plays()).toHaveLength(0);
    advance(IDLE_GRACE_MS);
    await loop.tick();
    expect(plays()).toHaveLength(1);
  });

  it("mode auto désactivé : aucune intervention", async () => {
    await loop.setAutoMode(false);
    await loop.tick();
    advance(IDLE_GRACE_MS * 3);
    await loop.tick();
    expect(plays()).toHaveLength(0);
  });

  it("si PlayNow échoue, l'épisode revient en tête de file", async () => {
    await loop.tick();
    const head = loop.snapshot().queue[0]!.id;
    fake.failPlay = true;
    advance(IDLE_GRACE_MS);
    await loop.tick();
    expect(plays()).toEqual([`play:sess-mpv:${head}`]);
    expect(loop.snapshot().queue[0]!.id).toBe(head);
    expect(loop.snapshot().historyCount).toBe(0);
  });

  it("relance si l'épisode lancé n'apparaît jamais", async () => {
    await loop.tick();
    advance(IDLE_GRACE_MS);
    await loop.tick();
    fake.playing = undefined; // MPV Shim n'a rien lancé
    advance(PENDING_TIMEOUT_MS);
    await loop.tick();
    advance(IDLE_GRACE_MS);
    await loop.tick();
    expect(plays()).toHaveLength(2);
  });

  it("passer : lance la tête de file sans Stop préalable, même sur un contenu manuel", async () => {
    await loop.tick();
    fake.playing = { item: { Id: "film", Name: "Un film" }, position: 0, paused: false };
    await loop.tick();
    const head = loop.snapshot().queue[0]!.id;
    fake.calls = [];
    await loop.skip();
    expect(fake.calls).toEqual([`play:sess-mpv:${head}`]);
  });

  it("stop : arrête et désactive le mode auto", async () => {
    await startFirst();
    await loop.stopPlayback();
    expect(store.settings.autoMode).toBe(false);
    advance(IDLE_GRACE_MS * 3);
    fake.calls = [];
    await loop.tick();
    expect(plays()).toHaveLength(0);
  });

  it("commandes : arguments en chaînes, seek borné, sous-titres -1", async () => {
    await startFirst();
    fake.calls = [];
    await loop.setVolume(42.4);
    await loop.setSubtitleTrack(-1);
    await loop.setAudioTrack(2);
    await loop.seek(99999);
    expect(fake.calls).toEqual([
      'command:sess-mpv:SetVolume:{"Volume":"42"}',
      'command:sess-mpv:SetSubtitleStreamIndex:{"Index":"-1"}',
      'command:sess-mpv:SetAudioStreamIndex:{"Index":"2"}',
      `playstate:sess-mpv:Seek:{"seekPositionTicks":${1299 * SEC}}`,
    ]);
  });

  it("Jellyfin injoignable puis MPV Shim absent sont signalés", async () => {
    fake.reachable = false;
    await loop.tick();
    expect(loop.snapshot().jellyfin).toBe("unreachable");
    fake.reachable = true;
    fake.session = () => ({ Id: "x", Client: "Jellyfin Web", SupportsRemoteControl: true, UserName: "Salon" });
    await loop.tick();
    expect(loop.snapshot().jellyfin).toBe("ok");
    expect(loop.snapshot().player).toBe("missing");
    await expect(loop.pause()).rejects.toThrow(/MPV Shim introuvable/);
  });

  it("reconnaît son épisode après un redémarrage du service", async () => {
    await startFirst();
    const current = fake.playing!.item.Id;
    await store.flush();
    const reopened = await Store.open(path.join(dir, "state.json"));
    expect(reopened.state.lastStarted?.id).toBe(current);
  });
});

describe("migration de l'ancien historique", () => {
  it("importe le fichier history dans la série par défaut", async () => {
    await setup({ legacy: ["ep1", "ep2", "inconnu", "ep3"] });
    expect(store.state.pendingImport).toEqual(["ep1", "ep2", "inconnu", "ep3"]);
    await loop.tick();
    expect(store.state.currentSeriesId).toBe(SERIES);
    expect(store.state.pendingImport).toBeUndefined();
    const history = store.state.series[SERIES]!.history;
    expect(history.map((h) => h.id)).toEqual(["ep1", "ep2", "ep3"]);
    expect(history.every((h) => h.at === 0)).toBe(true);
    expect(loop.snapshot().queue.some((e) => ["ep1", "ep2", "ep3"].includes(e.id))).toBe(false);
  });
});

describe("films déjà vus", () => {
  /** Remplit la bibliothèque de `count` films, met `listed` dans la liste et la choisit comme source. */
  async function useMovies(count: number, listed: number, outroAtSec?: number) {
    fake.movies = movies(count);
    if (outroAtSec !== undefined) for (const m of fake.movies) fake.outros[m.Id] = outro(outroAtSec);
    await listAndSelect(listed);
  }
  async function listAndSelect(listed: number) {
    await loop.addMovies(fake.movies.slice(0, listed).map((m) => m.Id));
    await loop.setSeries(MOVIES_SOURCE_ID, false);
  }

  beforeEach(async () => {
    await setup();
  });

  it("ne lance que des films de la liste", async () => {
    await useMovies(8, 3);
    const listed = new Set(["mv1", "mv2", "mv3"]);
    await loop.tick();
    advance(IDLE_GRACE_MS);
    await loop.tick();
    expect(plays()).toHaveLength(1);
    expect(listed.has(fake.playing!.item.Id)).toBe(true);
    const state = loop.snapshot();
    expect(state.series).toMatchObject({ id: MOVIES_SOURCE_ID, kind: "movies", episodeCount: 3 });
    expect(state.movieCount).toBe(3);
    expect(state.queue.every((e) => listed.has(e.id))).toBe(true);
  });

  it("passe au film suivant dès le début du générique détecté", async () => {
    await useMovies(8, 8, 5400);
    await startFirst();
    const next = loop.snapshot().queue[0]!.id;
    expect(loop.snapshot().nowPlaying?.creditsStartSec).toBe(5400);

    fake.playing!.position = 5000 * SEC;
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);

    fake.playing!.position = 5401 * SEC;
    await loop.tick();
    expect(fake.calls).toEqual(["playstate:sess-mpv:Stop", `play:sess-mpv:${next}`]);
  });

  it("sans générique détecté : coupe 30 s avant la fin comme pour un épisode", async () => {
    await useMovies(8, 8);
    await startFirst();
    expect(loop.snapshot().nowPlaying?.creditsStartSec).toBeUndefined();
    fake.playing!.position = 5900 * SEC; // reste 100 s
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);
    fake.playing!.position = 5975 * SEC; // reste 25 s
    await loop.tick();
    expect(fake.calls[0]).toBe("playstate:sess-mpv:Stop");
  });

  it("skipCredits désactivé : le générique est ignoré", async () => {
    await useMovies(8, 8, 5400);
    await loop.updateSettings({ skipCredits: false });
    await startFirst();
    fake.playing!.position = 5500 * SEC;
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);
    fake.playing!.position = 5975 * SEC;
    await loop.tick();
    expect(fake.calls[0]).toBe("playstate:sess-mpv:Stop");
  });

  it("un « Outro » avant la moitié du film est pris pour une erreur de détection", async () => {
    await useMovies(8, 8, 1000);
    await startFirst();
    expect(loop.snapshot().nowPlaying?.creditsStartSec).toBeUndefined();
    fake.playing!.position = 1500 * SEC;
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);
  });

  it("n'applique pas le générique aux épisodes de série", async () => {
    for (const item of fake.items) fake.outros[item.Id] = outro(1000);
    await startFirst();
    fake.playing!.position = 1100 * SEC; // après le « Outro », mais à plus de 30 s de la fin (1300 s)
    fake.calls = [];
    await loop.tick();
    expect(fake.calls).toEqual([]);
  });

  it("liste vide : la source est conservée et rien n'est lancé", async () => {
    await listAndSelect(0);
    await loop.tick();
    advance(IDLE_GRACE_MS * 2);
    await loop.tick();
    expect(plays()).toHaveLength(0);
    expect(store.state.currentSeriesId).toBe(MOVIES_SOURCE_ID);
    await expect(loop.skip()).rejects.toThrow(/Liste de films vide/);
  });

  it("retirer un film le sort de la file ; importer ajoute seulement les films vus", async () => {
    fake.movies = movies(8);
    await loop.setSeries(MOVIES_SOURCE_ID, false);
    expect(await loop.importPlayedMovies()).toBe(4);
    expect(store.state.movies).toEqual(["mv1", "mv3", "mv5", "mv7"]);
    expect(await loop.importPlayedMovies()).toBe(0);

    await loop.tick();
    const queued = loop.snapshot().queue[0]!.id;
    await loop.removeMovie(queued);
    expect(store.state.movies).not.toContain(queued);
    expect(loop.snapshot().queue.map((e) => e.id)).not.toContain(queued);
    await expect(loop.removeMovie(queued)).rejects.toThrow(/absent de la liste/);

    expect(await loop.addMovies(["mv2", "inconnu"])).toBe(1);
    expect(store.state.movies).toContain("mv2");
  });
});

describe("changement de série", () => {
  beforeEach(async () => {
    await setup();
  });

  it("garde l'historique et la file de chaque série", async () => {
    fake.items = episodes(30);
    await startFirst();
    const officeQueue = [...store.state.series[SERIES]!.queue];
    await expect(loop.setSeries("other", false)).rejects.toThrow(/aucun épisode/);
    expect(store.state.currentSeriesId).toBe(SERIES);
    expect(store.state.series[SERIES]!.queue).toEqual(officeQueue);
  });
});

describe("contrôles avancés", () => {
  beforeEach(async () => {
    await setup();
  });

  it("saut relatif à partir de la position estimée (temps écoulé depuis le relevé)", async () => {
    await startFirst();
    fake.playing!.position = 100 * SEC;
    await loop.tick();
    advance(2000); // 2 s se sont écoulées depuis le relevé
    fake.calls = [];
    await loop.seekBy(-15);
    await loop.seekBy(5000);
    expect(fake.calls).toEqual([
      `playstate:sess-mpv:Seek:{"seekPositionTicks":${87 * SEC}}`,
      `playstate:sess-mpv:Seek:{"seekPositionTicks":${1299 * SEC}}`,
    ]);
  });

  it("épisode précédent puis suivant en aléatoire", async () => {
    await startFirst();
    const first = fake.playing!.item.Id;
    await loop.skip();
    advance(SETTLE_MS);
    await loop.tick();
    const second = fake.playing!.item.Id;
    expect(loop.snapshot().canPrevious).toBe(true);
    await loop.previous();
    expect(fake.playing!.item.Id).toBe(first);
    advance(SETTLE_MS);
    await loop.tick();
    await loop.skip();
    expect(fake.playing!.item.Id).toBe(second);
  });

  it("dans l'ordre : enchaînement automatique jusqu'au retour au premier épisode", async () => {
    fake.items = episodes(3);
    await startFirst();
    await loop.playNow("ep2");
    await loop.setOrder("sequential");
    expect(loop.snapshot().queue.map((e) => e.id)).toEqual(["ep3", "ep1"]);
    const seenOrder: string[] = [fake.playing!.item.Id];
    for (let i = 0; i < 3; i++) {
      advance(SETTLE_MS);
      await loop.tick();
      fake.playing!.position = 1290 * SEC; // presque fini
      await loop.tick();
      seenOrder.push(fake.playing!.item.Id);
    }
    expect(seenOrder).toEqual(["ep2", "ep3", "ep1", "ep2"]);
    expect(store.state.series[SERIES]!.order).toBe("sequential");
  });

  it("liste des épisodes avec leur statut et « lire ensuite »", async () => {
    await startFirst();
    await loop.playNext("ep30");
    const list = await loop.episodes();
    expect(list).toHaveLength(30);
    expect(list.find((e) => e.playing)?.id).toBe(fake.playing!.item.Id);
    expect(list.find((e) => e.id === "ep30")?.queued).toBe(true);
    expect(loop.snapshot().queue[0]!.id).toBe("ep30");
  });
});

