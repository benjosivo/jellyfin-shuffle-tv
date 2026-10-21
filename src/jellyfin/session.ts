import type { JfSession } from "./types.js";
import { supportedCommands } from "./types.js";

// Identification de la session MPV Shim parmi toutes les sessions Jellyfin.
//
// L'ancien script filtrait sur `Client == "CachyOS Office Auto"`, qui est le nom du client de
// auth.py (donc la session du token lui-même), pas celui de MPV Shim. Ici on exclut
// explicitement notre propre DeviceId et on cherche un client pilotable à distance qui
// ressemble à MPV Shim (Client « Jellyfin MPV Shim » par défaut).

export interface PlayerMatchConfig {
  userName?: string;
  /** DeviceId utilisé par cette application : sa session n'est jamais un lecteur. */
  ownDeviceId: string;
  pattern: RegExp;
  /** Si défini, seule la session de ce DeviceId est retenue. */
  deviceId?: string;
}

export interface SessionVerdict {
  session: JfSession;
  matches: boolean;
  reasons: string[];
}

export function judgeSession(session: JfSession, cfg: PlayerMatchConfig): SessionVerdict {
  const reasons: string[] = [];
  let matches = true;
  const fail = (reason: string) => {
    matches = false;
    reasons.push(reason);
  };

  if (session.DeviceId === cfg.ownDeviceId) fail("c'est la session de cette application (son propre token)");
  if (!session.SupportsRemoteControl) fail("ne supporte pas le contrôle à distance");

  if (cfg.deviceId) {
    if (session.DeviceId !== cfg.deviceId) fail(`DeviceId ≠ ${cfg.deviceId} (PLAYER_DEVICE_ID)`);
    else reasons.push("DeviceId choisi explicitement");
  } else {
    if (cfg.userName && (session.UserName ?? "").toLowerCase() !== cfg.userName.toLowerCase()) {
      fail(`utilisateur « ${session.UserName ?? "?"} » ≠ « ${cfg.userName} »`);
    }
    const label = `${session.Client ?? ""} ${session.DeviceName ?? ""}`;
    if (!cfg.pattern.test(label)) fail(`Client/DeviceName ne correspond pas à /${cfg.pattern.source}/i`);
  }

  if (matches && reasons.length === 0) reasons.push("client pilotable correspondant au motif");
  return { session, matches, reasons };
}

export function explainSessions(sessions: JfSession[], cfg: PlayerMatchConfig): SessionVerdict[] {
  return sessions.map((session) => judgeSession(session, cfg));
}

/** Session MPV Shim retenue : la plus récemment active parmi celles qui correspondent. */
export function findPlayerSession(sessions: JfSession[], cfg: PlayerMatchConfig): JfSession | undefined {
  return sessions
    .filter((session) => judgeSession(session, cfg).matches)
    .sort((a, b) => activity(b) - activity(a))[0];
}

/** Sessions qui pourraient être un lecteur (pour le choix manuel dans l'assistant). */
export function controllableSessions(sessions: JfSession[], ownDeviceId: string): JfSession[] {
  return sessions.filter((s) => s.SupportsRemoteControl && s.DeviceId !== ownDeviceId);
}

function activity(session: JfSession): number {
  const time = session.LastActivityDate ? Date.parse(session.LastActivityDate) : 0;
  return Number.isNaN(time) ? 0 : time;
}

export function describeSession(session: JfSession) {
  return {
    id: session.Id,
    client: session.Client,
    deviceName: session.DeviceName,
    deviceId: session.DeviceId,
    userName: session.UserName,
    supportsRemoteControl: session.SupportsRemoteControl ?? false,
    nowPlaying: session.NowPlayingItem?.Name,
    supportedCommands: supportedCommands(session),
  };
}
