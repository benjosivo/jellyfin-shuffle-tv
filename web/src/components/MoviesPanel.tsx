import { useEffect, useState } from "react";
import type { MovieSummary, PublicState } from "../../../src/shared/types";
import { api } from "../api";
import { duration } from "../format";
import { useAction, useToast } from "../toast";
import { CloseIcon, PlusIcon } from "./icons";
import { Thumb } from "./Thumb";

/** Nombre maximal de résultats affichés pour l'ajout (la bibliothèque peut compter des milliers de films). */
const MAX_RESULTS = 40;

/** Gestion de la liste « Films déjà vus » (affichée quand c'est la source courante). */
export function MoviesPanel({ state }: { state: PublicState }) {
  const run = useAction();
  const toast = useToast();
  const [movies, setMovies] = useState<MovieSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");

  // Recharge quand la liste change (ici ou depuis un autre appareil).
  useEffect(() => {
    if (state.jellyfin !== "ok") return;
    api
      .get<MovieSummary[]>("/movies")
      .then(setMovies)
      .catch(() => setMovies((current) => current ?? []));
  }, [state.jellyfin, state.movieCount]);

  const listed = (movies ?? []).filter((m) => m.inList);
  const wanted = filter.trim().toLowerCase();
  const candidates = (movies ?? []).filter((m) => !m.inList && m.name.toLowerCase().includes(wanted));

  const add = (id: string) => run(() => api.post("/movies/list", { ids: [id] }));
  const remove = (id: string) => run(() => api.del(`/movies/list/${encodeURIComponent(id)}`));
  const importPlayed = () =>
    run(async () => {
      const { added } = await api.post<{ added: number }>("/movies/import-played");
      toast(added > 0 ? `${added} film(s) vu(s) ajouté(s)` : "Aucun nouveau film vu dans Jellyfin", "info");
    });

  return (
    <section className="card">
      <div className="card-head">
        <h2>Films déjà vus</h2>
        <button className="small" onClick={() => setAdding((open) => !open)}>
          <PlusIcon size={16} /> {adding ? "Fermer" : "Ajouter"}
        </button>
      </div>

      {adding && (
        <>
          <button className="small" onClick={importPlayed}>
            Importer les films vus dans Jellyfin
          </button>
          <label className="field">
            <span>Rechercher un film</span>
            <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          {movies === null ? (
            <div className="spinner" />
          ) : candidates.length === 0 ? (
            <p className="muted empty">{wanted ? "Aucun film trouvé." : "Tous les films sont déjà dans la liste."}</p>
          ) : (
            <ol className="episode-list movie-results">
              {candidates.slice(0, MAX_RESULTS).map((movie) => (
                <li key={movie.id} className="episode-row">
                  <Thumb itemId={movie.id} height={120} className="thumb-small" />
                  <div className="episode-text">
                    <span className="code">{movie.year ?? ""}</span>
                    <span className="episode-name">{movie.name}</span>
                  </div>
                  <div className="row-actions">
                    <button className="icon-button" onClick={() => add(movie.id)} aria-label={`Ajouter ${movie.name}`}>
                      <PlusIcon />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {candidates.length > MAX_RESULTS && <p className="hint">{candidates.length - MAX_RESULTS} autres : affiner la recherche.</p>}
        </>
      )}

      {movies === null ? (
        <div className="spinner" />
      ) : listed.length === 0 ? (
        <p className="muted empty">Aucun film dans la liste.</p>
      ) : (
        <ol className="episode-list">
          {listed.map((movie) => (
            <li key={movie.id} className="episode-row">
              <Thumb itemId={movie.id} height={120} className="thumb-small" />
              <div className="episode-text">
                <span className="code">
                  {[movie.year, movie.runTimeSec ? duration(movie.runTimeSec) : null].filter(Boolean).join(" · ")}
                </span>
                <span className="episode-name">{movie.name}</span>
              </div>
              <div className="row-actions">
                <button className="icon-button" onClick={() => remove(movie.id)} aria-label={`Retirer ${movie.name}`}>
                  <CloseIcon />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
