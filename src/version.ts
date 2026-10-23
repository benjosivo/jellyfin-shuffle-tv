import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppVersion } from "./shared/types.js";

// Numéro de version : package.json est la seule source. Le commit est lu dans le dépôt git du
// dossier de l'application, qui sert de référence aux mises à jour automatiques (deploy/*/update.*).

/** Remonte depuis ce module (src/ en dev, dist/server/ une fois compilé) jusqu'au package.json de l'application. */
function findAppDir(start = path.dirname(fileURLToPath(import.meta.url))): string | null {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const file = path.join(dir, "package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: string };
      if (pkg.name === "jellyfin-shuffle-tv") return dir;
    } catch {
      // pas de package.json ici : on continue vers le dossier parent
    }
    if (path.dirname(dir) === dir) return null;
  }
}

function readCommit(appDir: string): string | undefined {
  try {
    const out = execFileSync("git", ["-C", appDir, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return out.trim() || undefined;
  } catch {
    return undefined; // pas de git, ou dossier sans dépôt
  }
}

export function readAppVersion(): AppVersion {
  const appDir = findAppDir();
  if (!appDir) return { version: "inconnue" };
  let version = "inconnue";
  try {
    version = (JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")) as { version?: string }).version ?? version;
  } catch {
    // package.json illisible : version inconnue
  }
  return { version, commit: readCommit(appDir) };
}

/** « 0.1.0 (f96ebaf) », ou « 0.1.0 » sans dépôt git. */
export function formatVersion(info: AppVersion): string {
  return info.commit ? `${info.version} (${info.commit})` : info.version;
}

export const APP_INFO: AppVersion = readAppVersion();
export const APP_VERSION = APP_INFO.version;
