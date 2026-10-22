import { EventEmitter } from "node:events";
import { HttpError } from "../errors.js";
import { JellyfinError, type JellyfinApi } from "../jellyfin/client.js";
import { findPlayerSession, type PlayerMatchConfig } from "../jellyfin/session.js";
import { supportedCommands, TICKS_PER_SECOND, type JfItem, type JfSession } from "../jellyfin/types.js";
import { log as defaultLog } from "../log.js";
import {
  MOVIES_SOURCE_ID,
  type EpisodeInfo,
  type EpisodeListItem,
  type JellyfinStatus,
  type MovieSummary,
  type PlayOrder,
  type PublicState,
  type SeriesState,
  type Settings,
} from "../shared/types.js";
import { SETTING_BOUNDS, type Store } from "../store.js";
import { toEpisodeInfo, type Library, type SeriesEpisodes } from "./library.js";
import * as queue from "./queue.js";

// Boucle de surveillance de MPV Shim (port du script fish) + actions de l'interface.
//
// Comportement repris du script :
// - quand il reste moins de `changeBeforeEndSec` sur un épisode lancé par nous (et pas en pause),
//   on envoie Stop (pour bloquer l'autoplay de Jellyfin) puis PlayNow de l'épisode suivant ;
// - en pause, on ne fait rien.
// Ajouts :
// - l'épisode suivant vient de la file (tirée à l'avance) ;
// - un contenu lancé manuellement n'est pas interrompu : on reprend la main quand la lecture s'arrête ;
// - RunTimeTicks absent ou nul : on ne coupe pas ;
// - après un changement, la session est ignorée quelques secondes (elle remonte encore l'ancien épisode) ;
// - films : on passe au suivant dès le début du générique (segment « Outro » d'Intro Skipper), s'il est connu ;
// - la liste « Films déjà vus » est une source virtuelle (MOVIES_SOURCE_ID) traitée comme une série.

/** Un « Outro » avant cette fraction de la durée est pris pour une mauvaise détection et ignoré. */
const MIN_CREDITS_RATIO = 0.5;

/** Fenêtre pendant laquelle la session est ignorée après un changement d'épisode. */
export const SETTLE_MS = 8000;
/** Délai maximal d'apparition du nouvel épisode dans la session après PlayNow. */
export const PENDING_TIMEOUT_MS = 30000;
/** Durée sans lecture avant de lancer l'épisode suivant (évite les faux « arrêts » transitoires). */
export const IDLE_GRACE_MS = 6000;
/** Pause entre Stop et PlayNow (comme le script fish). */
export const STOP_DELAY_MS = 2000;

const HISTORY_SUMMARY = 20;

type Logger = Pick<typeof defaultLog, "info" | "warn" | "error">;

export interface LoopDeps {
  api: JellyfinApi;
  store: Store;
  library: Library;
  match: () => PlayerMatchConfig;
  isConfigured: () => Promise<boolean>;
  defaultSeriesName: () => string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
}

export class PlayerLoop extends EventEmitter {
  private readonly api: JellyfinApi;
  private readonly store: Store;
  private readonly library: Library;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: Logger;

  private configured = false;
  private jellyfin: JellyfinStatus = "unknown";
  private jellyfinError?: string;
  private session?: JfSession;
  private sampledAt = 0;

  private ignoreUntil = 0;
  private pending?: { id: string; since: number };
  private idleSince?: number;
  private foreignId?: string;

  private lock: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private running = false;
  private lastPublished = "";
  private remote = 0;

  constructor(private readonly deps: LoopDeps) {
    super();
    this.api = deps.api;
    this.store = deps.store;
    this.library = deps.library;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = deps.log ?? defaultLog;
  }

