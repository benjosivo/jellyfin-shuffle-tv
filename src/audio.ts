import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { writeFileAtomic } from "./fsutil.js";

// Compresseur audio de MPV Shim : un filtre mpv (`af`) écrit dans mpv.conf, dans le dossier de
// configuration de MPV Shim. L'application ne gère que le bloc délimité par les deux marqueurs
// ci-dessous ; le reste du fichier n'est jamais touché. Désactivé, le bloc reste en commentaire :
// l'installation ne le réactive donc pas à la place de l'utilisateur.

const run = promisify(execFile);

/**
 * Écrase les pics (explosions, musique) sans toucher aux dialogues : seuil à -26 dB, rapport 6:1,
 * gain de rattrapage de +9,5 dB, puis un limiteur à 0,9 contre tout écrêtage.
 * Mesuré avec ffmpeg sur un signal dialogue faible puis explosion : écart de 48 dB ramené à 27 dB.
 */
export const COMPRESSOR_FILTER =
  "lavfi=[acompressor=threshold=0.05:ratio=6:attack=10:release=200:makeup=3,alimiter=limit=0.9:level=disabled]";

const BEGIN = "# >>> jellyfin-en-boucle : compresseur audio (géré par l'application)";
const END = "# <<< jellyfin-en-boucle";
const BLOCK = /^# >>> jellyfin-en-boucle[^\r\n]*\r?\n[\s\S]*?^# <<< jellyfin-en-boucle[^\r\n]*(?:\r?\n|$)/m;
const FILTER_LINE = /^\s*af(?:-\w+)?\s*=/m;

export type CompressorState = "on" | "off" | "absent";

export function compressorState(conf: string): CompressorState {
  const block = BLOCK.exec(conf)?.[0];
  if (block === undefined) return "absent";
  return /^af-append=/m.test(block) ? "on" : "off";
}

/** Une ligne `af…=` écrite à la main, hors de notre bloc. */
export function hasOwnAudioFilter(conf: string): boolean {
  return FILTER_LINE.test(conf.replace(BLOCK, ""));
}

export function removeCompressor(conf: string): string {
  return conf.replace(BLOCK, "");
}

export function applyCompressor(conf: string, enabled: boolean): string {
  const eol = conf.includes("\r\n") ? "\r\n" : "\n";
  const rest = removeCompressor(conf);
  const separator = rest === "" || rest.endsWith("\n") ? "" : eol;
  const line = `${enabled ? "" : "# "}af-append=${COMPRESSOR_FILTER}`;
  return `${rest}${separator}${[BEGIN, line, END].join(eol)}${eol}`;
}

// --- Fichier mpv.conf ----------------------------------------------------------------------

/** Dossiers où MPV Shim lit sa configuration, du plus probable au moins probable. */
export function mpvShimConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = os.homedir(),
): string[] {
  if (env.MPV_SHIM_CONFIG_DIR) return [env.MPV_SHIM_CONFIG_DIR];
  if (platform === "win32") return [path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "jellyfin-mpv-shim")];
  const config = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [
    path.join(config, "jellyfin-mpv-shim"),
    path.join(home, ".var", "app", "com.github.iwalton3.jellyfin-mpv-shim", "config", "jellyfin-mpv-shim"),
  ];
}

export async function findMpvShimConfigDir(candidates = mpvShimConfigCandidates()): Promise<string | undefined> {
  for (const dir of candidates) {
    if (await fs.stat(dir).then((s) => s.isDirectory(), () => false)) return dir;
  }
  return undefined;
}

async function readConf(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, "mpv.conf"), "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "";
    throw err;
  });
}

export async function readCompressor(dir: string): Promise<boolean> {
  return compressorState(await readConf(dir)) === "on";
}

export async function writeCompressor(dir: string, enabled: boolean): Promise<void> {
  await writeFileAtomic(path.join(dir, "mpv.conf"), applyCompressor(await readConf(dir), enabled));
}

/**
 * Activation à l'installation : seulement si rien n'a été décidé (ni bloc, ni filtre audio personnel).
 * Un compresseur désactivé depuis l'interface reste désactivé.
 */
export async function enableCompressorByDefault(dir: string): Promise<"enabled" | "kept" | "own-filter"> {
  const conf = await readConf(dir);
  if (compressorState(conf) !== "absent") return "kept";
  if (hasOwnAudioFilter(conf)) return "own-filter";
  await writeFileAtomic(path.join(dir, "mpv.conf"), applyCompressor(conf, true));
  return "enabled";
}

export async function removeCompressorBlock(dir: string): Promise<boolean> {
  const conf = await readConf(dir);
  if (compressorState(conf) === "absent") return false;
  await writeFileAtomic(path.join(dir, "mpv.conf"), removeCompressor(conf));
  return true;
}

// --- Relance de MPV Shim ----------------------------------------------------------------------

const WINDOWS_RESTART = `
$shims = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Jellyfin MPV Shim*' })
if ($shims.Count -eq 0) { 'not-running'; exit }
$exe = $shims[0].Path
$shims | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-Process $exe
'restarted'
`;

const LINUX_SHIM_PATTERN = "jellyfin-mpv-shim|jellyfin_mpv_shim";

async function linuxShimPids(): Promise<number[]> {
  try {
    const { stdout } = await run("pgrep", ["-f", LINUX_SHIM_PATTERN], { encoding: "utf8" });
    return stdout.split("\n").map(Number).filter((pid) => pid > 0 && pid !== process.pid);
  } catch {
    return []; // pgrep sort en erreur quand rien ne correspond
  }
}

/**
 * Relance MPV Shim pour qu'il relise mpv.conf. Le lecteur s'arrête quelques secondes et la lecture
 * en cours est coupée. Renvoie false si MPV Shim ne tournait pas (il lira le fichier à son prochain départ).
 */
export async function restartMpvShim(): Promise<boolean> {
  if (process.platform === "win32") {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_RESTART], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    });
    return stdout.trim() === "restarted";
  }
  if (process.platform !== "linux") throw new Error("plateforme non prise en charge");

  const [pid] = await linuxShimPids();
  if (pid === undefined) return false;
  // Commande et environnement relevés avant l'arrêt : DISPLAY / WAYLAND_DISPLAY sont repris tels quels.
  const [cmdline, environ] = await Promise.all([
    fs.readFile(`/proc/${pid}/cmdline`, "utf8"),
    fs.readFile(`/proc/${pid}/environ`, "utf8"),
  ]);
  const [command, ...args] = cmdline.split("\0").filter(Boolean);
  if (!command) return false;
  const env = Object.fromEntries(
    environ
      .split("\0")
      .filter(Boolean)
      .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
  );

  await run("pkill", ["-f", LINUX_SHIM_PATTERN]).catch(() => undefined);
  for (let i = 0; i < 25 && (await linuxShimPids()).length > 0; i++) await new Promise((resolve) => setTimeout(resolve, 200));
  spawn(command, args, { detached: true, stdio: "ignore", env }).unref();
  return true;
}
