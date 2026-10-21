import fs from "node:fs/promises";
import { writeFileAtomic } from "./fsutil.js";
import type { HistoryEntry, SeriesState, Settings } from "./shared/types.js";

// Persistance dans state.json (écriture atomique, regroupée par un petit délai).

export interface PersistedState {
  version: 1;
  currentSeriesId: string;
  settings: Settings;
  series: Record<string, SeriesState>;
  /** Dernier épisode lancé par l'application : sert à le reconnaître après un redémarrage. */
  lastStarted?: { id: string; seriesId: string; at: number };
  /** IDs de l'ancien fichier `history`, rattachés à la série par défaut au premier contact. */
  pendingImport?: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  changeBeforeEndSec: 30,
  historyRatio: 0.95,
  queueSize: 5,
  pollIntervalMs: 3000,
  autoMode: true,
};

export const SETTING_BOUNDS = {
  changeBeforeEndSec: [0, 600],
  historyRatio: [0, 1],
  queueSize: [0, 50],
  pollIntervalMs: [1000, 60000],
} as const;

const SAVE_DELAY_MS = 200;

export class Store {
  private timer?: NodeJS.Timeout;
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    readonly file: string,
    public state: PersistedState,
  ) {}

  /** Charge state.json ; au premier lancement, importe l'ancien fichier `history` s'il existe. */
  static async open(file: string, legacyHistoryFile?: string): Promise<Store> {
    let raw: string | undefined;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    let state: PersistedState;
    if (raw !== undefined) {
      try {
        state = normalize(JSON.parse(raw));
      } catch (err) {
        // On ne perd pas un fichier illisible : il est mis de côté.
        const backup = `${file}.corrompu-${Date.now()}`;
        await fs.rename(file, backup).catch(() => {});
        console.error(`state.json illisible (${(err as Error).message}), sauvegardé sous ${backup}`);
        state = normalize({});
      }
    } else {
      state = normalize({});
      if (legacyHistoryFile) {
        const legacy = await readLegacyHistory(legacyHistoryFile);
        if (legacy.length > 0) state.pendingImport = legacy;
      }
    }

    const store = new Store(file, state);
    if (raw === undefined) await store.flush();
    return store;
  }

  get settings(): Settings {
    return this.state.settings;
  }

  seriesState(seriesId: string): SeriesState {
    let entry = this.state.series[seriesId];
    if (!entry) {
      entry = { history: [], queue: [] };
      this.state.series[seriesId] = entry;
    }
    return entry;
  }

  /** Programme une sauvegarde (regroupe les modifications rapprochées). */
  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, SAVE_DELAY_MS);
  }

  /** Sauvegarde immédiate (à l'arrêt, ou quand l'appelant doit attendre l'écriture). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const content = JSON.stringify(this.state, null, 2) + "\n";
    this.saving = this.saving
      .catch(() => {})
      .then(() => writeFileAtomic(this.file, content))
      .catch((err) => console.error(`Impossible d'écrire ${this.file} : ${(err as Error).message}`));
    return this.saving;
  }
}

async function readLegacyHistory(file: string): Promise<string[]> {
  try {
    const text = await fs.readFile(file, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Complète / corrige un état chargé (valeurs manquantes, ancien format d'historique en string[]). */
export function normalize(input: unknown): PersistedState {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const settingsIn = (raw.settings && typeof raw.settings === "object" ? raw.settings : {}) as Record<string, unknown>;

  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(SETTING_BOUNDS) as (keyof typeof SETTING_BOUNDS)[]) {
    const value = settingsIn[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const [min, max] = SETTING_BOUNDS[key];
      settings[key] = Math.min(max, Math.max(min, value));
    }
  }
  if (typeof settingsIn.autoMode === "boolean") settings.autoMode = settingsIn.autoMode;

  const series: Record<string, SeriesState> = {};
  const seriesIn = (raw.series && typeof raw.series === "object" ? raw.series : {}) as Record<string, unknown>;
  for (const [id, value] of Object.entries(seriesIn)) {
    const entry = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const history: HistoryEntry[] = Array.isArray(entry.history)
      ? entry.history.flatMap((item): HistoryEntry[] => {
          if (typeof item === "string") return [{ id: item, at: 0 }];
          if (item && typeof item === "object" && typeof (item as HistoryEntry).id === "string") {
            const at = (item as HistoryEntry).at;
            return [{ id: (item as HistoryEntry).id, at: typeof at === "number" ? at : 0 }];
          }
          return [];
        })
      : [];
    const queue = Array.isArray(entry.queue) ? entry.queue.filter((item): item is string => typeof item === "string") : [];
    series[id] = { history, queue };
  }

  const state: PersistedState = {
    version: 1,
    currentSeriesId: typeof raw.currentSeriesId === "string" ? raw.currentSeriesId : "",
    settings,
    series,
  };
  const last = raw.lastStarted as PersistedState["lastStarted"] | undefined;
  if (last && typeof last.id === "string") state.lastStarted = last;
  if (Array.isArray(raw.pendingImport)) {
    state.pendingImport = raw.pendingImport.filter((item): item is string => typeof item === "string");
  }
  return state;
}
