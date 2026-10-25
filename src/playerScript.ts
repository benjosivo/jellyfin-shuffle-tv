import fs from "node:fs";
import path from "node:path";
import { findAppDir } from "./version.js";

// Script « nouvel écran de lecture » servi par /lecteur.ps1 et /lecteur.sh : l'installation de
// MPV Shim de deploy/ (la même que celle de install.*) suivie du script lecteur.* de deploy/.

export type PlayerScriptKind = "ps1" | "sh";

const PARTS: Record<PlayerScriptKind, string[]> = {
  ps1: ["windows/mpv-shim.ps1", "windows/lecteur.ps1"],
  sh: ["linux/mpv-shim.sh", "linux/lecteur.sh"],
};

export function playerScript(kind: PlayerScriptKind, appDir: string | null = findAppDir()): string {
  if (!appDir) throw new Error("Dossier de l'application introuvable.");
  const text = PARTS[kind]
    .map((part) => fs.readFileSync(path.join(appDir, "deploy", part), "utf8").replace(/^﻿/, ""))
    .join("\n")
    .replace(/\r\n/g, "\n"); // bash refuse les CRLF d'une copie de travail Windows
  // Bloc de script : $ErrorActionPreference et les fonctions ne restent pas dans la session de l'utilisateur.
  return kind === "ps1" ? `& {\n${text}\n}\n` : text;
}
