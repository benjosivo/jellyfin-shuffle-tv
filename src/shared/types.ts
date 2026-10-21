// Types partagés entre le backend et le front (imports `type` uniquement côté front).

export interface Settings {
  /** Secondes avant la fin à partir desquelles on passe à l'épisode suivant. */
  changeBeforeEndSec: number;
  /** Taille de l'historique, en proportion du nombre d'épisodes de la série. */
  historyRatio: number;
  /** Nombre d'épisodes tirés à l'avance. */
  queueSize: number;
  /** Intervalle de surveillance de la session MPV Shim. */
  pollIntervalMs: number;
  /** Mode auto : la boucle enchaîne les épisodes toute seule. */
  autoMode: boolean;
}

export interface HistoryEntry {
  id: string;
  /** Date de lecture (epoch ms). 0 = inconnue (import de l'ancien fichier `history`). */
  at: number;
}

export interface SeriesState {
  /** Du plus ancien au plus récent. */
  history: HistoryEntry[];
  queue: string[];
}

export type JellyfinStatus = "unknown" | "ok" | "unreachable" | "unauthorized";
export type PlayerStatus = "unknown" | "ok" | "missing";

export interface EpisodeInfo {
  id: string;
  name: string;
  seriesId?: string;
  seriesName?: string;
  season?: number;
  episode?: number;
  runTimeSec?: number;
}

export interface Track {
  index: number;
  label: string;
  language?: string;
  isDefault: boolean;
}

export interface NowPlaying extends EpisodeInfo {
  type?: string;
  positionSec: number;
  isPaused: boolean;
  canSeek: boolean;
  /** true si l'épisode a été lancé par l'application (sinon : lecture manuelle). */
  managed: boolean;
}

export interface SessionInfo {
  id: string;
  client?: string;
  deviceName?: string;
  deviceId?: string;
  supportedCommands: string[];
}

export interface PublicState {
  /** Serveur + connexion Jellyfin configurés (sinon : assistant de configuration). */
  configured: boolean;
  jellyfin: JellyfinStatus;
  jellyfinError?: string;
  player: PlayerStatus;
  session?: SessionInfo;
  settings: Settings;
  series: { id: string; name: string; episodeCount: number } | null;
  nowPlaying: NowPlaying | null;
  volume: number | null;
  muted: boolean;
  audioIndex: number | null;
  subtitleIndex: number | null;
  audioTracks: Track[];
  subtitleTracks: Track[];
  queue: EpisodeInfo[];
  history: (EpisodeInfo & { at: number })[];
  historyCount: number;
  historyLimit: number;
  /** Date (epoch ms, horloge serveur) à laquelle l'état de la session a été relevé. */
  sampledAt: number;
  /** Nombre d'interfaces ouvertes depuis un autre appareil (téléphone…). */
  remoteClients: number;
}

export interface SeriesSummary {
  id: string;
  name: string;
  year?: number;
}

export interface LogLine {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface PlayerCandidate {
  deviceId?: string;
  client?: string;
  deviceName?: string;
  userName?: string;
  matches: boolean;
  reasons: string[];
}

export interface SetupStatus {
  configured: boolean;
  serverUrl?: string;
  serverName?: string;
  serverVersion?: string;
  serverReachable: boolean;
  userName?: string;
  loggedIn: boolean;
  /** Nom de ce PC tel qu'il apparaît dans Jellyfin. */
  deviceName: string;
  /** Variables d'environnement qui figent une valeur (non modifiable depuis l'assistant). */
  envOverrides: string[];
  playerDeviceId?: string;
  playerFound: boolean;
  candidates: PlayerCandidate[];
  seriesSelected: boolean;
  platform: string;
}

export interface DiscoveredServer {
  id: string;
  name: string;
  address: string;
}

export interface AccessInfo {
  urls: string[];
  primary: string | null;
  isLocal: boolean;
}

/** Résumé pour l'icône de la zone de notification ("stopped" est déduit par l'icône elle-même). */
export type TrayLevel = "playing" | "paused" | "idle" | "warning" | "stopped";

export interface TraySummary {
  level: TrayLevel;
  /** Une ligne courte (infobulle, titre du menu). */
  title: string;
  /** Détail éventuel (épisode en cours, cause du problème). */
  detail: string;
  canPause: boolean;
  canResume: boolean;
  canSkip: boolean;
}
