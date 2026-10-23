import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./fsutil.js";
import { APP_VERSION } from "./version.js";

// Configuration de l'application :
// - fichiers dans ~/.config/jellyfin-office (Linux) ou %APPDATA%\jellyfin-office (Windows) ;
// - config.json (serveur, utilisateur, identité du client) écrit par l'assistant de configuration ;
// - token / user_id dans des fichiers séparés (compatibles avec l'ancien auth.py) ;
// - les variables d'environnement priment sur config.json.

export interface Identity {
  client: string;
  device: string;
  deviceId: string;
  version: string;
}

export interface FileConfig {
  serverUrl?: string;
  userName?: string;
  identity?: Identity;
  defaultSeriesName?: string;
  /** Regex (insensible à la casse) testée sur Client et DeviceName pour reconnaître MPV Shim. */
  playerMatch?: string;
  /** DeviceId exact de MPV Shim, prioritaire sur `playerMatch`. */
  playerDeviceId?: string;
}

export interface Paths {
  dir: string;
  configFile: string;
  tokenFile: string;
  userIdFile: string;
  stateFile: string;
  legacyHistoryFile: string;
  logFile: string;
  spikeReport: string;
}

/** Identité utilisée par l'ancien script auth.py : un token déjà créé par lui y est lié. */
export const LEGACY_IDENTITY: Identity = {
  client: "CachyOS Office Auto",
  device: "CachyOS",
  deviceId: "cachyos-office-auto",
  version: APP_VERSION,
};

export const DEFAULTS = {
  defaultSeriesName: "The Office",
  playerMatch: "mpv",
};

export function defaultConfigDir(): string {
  if (process.env.JELLYFIN_OFFICE_DIR) return process.env.JELLYFIN_OFFICE_DIR;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "jellyfin-office");
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "jellyfin-office");
}

export function makePaths(dir = defaultConfigDir()): Paths {
  return {
    dir,
    configFile: path.join(dir, "config.json"),
    tokenFile: path.join(dir, "token"),
    userIdFile: path.join(dir, "user_id"),
    stateFile: path.join(dir, "state.json"),
    legacyHistoryFile: path.join(dir, "history"),
    logFile: path.join(dir, "office.log"),
    spikeReport: path.join(dir, "spike-report.json"),
  };
}

export const server = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8787),
  /** URL d'accès forcée (sinon déduite des adresses IP du PC). */
  publicUrl: process.env.PUBLIC_URL || undefined,
};

/** « 192.168.1.10 » → « http://192.168.1.10:8096 » ; une URL complète est gardée telle quelle. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  if (!hasScheme && !parsed.port) parsed.port = "8096";
  return parsed.toString().replace(/\/+$/, "");
}

export class ConfigManager {
  private file: FileConfig = {};
  private credentials?: { token: string; userId: string };

  private constructor(readonly paths: Paths) {}

  static async load(paths: Paths = makePaths()): Promise<ConfigManager> {
    const manager = new ConfigManager(paths);
    await fs.mkdir(paths.dir, { recursive: true });
    await manager.init();
    return manager;
  }

  private async init(): Promise<void> {
    const raw = await readText(this.paths.configFile);
    if (raw !== undefined) {
      try {
        this.file = JSON.parse(raw) as FileConfig;
      } catch {
        throw new Error(`config.json invalide : ${this.paths.configFile}`);
      }
    } else if (await readText(this.paths.tokenFile)) {
      // Machine configurée avec l'ancien auth.py : on garde son identité pour que le token reste
      // valide. Le serveur sera choisi dans l'assistant, qui conservera ce token (Setup.setServer).
      this.file = { identity: { ...LEGACY_IDENTITY } };
    }
    if (!this.file.identity) {
      this.file.identity = {
        client: "Jellyfin en boucle",
        device: os.hostname() || "PC",
        deviceId: `jellyfin-boucle-${randomUUID()}`,
        version: APP_VERSION,
      };
    }
    await this.save();
  }

  private async save(): Promise<void> {
    await writeFileAtomic(this.paths.configFile, JSON.stringify(this.file, null, 2) + "\n");
  }

  get serverUrl(): string | undefined {
    const value = process.env.JELLYFIN_URL || this.file.serverUrl;
    return value ? value.replace(/\/+$/, "") : undefined;
  }

  get userName(): string | undefined {
    return process.env.JELLYFIN_USER || this.file.userName;
  }

  /** Identité enregistrée, avec la version courante de l'application (celle de config.json peut dater d'une ancienne installation). */
  get identity(): Identity {
    return { ...this.file.identity!, version: APP_VERSION };
  }

  get defaultSeriesName(): string {
    return process.env.DEFAULT_SERIES || this.file.defaultSeriesName || DEFAULTS.defaultSeriesName;
  }

  get playerPattern(): RegExp {
    const source = process.env.PLAYER_MATCH || this.file.playerMatch || DEFAULTS.playerMatch;
    try {
      return new RegExp(source, "i");
    } catch {
      return new RegExp(DEFAULTS.playerMatch, "i");
    }
  }

  get playerDeviceId(): string | undefined {
    return process.env.PLAYER_DEVICE_ID || this.file.playerDeviceId || undefined;
  }

  /** Variables d'environnement qui figent une valeur (affiché dans l'assistant). */
  get envOverrides(): string[] {
    return ["JELLYFIN_URL", "JELLYFIN_USER", "PLAYER_MATCH", "PLAYER_DEVICE_ID"].filter((name) => process.env[name]);
  }

  async update(patch: Partial<FileConfig>): Promise<void> {
    this.file = { ...this.file, ...patch };
    for (const key of Object.keys(this.file) as (keyof FileConfig)[]) {
      if (this.file[key] === undefined) delete this.file[key];
    }
    await this.save();
  }

  async readCredentials(force = false): Promise<{ token: string; userId: string } | undefined> {
    if (force || !this.credentials) {
      const [token, userId] = await Promise.all([readText(this.paths.tokenFile), readText(this.paths.userIdFile)]);
      this.credentials = token?.trim() && userId?.trim() ? { token: token.trim(), userId: userId.trim() } : undefined;
    }
    return this.credentials;
  }

  async saveCredentials(token: string, userId: string): Promise<void> {
    await writeFileAtomic(this.paths.tokenFile, token, 0o600);
    await writeFileAtomic(this.paths.userIdFile, userId, 0o600);
    this.credentials = { token, userId };
  }

  async clearCredentials(): Promise<void> {
    await Promise.all([fs.rm(this.paths.tokenFile, { force: true }), fs.rm(this.paths.userIdFile, { force: true })]);
    this.credentials = undefined;
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}
