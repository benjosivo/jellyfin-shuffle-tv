import type { JellyfinApi } from "../jellyfin/client.js";
import type { JfItem } from "../jellyfin/types.js";
import { TICKS_PER_SECOND } from "../jellyfin/types.js";
import type { EpisodeInfo, SeriesSummary, Track } from "../shared/types.js";

// Caches de la bibliothèque Jellyfin : séries, épisodes par série, pistes par épisode.

const EPISODES_TTL_MS = 60 * 60 * 1000;
const SERIES_TTL_MS = 10 * 60 * 1000;
const DETAILS_MAX = 50;

export interface SeriesEpisodes {
  seriesId: string;
  seriesName: string;
  episodes: EpisodeInfo[];
  byId: Map<string, EpisodeInfo>;
  fetchedAt: number;
}

export interface ItemTracks {
  audio: Track[];
  subtitles: Track[];
}

export function toEpisodeInfo(item: JfItem): EpisodeInfo {
  return {
    id: item.Id,
    name: item.Name ?? "(sans titre)",
    seriesId: item.SeriesId,
    seriesName: item.SeriesName,
    season: item.ParentIndexNumber,
    episode: item.IndexNumber,
    runTimeSec: item.RunTimeTicks ? item.RunTimeTicks / TICKS_PER_SECOND : undefined,
  };
}

export function toTracks(item: JfItem): ItemTracks {
  const streams = item.MediaStreams ?? [];
  const map = (type: string): Track[] =>
    streams
      .filter((stream) => stream.Type === type)
      .map((stream) => ({
        index: stream.Index,
        label:
          stream.DisplayTitle ||
          stream.Title ||
          [stream.Language, stream.Codec].filter(Boolean).join(" · ") ||
          `Piste ${stream.Index}`,
        language: stream.Language,
        isDefault: stream.IsDefault ?? false,
      }));
  return { audio: map("Audio"), subtitles: map("Subtitle") };
}

export class Library {
  private episodes = new Map<string, SeriesEpisodes>();
  private series?: { list: SeriesSummary[]; fetchedAt: number };
  private details = new Map<string, ItemTracks>();

  constructor(
    private readonly api: JellyfinApi,
    private readonly now: () => number = Date.now,
  ) {}

  clear(): void {
    this.episodes.clear();
    this.series = undefined;
    this.details.clear();
  }

  async listSeries(force = false): Promise<SeriesSummary[]> {
    if (!force && this.series && this.now() - this.series.fetchedAt < SERIES_TTL_MS) return this.series.list;
    const items = await this.api.listSeries();
    const list = items.map((item) => ({ id: item.Id, name: item.Name ?? item.Id, year: item.ProductionYear }));
    this.series = { list, fetchedAt: this.now() };
    return list;
  }

  async findSeriesByName(name: string): Promise<SeriesSummary | undefined> {
    const list = await this.listSeries();
    const wanted = name.trim().toLowerCase();
    return list.find((s) => s.name.toLowerCase() === wanted) ?? list.find((s) => s.name.toLowerCase().includes(wanted));
  }

  /** Épisodes d'une série (cache d'une heure), triés par saison puis numéro. */
  async getEpisodes(seriesId: string, force = false): Promise<SeriesEpisodes> {
    const cached = this.episodes.get(seriesId);
    if (!force && cached && this.now() - cached.fetchedAt < EPISODES_TTL_MS) return cached;
    try {
      const items = await this.api.listEpisodes(seriesId);
      const episodes = items
        .map(toEpisodeInfo)
        .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
      const seriesName =
        episodes.find((e) => e.seriesName)?.seriesName ??
        this.series?.list.find((s) => s.id === seriesId)?.name ??
        "";
      const entry: SeriesEpisodes = {
        seriesId,
        seriesName,
        episodes,
        byId: new Map(episodes.map((e) => [e.id, e])),
        fetchedAt: this.now(),
      };
      this.episodes.set(seriesId, entry);
      return entry;
    } catch (err) {
      // En cas d'erreur réseau, mieux vaut un cache périmé que rien.
      if (cached) return cached;
      throw err;
    }
  }

  /** Épisodes déjà en cache (sans requête), pour construire l'état rapidement. */
  cachedEpisodes(seriesId: string): SeriesEpisodes | undefined {
    return this.episodes.get(seriesId);
  }

  async getTracks(itemId: string): Promise<ItemTracks> {
    const cached = this.details.get(itemId);
    if (cached) return cached;
    const tracks = toTracks(await this.api.getItem(itemId));
    this.details.set(itemId, tracks);
    if (this.details.size > DETAILS_MAX) this.details.delete(this.details.keys().next().value!);
    return tracks;
  }

  cachedTracks(itemId: string): ItemTracks | undefined {
    return this.details.get(itemId);
  }
}
