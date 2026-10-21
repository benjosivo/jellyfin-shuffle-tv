import type { SeriesState, Settings } from "../shared/types.js";

// File d'attente et historique d'une série. Fonctions pures sur SeriesState.
//
// - La file contient `queueSize` épisodes, tirés hors historique et hors file.
// - L'historique est une FIFO dont la taille dépend de la série (historyRatio × nb d'épisodes),
//   bornée pour qu'il reste toujours au moins un épisode à tirer (l'ancien script utilisait
//   190 en dur, calibré pour The Office).

export interface QueueContext {
  /** Tous les épisodes de la série. */
  episodeIds: string[];
  settings: Pick<Settings, "historyRatio" | "queueSize">;
  random?: () => number;
  now?: () => number;
}

export interface Limits {
  queueSize: number;
  historyLimit: number;
}

export function limits(episodeCount: number, settings: QueueContext["settings"]): Limits {
  const n = Math.max(0, episodeCount);
  const queueSize = clamp(Math.floor(settings.queueSize), 0, Math.max(0, n - 1));
  const historyLimit = clamp(Math.floor(n * settings.historyRatio), 0, Math.max(0, n - queueSize - 1));
  return { queueSize, historyLimit };
}

/** Retire les épisodes qui n'existent plus et les doublons, puis applique les limites. */
export function sanitize(state: SeriesState, ctx: QueueContext): void {
  const known = new Set(ctx.episodeIds);
  const seen = new Set<string>();
  // Historique : on garde l'occurrence la plus récente de chaque épisode.
  const history = [];
  for (let i = state.history.length - 1; i >= 0; i--) {
    const entry = state.history[i]!;
    if (known.has(entry.id) && !seen.has(entry.id)) {
      seen.add(entry.id);
      history.unshift(entry);
    }
  }
  state.history = history;
  const queued = new Set<string>();
  state.queue = state.queue.filter((id) => known.has(id) && !queued.has(id) && !seen.has(id) && queued.add(id));
  trimHistory(state, ctx);
  const { queueSize } = limits(ctx.episodeIds.length, ctx.settings);
  if (state.queue.length > queueSize) state.queue.length = queueSize;
}

function trimHistory(state: SeriesState, ctx: QueueContext): void {
  const { historyLimit } = limits(ctx.episodeIds.length, ctx.settings);
  if (state.history.length > historyLimit) state.history.splice(0, state.history.length - historyLimit);
}

/**
 * Tire un épisode hors historique et hors file, en évitant si possible ceux de `avoid`.
 * Si tout est exclu, l'historique est vidé (comme l'ancien script).
 */
export function draw(state: SeriesState, ctx: QueueContext, avoid: ReadonlySet<string> = new Set()): string | undefined {
  const random = ctx.random ?? Math.random;
  const excluded = new Set([...state.history.map((entry) => entry.id), ...state.queue]);
  let pool = ctx.episodeIds.filter((id) => !excluded.has(id));
  if (pool.length === 0) {
    state.history = [];
    const queued = new Set(state.queue);
    pool = ctx.episodeIds.filter((id) => !queued.has(id));
  }
  if (pool.length === 0) return undefined;
  const preferred = pool.filter((id) => !avoid.has(id));
  const candidates = preferred.length > 0 ? preferred : pool;
  return candidates[Math.floor(random() * candidates.length)];
}

export function refill(state: SeriesState, ctx: QueueContext, avoid?: ReadonlySet<string>): void {
  const { queueSize } = limits(ctx.episodeIds.length, ctx.settings);
  if (state.queue.length > queueSize) state.queue.length = queueSize;
  while (state.queue.length < queueSize) {
    const id = draw(state, ctx, avoid);
    if (!id) break;
    state.queue.push(id);
  }
}

export function addToHistory(state: SeriesState, id: string, ctx: QueueContext): void {
  state.history = state.history.filter((entry) => entry.id !== id);
  state.history.push({ id, at: (ctx.now ?? Date.now)() });
  trimHistory(state, ctx);
}

/** Épisode suivant : tête de file (ou tirage si la file est vide), ajouté à l'historique. */
export function takeNext(state: SeriesState, ctx: QueueContext): string | undefined {
  const id = state.queue.shift() ?? draw(state, ctx);
  if (!id) return undefined;
  addToHistory(state, id, ctx);
  refill(state, ctx);
  return id;
}

/** « Lire maintenant » : un épisode précis (de la file ou non), ajouté à l'historique. */
export function takeSpecific(state: SeriesState, id: string, ctx: QueueContext): string {
  state.queue = state.queue.filter((queued) => queued !== id);
  addToHistory(state, id, ctx);
  refill(state, ctx);
  return id;
}

/** Annule un `take*` dont le lancement a échoué : l'épisode revient en tête de file. */
export function undoTake(state: SeriesState, id: string, ctx: QueueContext): void {
  const last = state.history[state.history.length - 1];
  if (last?.id === id) state.history.pop();
  state.queue = [id, ...state.queue.filter((queued) => queued !== id)];
  const { queueSize } = limits(ctx.episodeIds.length, ctx.settings);
  if (state.queue.length > Math.max(queueSize, 1)) state.queue.length = Math.max(queueSize, 1);
}

export function removeFromQueue(state: SeriesState, id: string, ctx: QueueContext): boolean {
  const before = state.queue.length;
  state.queue = state.queue.filter((queued) => queued !== id);
  if (state.queue.length === before) return false;
  // On recomplète sans retirer aussitôt l'épisode qu'on vient d'enlever.
  refill(state, ctx, new Set([id]));
  return true;
}

/** Réordonne la file : `order` doit être une permutation exacte de la file actuelle. */
export function reorder(state: SeriesState, order: string[]): boolean {
  if (order.length !== state.queue.length) return false;
  const current = new Set(state.queue);
  if (new Set(order).size !== order.length || !order.every((id) => current.has(id))) return false;
  state.queue = [...order];
  return true;
}

/** Nouveau tirage complet, en évitant si possible les épisodes de l'ancienne file. */
export function reroll(state: SeriesState, ctx: QueueContext): void {
  const previous = new Set(state.queue);
  state.queue = [];
  refill(state, ctx, previous);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
