import type { PublicState } from "../../../src/shared/types";
import { api } from "../api";
import { episodeCode } from "../format";
import { useAction } from "../toast";
import { CloseIcon, PlayIcon, ShuffleIcon, UpIcon } from "./icons";
import { Thumb } from "./Thumb";

export function QueuePanel({ state }: { state: PublicState }) {
  const run = useAction();
  const queue = state.queue;
  const canPlay = state.player === "ok";

  const moveUp = (index: number) => {
    const order = queue.map((e) => e.id);
    [order[index - 1], order[index]] = [order[index]!, order[index - 1]!];
    void run(() => api.patch("/queue", { order }));
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>À suivre</h2>
        <button className="small" disabled={!state.series} onClick={() => run(() => api.post("/queue/reroll"), "Nouveau tirage effectué")}>
          <ShuffleIcon /> Nouveau tirage
        </button>
      </div>
      {queue.length === 0 ? (
        <p className="muted empty">{state.series ? "File vide." : "Aucune série sélectionnée."}</p>
      ) : (
        <ol className="episode-list">
          {queue.map((episode, index) => (
            <li key={episode.id} className="episode-row">
              <Thumb itemId={episode.id} seriesId={episode.seriesId} height={120} className="thumb-small" />
              <div className="episode-text">
                <span className="code">{episodeCode(episode)}</span>
                <span className="episode-name">{episode.name}</span>
              </div>
              <div className="row-actions">
                <button className="icon-button" disabled={index === 0} onClick={() => moveUp(index)} aria-label="Monter">
                  <UpIcon />
                </button>
                <button className="icon-button" disabled={!canPlay} onClick={() => run(() => api.post("/queue/play-now", { episodeId: episode.id }))} aria-label="Lire maintenant">
                  <PlayIcon size={20} />
                </button>
                <button className="icon-button" onClick={() => run(() => api.del(`/queue/${encodeURIComponent(episode.id)}`))} aria-label="Retirer">
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
