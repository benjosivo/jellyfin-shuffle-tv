// Types partagés entre le backend et le front (imports `type` uniquement côté front).

/** Identifiant de la source virtuelle « Films déjà vus » (traitée comme une série). */
export const MOVIES_SOURCE_ID = "films-vus";

export interface Settings {
  /** Secondes avant la fin à partir desquelles on passe à l'épisode suivant. */
  changeBeforeEndSec: number;
  /** Films : passer au suivant dès le début du générique (segment « Outro » d'Intro Skipper). */
  skipCredits: boolean;
  /** Taille de l'historique, en proportion du nombre d'épisodes de la série. */
  historyRatio: number;
  /** Nombre d'épisodes tirés à l'avance. */
  queueSize: number;
  /** Intervalle de surveillance de la session MPV Shim. */
  pollIntervalMs: number;
  /** Mode auto : la boucle enchaîne les épisodes toute seule. */
  autoMode: boolean;
  /** Bloque la mise en veille de ce PC tant qu'une lecture est en cours. */
  preventSleep: boolean;
}

export interface HistoryEntry {
  id: string;
  /** Date de lecture (epoch ms). 0 = inconnue (import de l'ancien fichier `history`). */
  at: number;
}

export type PlayOrder = "shuffle" | "sequential";

export interface SeriesState {
  /** Du plus ancien au plus récent. */
  history: HistoryEntry[];
  queue: string[];
  /** Aléatoire (défaut) ou dans l'ordre de la série. */
  order?: PlayOrder;
  /** Épisode lancé par l'application puis interrompu : repris à cette position au retour. */
  resume?: ResumePoint;
}

export interface ResumePoint {
  id: string;
  positionTicks: number;
  /** Date du relevé (epoch ms). */
  at: number;
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
  /** Année de production (films). */
  year?: number;
  /** Type Jellyfin (« Episode », « Movie »…). */
  type?: string;
}

export interface EpisodeListItem extends EpisodeInfo {
  seen: boolean;
  queued: boolean;
  playing: boolean;
}

export interface Track {
  index: number;
  label: string;
  language?: string;
  isDefault: boolean;
}

export interface NowPlaying extends EpisodeInfo {
  positionSec: number;
  /** Film : début du générique (secondes), si Intro Skipper l'a détecté. */
  creditsStartSec?: number;
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
  series: { id: string; name: string; episodeCount: number; kind: "series" | "movies" } | null;
  /** Nombre de films dans la liste « déjà vus » (même hors source courante). */
  movieCount: number;
  nowPlaying: NowPlaying | null;
  /** Épisode interrompu de la série courante (hors lecture en cours) et position de reprise réelle (recul compris). */
  resumePoint: (EpisodeInfo & { positionSec: number }) | null;
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
  /** Mode de lecture de la série courante. */
  order: PlayOrder;
  canPrevious: boolean;
  /** Date (epoch ms, horloge serveur) à laquelle l'état de la session a été relevé. */
  sampledAt: number;
  /** Nombre d'interfaces ouvertes depuis un autre appareil (téléphone…). */
  remoteClients: number;
}

export interface SeriesSummary {
  id: string;
  name: string;
  year?: number;
  kind?: "series" | "movies";
}

export interface MovieSummary {
  id: string;
  name: string;
  year?: number;
  runTimeSec?: number;
  /** Marqué « vu » dans Jellyfin. */
  played: boolean;
  /** Présent dans la liste de l'application. */
  inList: boolean;
}

export interface LogLine {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

/** Écran vers lequel la lecture peut être transférée (session Jellyfin pilotable du même utilisateur). */
export interface PlayerTarget {
  deviceId: string;
  deviceName?: string;
  client?: string;
  /** Écran actuellement piloté par l'application. */
  current: boolean;
  nowPlaying?: string;
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

/** Version de l'application (package.json) et commit du dossier d'installation, s'il est un dépôt git. */
export interface AppVersion {
  version: string;
  commit?: string;
}

/** Résultat de la recherche de mise à jour : "blocked" = disponible mais le script d'installation la refuserait. */
export interface UpdateStatus {
  state: "up-to-date" | "available" | "blocked" | "unavailable";
  message: string;
  current?: string;
  latest?: string;
  behind?: number;
  /** Titres des derniers commits à récupérer. */
  changes?: string[];
}

/** Réglage audio de MPV Shim : `available` = son dossier de configuration est sur ce PC. */
export interface AudioStatus {
  available: boolean;
  compressor: boolean;
  /** Sortie audio choisie dans l'interface (valeur de `audio-device` de mpv) ; null = celle par défaut du système. */
  device: string | null;
}

/** Sortie audio du PC : `id` est la valeur de `audio-device` de mpv. */
export interface AudioDevice {
  id: string;
  name: string;
}

/** Blocage de la veille : `available` = ce système sait le faire (Windows, ou Linux avec systemd-inhibit). */
export interface SleepStatus {
  available: boolean;
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
  canPrevious: boolean;
  /** Absent quand le serveur est arrêté ou la série inconnue. */
  order?: PlayOrder;
}
