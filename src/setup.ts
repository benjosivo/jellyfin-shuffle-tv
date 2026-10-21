import { normalizeServerUrl, type ConfigManager } from "./config.js";
import { HttpError } from "./errors.js";
import { authenticateByName, fetchPublicInfo, JellyfinError } from "./jellyfin/client.js";
import { discoverServers } from "./jellyfin/discovery.js";
import { explainSessions, findPlayerSession, type PlayerMatchConfig } from "./jellyfin/session.js";
import type { JfSession } from "./jellyfin/types.js";
import { log } from "./log.js";
import type { PlayerLoop } from "./player/loop.js";
import type { DiscoveredServer, SetupStatus } from "./shared/types.js";
import type { Store } from "./store.js";

// Assistant de configuration : serveur → connexion → MPV Shim → série.
// Remplace auth.py : le mot de passe ne fait que transiter, seul le token est conservé.

export function playerMatch(config: ConfigManager): PlayerMatchConfig {
  return {
    userName: config.userName,
    ownDeviceId: config.identity.deviceId,
    pattern: config.playerPattern,
    deviceId: config.playerDeviceId,
  };
}

export async function isConfigured(config: ConfigManager): Promise<boolean> {
  return Boolean(config.serverUrl && (await config.readCredentials()));
}

export class Setup {
  constructor(
    private readonly config: ConfigManager,
    private readonly store: Store,
    private readonly loop: PlayerLoop,
  ) {}

  async status(): Promise<SetupStatus> {
    const config = this.config;
    const loggedIn = Boolean(await config.readCredentials());
    const status: SetupStatus = {
      configured: Boolean(config.serverUrl && loggedIn),
      serverUrl: config.serverUrl,
      serverReachable: false,
      userName: config.userName,
      loggedIn,
      deviceName: config.identity.device,
      envOverrides: config.envOverrides,
      playerDeviceId: config.playerDeviceId,
      playerFound: false,
      candidates: [],
      seriesSelected: Boolean(this.store.state.currentSeriesId),
      platform: process.platform,
    };

    if (config.serverUrl) {
      try {
        const info = await fetchPublicInfo(config.serverUrl, config.identity);
        status.serverReachable = true;
        status.serverName = info.ServerName;
        status.serverVersion = info.Version;
      } catch {
        // serveur injoignable : signalé par serverReachable = false
      }
    }

    if (status.configured && status.serverReachable) {
      let sessions: JfSession[] = [];
      try {
        sessions = await this.loop.rawSessions();
      } catch (err) {
        if (err instanceof JellyfinError && err.kind === "unauthorized") status.loggedIn = false;
      }
      const match = playerMatch(config);
      status.playerFound = Boolean(findPlayerSession(sessions, match));
      status.candidates = explainSessions(sessions, match)
        // Les sessions non pilotables (navigateurs, notre propre token…) n'aident pas à choisir.
        .filter((verdict) => verdict.session.SupportsRemoteControl && verdict.session.DeviceId !== match.ownDeviceId)
        .map(({ session, matches, reasons }) => ({
          deviceId: session.DeviceId,
          client: session.Client,
          deviceName: session.DeviceName,
          userName: session.UserName,
          matches,
          reasons,
        }));
    }
    return status;
  }

  discover(): Promise<DiscoveredServer[]> {
    return discoverServers(2000);
  }

  /** Vérifie et enregistre l'adresse du serveur. Changer de serveur invalide le token. */
  async setServer(input: string): Promise<{ url: string; name?: string; version?: string }> {
    if (this.config.envOverrides.includes("JELLYFIN_URL")) {
      throw new HttpError(409, "L'adresse du serveur est fixée par la variable JELLYFIN_URL.");
    }
    let url: string;
    try {
      url = normalizeServerUrl(input);
    } catch {
      throw new HttpError(400, "Adresse invalide.");
    }
    let info;
    try {
      info = await fetchPublicInfo(url, this.config.identity);
    } catch (err) {
      throw new HttpError(502, `Aucun serveur Jellyfin à cette adresse (${(err as Error).message}).`);
    }
    if (url !== this.config.serverUrl) {
      await this.config.clearCredentials();
      await this.config.update({ serverUrl: url });
      this.loop.resetConnection();
      log.info(`Serveur Jellyfin : ${url} (${info.ServerName ?? "?"}).`);
    }
    return { url, name: info.ServerName, version: info.Version };
  }

  async login(username: string, password: string): Promise<{ userName: string }> {
    const serverUrl = this.config.serverUrl;
    if (!serverUrl) throw new HttpError(409, "Choisir d'abord un serveur.");
    if (!username.trim()) throw new HttpError(400, "Nom d'utilisateur requis.");
    let result;
    try {
      result = await authenticateByName(serverUrl, this.config.identity, username.trim(), password);
    } catch (err) {
      if (err instanceof JellyfinError && err.kind === "unauthorized") throw new HttpError(401, err.message);
      throw new HttpError(502, (err as Error).message);
    }
    await this.config.saveCredentials(result.AccessToken, result.User.Id);
    await this.config.update({ userName: result.User.Name });
    this.loop.resetConnection();
    log.info(`Connecté à Jellyfin en tant que ${result.User.Name}.`);
    return { userName: result.User.Name };
  }

  async logout(): Promise<void> {
    await this.config.clearCredentials();
    this.loop.resetConnection();
    log.info("Déconnecté de Jellyfin.");
  }

  /** Choix manuel du lecteur (DeviceId) ; `null` revient à la détection automatique. */
  async choosePlayer(deviceId: string | null): Promise<void> {
    if (this.config.envOverrides.includes("PLAYER_DEVICE_ID")) {
      throw new HttpError(409, "Le lecteur est fixé par la variable PLAYER_DEVICE_ID.");
    }
    await this.config.update({ playerDeviceId: deviceId ?? undefined });
    this.loop.resetConnection();
    log.info(deviceId ? `Lecteur choisi manuellement : ${deviceId}.` : "Lecteur : détection automatique.");
  }
}
