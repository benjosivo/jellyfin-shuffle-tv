import { useState } from "react";
import type { EpisodeInfo, PublicState } from "../../../src/shared/types";
import { api } from "../api";
import { episodeCode, playedAt } from "../format";
import { useAction } from "../toast";

type Entry = EpisodeInfo & { at: number };

export function HistoryPanel({ state }: { state: PublicState }) {
  const run = useAction();
  const [all, setAll] = useState<Entry[] | null>(null);
  const entries = all ?? state.history;

  const showAll = () => run(async () => setAll(await api.get<Entry[]>("/history?limit=1000")));
  const reset = () => {
    if (!confirm(`Effacer l'historique de ${state.series?.name ?? "cette série"} ? Les épisodes déjà vus pourront revenir dans le tirage.`)) return;
    void run(async () => {
      await api.del("/history");
      setAll(null);
    }, "Historique réinitialisé");
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Historique</h2>
        <span className="muted small-text">
          {state.historyCount} / {state.historyLimit}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="muted empty">Aucun épisode vu pour l'instant.</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry, i) => (
            <li key={`${entry.id}-${i}`}>
              <span className="history-time">{playedAt(entry.at)}</span>
              <span className="code">{episodeCode(entry)}</span>
              <span className="episode-name">{entry.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="card-foot">
        {all ? (
          <button className="link" onClick={() => setAll(null)}>Réduire</button>
        ) : (
          state.historyCount > state.history.length && <button className="link" onClick={showAll}>Tout afficher</button>
        )}
        <button className="link danger" disabled={state.historyCount === 0} onClick={reset}>
          Réinitialiser
        </button>
      </div>
    </section>
  );
}
