import type { MouseEvent } from "react";
import type { PublicState } from "../../../src/shared/types";
import { api } from "../api";
import { duration, episodeCode } from "../format";
import { useAction } from "../toast";
import { useLivePosition } from "../useServerState";
import { NextIcon, PauseIcon, PlayIcon, StopIcon } from "./icons";
import { Thumb } from "./Thumb";

export function NowPlayingPanel({ state, receivedAt }: { state: PublicState; receivedAt: number }) {
  const run = useAction();
  const position = useLivePosition(state, receivedAt);
  const np = state.nowPlaying;
  const ready = state.player === "ok";
  const runtime = np?.runTimeSec ?? 0;
  const progress = runtime > 0 ? Math.min(100, (position / runtime) * 100) : 0;
  const canSeek = Boolean(ready && np?.canSeek && runtime > 0);
  const credits = np?.creditsStartSec;
  const creditsPct = credits !== undefined && runtime > 0 ? Math.min(100, (credits / runtime) * 100) : null;

  const seek = (event: MouseEvent<HTMLDivElement>) => {
    if (!canSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    void run(() => api.post("/player/seek", { positionSec: Math.round(ratio * runtime) }));
  };

  return (
    <section className="card now-playing">
      <h2>En cours</h2>
      {np ? (
        <>
          <Thumb itemId={np.id} seriesId={np.seriesId} height={360} className="thumb-hero" />
          <div className="np-meta">
            <div className="np-series">{np.seriesName ?? state.series?.name ?? ""}</div>
            <div className="np-title">
              {episodeCode(np) && <span className="code">{episodeCode(np)}</span>} {np.name}
            </div>
            {!np.managed && <span className="chip chip-warn">lecture manuelle</span>}
          </div>
          <div
            className={`progress ${canSeek ? "seekable" : ""}`}
            onClick={seek}
            role="slider"
            aria-label="Position"
            aria-valuemin={0}
            aria-valuemax={Math.round(runtime)}
            aria-valuenow={Math.round(position)}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }} />
            {creditsPct !== null && <div className="progress-credits" style={{ left: `${creditsPct}%` }} />}
          </div>
          <div className="times">
            <span>{duration(position)}</span>
            <span>{runtime > 0 ? `-${duration(runtime - position)}` : "--:--"}</span>
          </div>
          {credits !== undefined && (
            <p className="hint">Générique à {duration(credits)} : passage automatique au film suivant.</p>
          )}
        </>
      ) : (
        <p className="muted empty">
          {state.player === "ok"
            ? state.settings.autoMode
              ? "Rien en lecture : la suite va démarrer."
              : "Rien en lecture."
            : "En attente de MPV Shim…"}
        </p>
      )}

      <div className="controls">
        <button className="round" disabled={!ready || !np} onClick={() => run(() => api.post("/player/stop"))} aria-label="Stop" title="Stop (désactive le mode auto)">
          <StopIcon />
        </button>
        <button
          className="round round-main"
          disabled={!ready || !np}
          onClick={() => run(() => api.post(np?.isPaused ? "/player/resume" : "/player/pause"))}
          aria-label={np?.isPaused ? "Reprendre" : "Pause"}
        >
          {np?.isPaused ? <PlayIcon size={34} /> : <PauseIcon size={34} />}
        </button>
        <button className="round" disabled={!ready || !state.series} onClick={() => run(() => api.post("/player/skip"))} aria-label="Passer" title="Suivant">
          <NextIcon />
        </button>
      </div>
    </section>
  );
}
