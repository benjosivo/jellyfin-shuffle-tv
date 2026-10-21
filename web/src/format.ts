import type { EpisodeInfo } from "../../src/shared/types";

const pad = (n: number) => String(n).padStart(2, "0");

export function episodeCode(e: Pick<EpisodeInfo, "season" | "episode">): string {
  if (e.season === undefined && e.episode === undefined) return "";
  return `S${pad(e.season ?? 0)}E${pad(e.episode ?? 0)}`;
}

export function duration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function playedAt(at: number): string {
  if (!at) return "importé";
  const date = new Date(at);
  const now = new Date();
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `hier ${time}`;
  return `${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} ${time}`;
}
