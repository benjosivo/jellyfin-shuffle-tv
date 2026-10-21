import fs from "node:fs";
import type { LogLine } from "./shared/types.js";

// Journal : stdout (journalctl --user -u jellyfin-office), office.log (comme le script fish)
// et un tampon des dernières lignes affiché dans l'interface.

const MAX_LINES = 200;
const lines: LogLine[] = [];
let logFile: string | undefined;

export function setLogFile(file: string): void {
  logFile = file;
}

function write(level: LogLine["level"], message: string): void {
  const line: LogLine = { at: Date.now(), level, message };
  lines.push(line);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);

  const stream = level === "info" ? console.log : console.error;
  stream(`[${level}] ${message}`);

  if (logFile) {
    const time = new Date(line.at).toLocaleTimeString("fr-FR", { hour12: false });
    fs.appendFile(logFile, `[${time}] ${level === "info" ? "" : level.toUpperCase() + " : "}${message}\n`, () => {});
  }
}

export const log = {
  info: (message: string) => write("info", message),
  warn: (message: string) => write("warn", message),
  error: (message: string) => write("error", message),
  recent: (limit = 100): LogLine[] => lines.slice(-limit),
};
