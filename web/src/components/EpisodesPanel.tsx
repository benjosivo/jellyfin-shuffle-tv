import { useEffect, useMemo, useState } from "react";
import type { EpisodeListItem, PublicState } from "../../../src/shared/types";
import { api } from "../api";
import { episodeCode } from "../format";
import { useAction } from "../toast";
import { PlayIcon } from "./icons";

/** Tous les épisodes de la série courante, par saison : lire maintenant ou ensuite. */
export function EpisodesPanel({ state }: { state: PublicState }) {
  const run = useAction();
  const [open, setOpen] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeListItem[] | null>(null);
  const [filter, setFilter] = useState("");
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set());
  const canPlay = state.player === "ok";
  const seriesId = state.series?.id;
  const playingId = state.nowPlaying?.id;
  const queueKey = state.queue.map((e) => e.id).join(",");

  // Rechargée à l'ouverture, au changement de série, d'épisode ou de file (repères à jour).
  useEffect(() => {
    if (!open || !seriesId) return;
    let cancelled = false;
    api
      .get<EpisodeListItem[]>("/episodes")
      .then((list) => !cancelled && setEpisodes(list))
      .catch(() => !cancelled && setEpisodes([]));
    return () => {
      cancelled = true;
    };
  }, [open, seriesId, playingId, queueKey, state.historyCount]);

  // À l'ouverture, la saison de l'épisode en cours est dépliée.
  useEffect(() => {
    const season = episodes?.find((e) => e.playing)?.season;
    if (season !== undefined) setOpenSeasons((prev) => (prev.size === 0 ? new Set([season]) : prev));
  }, [episodes]);

  const query = filter.trim().toLowerCase();
  const seasons = useMemo(() => {
    const groups = new Map<number, EpisodeListItem[]>();
    for (const e of episodes ?? []) {
      if (query && !`${episodeCode(e)} ${e.name}`.toLowerCase().includes(query)) continue;
      const season = e.season ?? 0;
      groups.set(season, [...(groups.get(season) ?? []), e]);
    }
    return [...groups.entries()];
  }, [episodes, query]);

  const toggleSeason = (season: number) =>
    setOpenSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(season)) next.delete(season);
      else next.add(season);
      return next;
    });

  if (!state.series) return null;

  return (
    <section className="card">
      <button className="card-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2>Tous les épisodes</h2>
        <span className="muted small-text">
          {state.series.episodeCount} · {open ? "masquer" : "choisir"}
        </span>
      </button>
      {open && (
        <>
          <label className="field">
            <span>Rechercher</span>
            <input type="search" placeholder="Titre ou S02E05" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          {episodes === null ? (
            <div className="spinner" />
          ) : seasons.length === 0 ? (
            <p className="muted empty">Aucun épisode.</p>
          ) : (
            seasons.map(([season, list]) => {
              const expanded = Boolean(query) || openSeasons.has(season);
              const seen = list.filter((e) => e.seen).length;
              return (
                <div key={season} className="season">
                  <button className="season-head" onClick={() => toggleSeason(season)} aria-expanded={expanded}>
                    <span>{season === 0 ? "Épisodes spéciaux" : `Saison ${season}`}</span>
                    <span className="muted small-text">
                      {list.length} épisode{list.length > 1 ? "s" : ""}{seen ? ` · ${seen} vu${seen > 1 ? "s" : ""}` : ""} {expanded ? "▴" : "▾"}
                    </span>
                  </button>
                  {expanded && (
                    <ul className="episode-picker">
                      {list.map((e) => (
                        <li key={e.id} className={e.playing ? "playing" : ""}>
                          <div className="episode-text">
                            <span className="code">{episodeCode(e)}</span>
                            <span className="episode-name">{e.name}</span>
                            <span className="badges">
                              {e.playing && <span className="chip chip-on">en cours</span>}
                              {e.queued && <span className="chip">en file</span>}
                              {e.seen && !e.playing && <span className="chip">vu</span>}
                            </span>
                          </div>
                          <div className="row-actions">
                            <button className="small" disabled={e.playing} onClick={() => run(() => api.post("/queue/play-next", { episodeId: e.id }), `« ${e.name} » sera le prochain`)}>
                              Ensuite
                            </button>
                            <button className="icon-button" disabled={!canPlay} onClick={() => run(() => api.post("/queue/play-now", { episodeId: e.id }))} aria-label={`Lire ${e.name} maintenant`}>
                              <PlayIcon size={20} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </section>
  );
}