  // --- Cycle de vie -----------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    const run = async () => {
      if (!this.running) return;
      await this.tick().catch((err) => this.log.error(`Surveillance : ${(err as Error).message}`));
      if (this.running) this.timer = setTimeout(run, this.store.settings.pollIntervalMs);
    };
    void run();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    clearTimeout(this.refreshTimer);
  }

  /** Relevé anticipé (après une action, pour que l'interface se mette à jour vite). */
  refreshSoon(delayMs = 800): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.tick().catch(() => undefined), delayMs);
  }

  set remoteClients(count: number) {
    this.remote = count;
    this.publish();
  }

  /** Les opérations sur le lecteur et la file sont exécutées une par une. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lock.then(fn, fn);
    this.lock = result.catch(() => {});
    return result;
  }

  // --- Surveillance -------------------------------------------------------------

  async tick(): Promise<void> {
    await this.exclusive(async () => {
      this.configured = await this.deps.isConfigured();
      if (!this.configured) {
        this.setJellyfin("unknown");
        this.setSession(undefined);
        return;
      }

      let sessions: JfSession[];
      try {
        sessions = await this.api.getSessions();
      } catch (err) {
        const status = err instanceof JellyfinError && err.kind === "unauthorized" ? "unauthorized" : "unreachable";
        this.setJellyfin(status, (err as Error).message);
        this.setSession(undefined);
        return;
      }
      this.setJellyfin("ok");
      this.setSession(findPlayerSession(sessions, this.deps.match()));
      this.sampledAt = this.now();

      const episodes = await this.ensureSeries().catch((err) => {
        this.log.warn(`Épisodes indisponibles : ${(err as Error).message}`);
        return undefined;
      });

      const playing = this.session?.NowPlayingItem;
      if (playing) {
        await this.library.getTracks(playing.Id).catch(() => undefined);
        if (playing.Type === "Movie") await this.library.getCredits(playing.Id).catch(() => undefined);
      }

      if (this.session && episodes) {
        // Les échecs sont déjà journalisés ; la boucle doit continuer quoi qu'il arrive.
        await this.supervise(this.session, episodes).catch(() => undefined);
      }
    });
    this.publish();
  }

  private setJellyfin(status: JellyfinStatus, error?: string): void {
    if (status !== this.jellyfin) {
      if (status === "ok") this.log.info("Jellyfin accessible.");
      else if (status !== "unknown") this.log.error(error ?? `Jellyfin : ${status}`);
    }
    this.jellyfin = status;
    this.jellyfinError = status === "ok" ? undefined : error;
  }

  private setSession(session: JfSession | undefined): void {
    if (this.jellyfin === "ok") {
      if (session && session.Id !== this.session?.Id) {
        this.log.info(`MPV Shim trouvé : ${session.Client ?? "?"} sur ${session.DeviceName ?? "?"} (session ${session.Id}).`);
      } else if (!session && this.session) {
        this.log.warn("Session MPV Shim introuvable.");
      }
    }
    this.session = session;
  }

  private async supervise(session: JfSession, episodes: SeriesEpisodes): Promise<void> {
    const settings = this.store.settings;
    const now = this.now();
    if (!settings.autoMode) {
      this.idleSince = undefined;
      return;
    }
    if (now < this.ignoreUntil) return;

    const item = session.NowPlayingItem;
    const playState = session.PlayState ?? {};

    if (this.pending) {
      if (item?.Id === this.pending.id) {
        this.pending = undefined;
      } else if (now - this.pending.since < PENDING_TIMEOUT_MS) {
        return;
      } else {
        this.log.warn("L'épisode lancé n'est jamais apparu dans la session MPV Shim.");
        this.pending = undefined;
      }
    }

    if (!item) {
      this.foreignId = undefined;
      this.idleSince ??= now;
      if (now - this.idleSince < IDLE_GRACE_MS) return;
      this.idleSince = undefined;
      this.log.info("Aucune lecture en cours : lancement de l'épisode suivant.");
      await this.advance(session, episodes, { stopFirst: false });
      return;
    }
    this.idleSince = undefined;

    if (item.Id !== this.store.state.lastStarted?.id) {
      if (this.foreignId !== item.Id) {
        this.foreignId = item.Id;
        this.log.info(`Lecture manuelle détectée (« ${item.Name ?? item.Id} ») : pas d'intervention jusqu'à l'arrêt.`);
      }
      return;
    }
    this.foreignId = undefined;

    if (playState.IsPaused) return;

    const runtime = item.RunTimeTicks ?? 0;
    if (runtime <= 0) return;

    const position = playState.PositionTicks ?? 0;
    const creditsAt = this.creditsTicks(item);
    if (creditsAt !== undefined && position >= creditsAt) {
      this.log.info("Générique atteint : arrêt préventif et film suivant.");
      await this.advance(session, episodes, { stopFirst: true });
    } else if (runtime - position < settings.changeBeforeEndSec * TICKS_PER_SECOND) {
      this.log.info("Épisode bientôt terminé : arrêt préventif pour empêcher l'autoplay.");
      await this.advance(session, episodes, { stopFirst: true });
    }
  }

  /** Début du générique (ticks) d'un film, s'il est connu, plausible et que l'option est active. */
  private creditsTicks(item: JfItem): number | undefined {
    const runtime = item.RunTimeTicks ?? 0;
    if (!this.store.settings.skipCredits || item.Type !== "Movie" || runtime <= 0) return undefined;
    const startSec = this.library.cachedCredits(item.Id);
    if (startSec === null) return undefined;
    const ticks = startSec * TICKS_PER_SECOND;
    return ticks >= runtime * MIN_CREDITS_RATIO && ticks < runtime ? ticks : undefined;
  }

  /** Lance l'épisode suivant de la file (ou `episodeId`). Renvoie l'ID lancé. */
  private async advance(
    session: JfSession,
    episodes: SeriesEpisodes,
    /** `taken` : file et historique déjà mis à jour par l'appelant (épisode précédent). */
    opts: { stopFirst: boolean; episodeId?: string; taken?: boolean },
  ): Promise<string> {
    const state = this.store.seriesState(episodes.seriesId);
    const ctx = this.queueContext(episodes);
    const id =
      opts.taken && opts.episodeId
        ? opts.episodeId
        : opts.episodeId
          ? queue.takeSpecific(state, opts.episodeId, ctx)
          : queue.takeNext(state, ctx);
    if (!id) throw new HttpError(409, "Aucun épisode disponible dans cette série.");
    this.store.save();

    const info = episodes.byId.get(id);
    this.log.info(`Épisode choisi : ${info ? label(info) : id}`);

    if (opts.stopFirst) {
      try {
        await this.api.playstate(session.Id, "Stop");
      } catch (err) {
        this.log.warn(`Stop refusé : ${(err as Error).message}`);
      }
      await this.sleep(STOP_DELAY_MS);
    }

    try {
      await this.api.play(session.Id, id);
    } catch (err) {
      if (!opts.taken) queue.undoTake(state, id, ctx);
      this.store.save();
      this.ignoreUntil = this.now() + SETTLE_MS;
      this.log.error(`Lancement impossible : ${(err as Error).message}`);
      throw err;
    }

    const now = this.now();
    this.store.state.lastStarted = { id, seriesId: episodes.seriesId, at: now };
    this.store.save();
    this.ignoreUntil = now + SETTLE_MS;
    this.pending = { id, since: now };
    this.idleSince = undefined;
    this.foreignId = undefined;
    this.log.info("Lecture lancée.");
    return id;
  }

  // --- Série courante -------------------------------------------------------------

  /** Épisodes d'une série, ou films de la liste « déjà vus » pour la source virtuelle. */
  private loadSource(seriesId: string, force = false): Promise<SeriesEpisodes> {
    return seriesId === MOVIES_SOURCE_ID
      ? this.library.movieSource(this.store.state.movies, force)
      : this.library.getEpisodes(seriesId, force);
  }

  /** Résout la série courante (série par défaut au premier lancement, import de l'ancien historique). */
  private async ensureSeries(): Promise<SeriesEpisodes | undefined> {
    const state = this.store.state;
    if (!state.currentSeriesId) {
      const name = this.deps.defaultSeriesName();
      const found = await this.library.findSeriesByName(name);
      if (!found) return undefined;
      state.currentSeriesId = found.id;
      this.log.info(`Série par défaut : ${found.name}.`);
      this.store.save();
    }

    let episodes: SeriesEpisodes;
    try {
      episodes = await this.loadSource(state.currentSeriesId);
    } catch (err) {
      if (!(err instanceof JellyfinError && err.kind === "http")) throw err;
      episodes = { seriesId: state.currentSeriesId, seriesName: "", episodes: [], byId: new Map(), fetchedAt: 0 };
    }
    if (episodes.episodes.length === 0) {
      if (state.currentSeriesId === MOVIES_SOURCE_ID) {
        // Liste de films vide : on garde la source (des films y seront ajoutés), sans file périmée.
        const series = this.store.seriesState(MOVIES_SOURCE_ID);
        if (series.queue.length > 0) {
          series.queue = [];
          this.store.save();
        }
        return undefined;
      }
      // Série supprimée, ou appartenant à un autre serveur / compte : il faut en choisir une autre.
      this.log.warn("La série sélectionnée est introuvable ou vide : choisir une série dans les réglages.");
      state.currentSeriesId = "";
      this.store.save();
      return undefined;
    }
    const series = this.store.seriesState(state.currentSeriesId);

    if (state.pendingImport && state.currentSeriesId !== MOVIES_SOURCE_ID) {
      const known = new Set(episodes.byId.keys());
      const imported = state.pendingImport.filter((id) => known.has(id));
      series.history = [...imported.map((id) => ({ id, at: 0 })), ...series.history];
      this.log.info(`Ancien historique importé : ${imported.length} épisode(s) pour ${episodes.seriesName}.`);
      delete state.pendingImport;
    }

    const before = JSON.stringify(series);
    const ctx = this.queueContext(episodes);
    queue.sanitize(series, ctx);
    queue.refill(series, ctx);
    if (JSON.stringify(series) !== before) this.store.save();
    return episodes;
  }

  private queueContext(episodes: SeriesEpisodes): queue.QueueContext {
    return {
      episodeIds: episodes.episodes.map((e) => e.id),
      currentId: this.currentEpisodeId(episodes),
      settings: this.store.settings,
      now: this.now,
    };
  }

  /** Épisode de la série en cours de lecture (ou, à défaut, le dernier lancé par l'application). */
  private currentEpisodeId(episodes: SeriesEpisodes): string | undefined {
    // Juste après un lancement, la session renvoie encore l'ancien épisode : on se fie au nôtre.
    if (this.pending && episodes.byId.has(this.pending.id)) return this.pending.id;
    const playing = this.session?.NowPlayingItem?.Id;
    if (playing && episodes.byId.has(playing)) return playing;
    const last = this.store.state.lastStarted;
    return last && episodes.byId.has(last.id) ? last.id : undefined;
  }

  private async currentEpisodes(): Promise<SeriesEpisodes> {
    const episodes = await this.ensureSeries();
    if (!episodes) {
      const emptyList = this.store.state.currentSeriesId === MOVIES_SOURCE_ID;
      throw new HttpError(409, emptyList ? "Liste de films vide : ajouter des films." : "Aucune série sélectionnée.");
    }
    return episodes;
  }

  // --- Actions ------------------------------------------------------------------

  private requireSession(): JfSession {
    if (!this.configured) throw new HttpError(409, "Application pas encore configurée.");
    if (this.jellyfin !== "ok") throw new HttpError(503, this.jellyfinError ?? "Jellyfin injoignable.");
    if (!this.session) throw new HttpError(409, "MPV Shim introuvable.");
    return this.session;
  }

  private action<T>(fn: (session: JfSession) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const result = await fn(this.requireSession());
      this.refreshSoon();
      return result;
    });
  }

  pause(): Promise<void> {
    return this.action((s) => this.api.playstate(s.Id, "Pause"));
  }

  resume(): Promise<void> {
    return this.action((s) => this.api.playstate(s.Id, "Unpause"));
  }

  /** Passe à l'épisode suivant de la file (reprend la main même sur un contenu manuel). */
  skip(): Promise<string> {
    return this.action(async (s) => this.advance(s, await this.currentEpisodes(), { stopFirst: false }));
  }

  /** Arrête la lecture et désactive le mode auto (sinon la boucle relancerait un épisode). */
  stopPlayback(): Promise<void> {
    return this.action(async (s) => {
      if (this.store.settings.autoMode) {
        this.store.settings.autoMode = false;
        this.store.save();
        this.log.info("Arrêt demandé : mode auto désactivé.");
      }
      await this.api.playstate(s.Id, "Stop");
    });
  }

  /** Saut relatif (ex. -15, +5) à partir de la position estimée maintenant. */
  seekBy(deltaSec: number): Promise<void> {
    return this.action(async (s) => {
      const item = s.NowPlayingItem;
      if (!item) throw new HttpError(409, "Rien en cours de lecture.");
      const playState = s.PlayState ?? {};
      let position = (playState.PositionTicks ?? 0) / TICKS_PER_SECOND;
      // Le relevé date de quelques secondes : on tient compte du temps écoulé depuis.
      if (!playState.IsPaused) position += Math.max(0, this.now() - this.sampledAt) / 1000;
      const runtime = item.RunTimeTicks ? item.RunTimeTicks / TICKS_PER_SECOND : Infinity;
      const target = Math.min(Math.max(0, position + deltaSec), Math.max(0, runtime - 1));
      await this.api.playstate(s.Id, "Seek", { seekPositionTicks: Math.round(target * TICKS_PER_SECOND) });
    });
  }

  seek(positionSec: number): Promise<void> {
    return this.action(async (s) => {
      const runtime = s.NowPlayingItem?.RunTimeTicks;
      if (!s.NowPlayingItem) throw new HttpError(409, "Rien en cours de lecture.");
      let ticks = Math.max(0, Math.round(positionSec * TICKS_PER_SECOND));
      if (runtime && runtime > 0) ticks = Math.min(ticks, runtime - TICKS_PER_SECOND);
      await this.api.playstate(s.Id, "Seek", { seekPositionTicks: ticks });
    });
  }

  setVolume(volume: number): Promise<void> {
    const value = Math.round(Math.min(100, Math.max(0, volume)));
    return this.action((s) => this.api.command(s.Id, "SetVolume", { Volume: String(value) }));
  }

  setMuted(muted: boolean): Promise<void> {
    return this.action((s) => this.api.command(s.Id, muted ? "Mute" : "Unmute"));
  }

  setAudioTrack(index: number): Promise<void> {
    return this.action((s) => this.api.command(s.Id, "SetAudioStreamIndex", { Index: String(index) }));
  }

  /** -1 = sous-titres désactivés. */
  setSubtitleTrack(index: number): Promise<void> {
    return this.action((s) => this.api.command(s.Id, "SetSubtitleStreamIndex", { Index: String(index) }));
  }

  setAutoMode(enabled: boolean): Promise<void> {
    return this.exclusive(async () => {
      this.store.settings.autoMode = enabled;
      this.idleSince = undefined;
      this.store.save();
      this.log.info(`Mode auto ${enabled ? "activé" : "désactivé"}.`);
      this.refreshSoon(100);
    });
  }

  updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.exclusive(async () => {
      const settings = this.store.settings;
      for (const key of Object.keys(SETTING_BOUNDS) as (keyof typeof SETTING_BOUNDS)[]) {
        const value = patch[key];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, `${key} invalide.`);
        const [min, max] = SETTING_BOUNDS[key];
        if (value < min || value > max) throw new HttpError(400, `${key} doit être entre ${min} et ${max}.`);
        settings[key] = key === "historyRatio" ? value : Math.round(value);
      }
      if (patch.skipCredits !== undefined) {
        if (typeof patch.skipCredits !== "boolean") throw new HttpError(400, "skipCredits invalide.");
        settings.skipCredits = patch.skipCredits;
      }
      this.store.save();
      // La taille de file / d'historique a pu changer.
      const cached = this.library.cachedEpisodes(this.store.state.currentSeriesId);
      if (cached) {
        const series = this.store.seriesState(cached.seriesId);
        queue.sanitize(series, this.queueContext(cached));
        queue.refill(series, this.queueContext(cached));
      }
      this.refreshSoon(100);
      return { ...settings };
    });
  }

  /** Change de série ; `playNow` lance immédiatement son premier épisode de file. */
  setSeries(seriesId: string, playNow: boolean): Promise<void> {
    return this.exclusive(async () => {
      const episodes = await this.loadSource(seriesId, true);
      // La liste de films peut être choisie vide : on y ajoutera des films ensuite.
      if (episodes.episodes.length === 0 && seriesId !== MOVIES_SOURCE_ID) {
        throw new HttpError(400, "Cette série ne contient aucun épisode.");
      }
      this.store.state.currentSeriesId = seriesId;
      this.store.save();
      this.log.info(`Série sélectionnée : ${episodes.seriesName || seriesId}.`);
      await this.ensureSeries();
      if (playNow && this.session && this.jellyfin === "ok" && episodes.episodes.length > 0) {
        await this.advance(this.session, episodes, { stopFirst: false });
      }
      this.refreshSoon();
    });
  }

  // --- Liste « Films déjà vus » -------------------------------------------------

  /** Enregistre la liste et remet la file de la source « films » en accord avec elle. */
  private async moviesChanged(): Promise<void> {
    this.store.save();
    if (this.store.state.currentSeriesId === MOVIES_SOURCE_ID) await this.ensureSeries().catch(() => undefined);
    this.publish();
  }

  /** Ajoute des films à la liste (seuls ceux qui existent dans Jellyfin). Renvoie le nombre ajouté. */
  addMovies(ids: string[]): Promise<number> {
    return this.exclusive(async () => {
      const known = new Set((await this.library.listMovies()).map((movie) => movie.info.id));
      const list = this.store.state.movies;
      const have = new Set(list);
      const added = [...new Set(ids)].filter((id) => known.has(id) && !have.has(id));
      if (added.length > 0) {
        list.push(...added);
        this.log.info(`Films ajoutés à la liste : ${added.length}.`);
        await this.moviesChanged();
      }
      return added.length;
    });
  }

  removeMovie(id: string): Promise<void> {
    return this.exclusive(async () => {
      const list = this.store.state.movies;
      const index = list.indexOf(id);
      if (index < 0) throw new HttpError(404, "Film absent de la liste.");
      list.splice(index, 1);
      await this.moviesChanged();
    });
  }

  /** Ajoute à la liste tous les films marqués « vus » dans Jellyfin. Renvoie le nombre ajouté. */
  importPlayedMovies(): Promise<number> {
    return this.exclusive(async () => {
      const played = (await this.library.listMovies(true)).filter((movie) => movie.played).map((movie) => movie.info.id);
      const list = this.store.state.movies;
      const have = new Set(list);
      const added = played.filter((id) => !have.has(id));
      if (added.length > 0) {
        list.push(...added);
        this.log.info(`Films vus importés depuis Jellyfin : ${added.length}.`);
        await this.moviesChanged();
      }
      return added.length;
    });
  }

  /** Films de la bibliothèque, avec leur présence dans la liste et leur statut « vu » dans Jellyfin. */
  async movies(): Promise<MovieSummary[]> {
    const inList = new Set(this.store.state.movies);
    return (await this.library.listMovies()).map(({ info, played }) => ({
      id: info.id,
      name: info.name,
      year: info.year,
      runTimeSec: info.runTimeSec,
      played,
      inList: inList.has(info.id),
    }));
  }

  // --- File et historique -------------------------------------------------------

  private queueOp<T>(fn: (state: SeriesState, ctx: queue.QueueContext, episodes: SeriesEpisodes) => T): Promise<T> {
    return this.exclusive(async () => {
      const episodes = await this.currentEpisodes();
      const result = fn(this.store.seriesState(episodes.seriesId), this.queueContext(episodes), episodes);
      this.store.save();
      this.publish();
      return result;
    });
  }

  reroll(): Promise<void> {
    return this.queueOp((state, ctx) => queue.reroll(state, ctx));
  }

  removeFromQueue(episodeId: string): Promise<void> {
    return this.queueOp((state, ctx) => {
      if (!queue.removeFromQueue(state, episodeId, ctx)) throw new HttpError(404, "Épisode absent de la file.");
    });
  }

  reorderQueue(order: string[]): Promise<void> {
    return this.queueOp((state) => {
      if (!queue.reorder(state, order)) throw new HttpError(400, "L'ordre doit contenir exactement les épisodes de la file.");
    });
  }

  /** Épisode précédent (dans la série en mode ordre, dans l'historique en aléatoire). */
  previous(): Promise<string> {
    return this.action(async (s) => {
      const episodes = await this.currentEpisodes();
      const state = this.store.seriesState(episodes.seriesId);
      const id = queue.stepBack(state, this.queueContext(episodes));
      if (!id) throw new HttpError(409, "Pas d'épisode précédent.");
      this.store.save();
      return this.advance(s, episodes, { stopFirst: false, episodeId: id, taken: true });
    });
  }

  /** « Lire ensuite » : place l'épisode en tête de file. */
  playNext(episodeId: string): Promise<void> {
    return this.queueOp((state, ctx, episodes) => {
      if (!episodes.byId.has(episodeId)) throw new HttpError(404, "Épisode inconnu dans cette série.");
      queue.playNext(state, episodeId, ctx);
    });
  }

  setOrder(order: PlayOrder): Promise<void> {
    return this.queueOp((state, ctx, episodes) => {
      queue.setOrder(state, order, ctx);
      this.log.info(`${episodes.seriesName} : lecture ${order === "sequential" ? "dans l'ordre" : "aléatoire"}.`);
    });
  }

  /** Tous les épisodes de la série courante, avec leur statut. */
  async episodes(): Promise<EpisodeListItem[]> {
    const episodes = await this.currentEpisodes();
    const state = this.store.seriesState(episodes.seriesId);
    const seen = new Set(state.history.map((entry) => entry.id));
    const queued = new Set(state.queue);
    const current = this.currentEpisodeId(episodes);
    return episodes.episodes.map((e) => ({ ...e, seen: seen.has(e.id), queued: queued.has(e.id), playing: e.id === current }));
  }

  playNow(episodeId: string): Promise<string> {
    return this.action(async (s) => {
      const episodes = await this.currentEpisodes();
      if (!episodes.byId.has(episodeId)) throw new HttpError(404, "Épisode inconnu dans cette série.");
      return this.advance(s, episodes, { stopFirst: false, episodeId });
    });
  }

  resetHistory(): Promise<void> {
    return this.queueOp((state, ctx, episodes) => {
      state.history = [];
      queue.refill(state, ctx);
      this.log.info(`Historique réinitialisé pour ${episodes.seriesName}.`);
    });
  }

  history(limit: number): (EpisodeInfo & { at: number })[] {
    const seriesId = this.store.state.currentSeriesId;
    const episodes = this.library.cachedEpisodes(seriesId);
    const entries = this.store.state.series[seriesId]?.history ?? [];
    return entries
      .slice(-Math.max(0, limit))
      .reverse()
      .map((entry) => ({ ...this.describe(entry.id, episodes), at: entry.at }));
  }

  // --- État public ----------------------------------------------------------------

  private describe(id: string, episodes?: SeriesEpisodes): EpisodeInfo {
    return episodes?.byId.get(id) ?? { id, name: "Épisode inconnu" };
  }

  snapshot(): PublicState {
    const settings = this.store.settings;
    const seriesId = this.store.state.currentSeriesId;
    const episodes = seriesId ? this.library.cachedEpisodes(seriesId) : undefined;
    const seriesState = seriesId ? this.store.state.series[seriesId] : undefined;
    const session = this.session;
    const item = session?.NowPlayingItem;
    const playState = session?.PlayState ?? {};
    const tracks = item ? this.library.cachedTracks(item.Id) : undefined;
    const creditsAt = item ? this.creditsTicks(item) : undefined;
    const lim = queue.limits(episodes?.episodes.length ?? 0, settings);

    return {
      configured: this.configured,
      jellyfin: this.jellyfin,
      jellyfinError: this.jellyfinError,
      player: !this.configured || this.jellyfin !== "ok" ? "unknown" : session ? "ok" : "missing",
      session: session && {
        id: session.Id,
        client: session.Client,
        deviceName: session.DeviceName,
        deviceId: session.DeviceId,
        supportedCommands: supportedCommands(session),
      },
      settings: { ...settings },
      series: episodes
        ? {
            id: episodes.seriesId,
            name: episodes.seriesName,
            episodeCount: episodes.episodes.length,
            kind: episodes.seriesId === MOVIES_SOURCE_ID ? "movies" : "series",
          }
        : null,
      movieCount: this.store.state.movies.length,
      nowPlaying: item
        ? {
            ...(episodes?.byId.get(item.Id) ?? toEpisodeInfo(item)),
            positionSec: (playState.PositionTicks ?? 0) / TICKS_PER_SECOND,
            creditsStartSec: creditsAt === undefined ? undefined : creditsAt / TICKS_PER_SECOND,
            isPaused: playState.IsPaused ?? false,
            canSeek: playState.CanSeek ?? true,
            managed: item.Id === this.store.state.lastStarted?.id,
          }
        : null,
      volume: playState.VolumeLevel ?? null,
      muted: playState.IsMuted ?? false,
      audioIndex: playState.AudioStreamIndex ?? null,
      subtitleIndex: playState.SubtitleStreamIndex ?? null,
      audioTracks: tracks?.audio ?? [],
      subtitleTracks: tracks?.subtitles ?? [],
      queue: (seriesState?.queue ?? []).map((id) => this.describe(id, episodes)),
      history: this.history(HISTORY_SUMMARY),
      historyCount: seriesState?.history.length ?? 0,
      order: seriesState?.order ?? "shuffle",
      canPrevious: Boolean(
        episodes && seriesState && queue.previousOf(seriesState, this.queueContext(episodes)) !== undefined,
      ),
      historyLimit: lim.historyLimit,
      sampledAt: this.sampledAt,
      remoteClients: this.remote,
    };
  }

  /** Diffuse l'état s'il a changé (ou systématiquement avec `force`). */
  publish(force = false): void {
    const state = this.snapshot();
    const key = JSON.stringify({ ...state, sampledAt: 0 });
    if (!force && key === this.lastPublished) return;
    this.lastPublished = key;
    this.emit("state", state);
  }

  /** Sessions brutes (diagnostic / assistant). */
  async rawSessions(): Promise<JfSession[]> {
    return this.api.getSessions();
  }

  /** À appeler quand la configuration (serveur, compte) change. */
  resetConnection(): void {
    this.library.clear();
    this.session = undefined;
    this.jellyfin = "unknown";
    this.pending = undefined;
    this.ignoreUntil = 0;
    this.refreshSoon(50);
  }
}

function label(info: EpisodeInfo): string {
  if (info.type === "Movie") return info.year ? `${info.name} (${info.year})` : info.name;
  const pad = (n?: number) => String(n ?? 0).padStart(2, "0");
  return `S${pad(info.season)}E${pad(info.episode)} - ${info.name}`;
}
