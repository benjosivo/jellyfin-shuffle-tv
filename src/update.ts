import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HttpError } from "./errors.js";
import type { UpdateStatus } from "./shared/types.js";
import { findAppDir } from "./version.js";

// Recherche de mise à jour depuis l'interface. Mêmes règles que deploy/*/update.* : on suit la
// branche distante suivie, et l'installation n'a lieu que si la mise à jour est un fast-forward.

const run = promisify(execFile);

/** Même nom que dans deploy/linux/common.sh (UNIT_NAME) et deploy/windows/common.ps1 ($UpdateTaskName). */
const LINUX_UPDATE_UNIT = "jellyfin-office-update.service";
const WINDOWS_UPDATE_TASK = "Jellyfin en boucle (mise à jour)";

const MAX_CHANGES = 8;

async function git(appDir: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", appDir, ...args], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  return stdout.trim();
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const appDir = findAppDir();
  if (!appDir) return { state: "unavailable", message: "Dossier de l'application introuvable." };

  try {
    await git(appDir, "rev-parse", "--git-dir");
  } catch {
    return { state: "unavailable", message: "L'application n'est pas installée depuis un dépôt git : mise à jour impossible." };
  }

  let upstream: string;
  try {
    upstream = await git(appDir, "rev-parse", "--abbrev-ref", "@{u}");
  } catch {
    return { state: "unavailable", message: "La branche courante ne suit aucune branche distante." };
  }

  try {
    await git(appDir, "fetch", "--quiet");
  } catch {
    throw new HttpError(502, "Impossible de joindre le dépôt git (réseau ?).");
  }

  const current = await git(appDir, "rev-parse", "--short", "HEAD");
  const latest = await git(appDir, "rev-parse", "--short", "@{u}");
  const behind = Number(await git(appDir, "rev-list", "--count", "HEAD..@{u}"));
  if (behind === 0) return { state: "up-to-date", current, latest, message: `À jour (${current}, ${upstream}).` };

  const changes = (await git(appDir, "log", "--format=%s", `-n${MAX_CHANGES}`, "HEAD..@{u}")).split("\n").filter(Boolean);
  const base = { current, latest, behind, changes };

  // Cas où le script de mise à jour refuserait d'installer : on le dit ici plutôt que d'échouer plus tard.
  if ((await git(appDir, "merge-base", "HEAD", "@{u}")) !== (await git(appDir, "rev-parse", "HEAD"))) {
    return { state: "blocked", ...base, message: `Des commits locaux ne sont pas publiés sur ${upstream} : mise à jour impossible.` };
  }
  if (await git(appDir, "status", "--porcelain", "--untracked-files=no")) {
    return { state: "blocked", ...base, message: "Des fichiers suivis ont été modifiés localement : mise à jour impossible." };
  }
  const plural = behind > 1 ? "s" : "";
  return { state: "available", ...base, message: `${behind} nouveauté${plural} disponible${plural} (${current} → ${latest}).` };
}

/**
 * Lance le script de mise à jour installé (celui de la mise à jour automatique), hors du processus de
 * l'application : il arrête puis relance l'application, qui ne peut donc pas l'exécuter elle-même.
 */
export async function installUpdate(): Promise<void> {
  try {
    if (process.platform === "win32") {
      await run("schtasks", ["/run", "/tn", WINDOWS_UPDATE_TASK], { windowsHide: true, timeout: 10_000 });
    } else if (process.platform === "linux") {
      await run("systemctl", ["--user", "start", "--no-block", LINUX_UPDATE_UNIT], { timeout: 10_000 });
    } else {
      throw new Error("plateforme non prise en charge");
    }
  } catch {
    throw new HttpError(409, "La mise à jour automatique n'est pas installée : lance deploy/…/update à la main.");
  }
}
