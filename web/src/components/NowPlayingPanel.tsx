import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { PlayerTarget, PublicState } from "../../../src/shared/types";
import { api } from "../api";
import { duration, episodeCode } from "../format";
import { useAction } from "../toast";
import { useLivePosition } from "../useServerState";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, StopIcon } from "./icons";
import { Listbox } from "./Listbox";
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
  // Après un Stop (mode auto coupé) : l'épisode interrompu se reprend d'ici. En mode auto, la boucle le reprend seule.
  const interrupted = !np && !state.settings.autoMode ? state.resumePoint : null;
  const resumeInterrupted = () => run(() => api.post("/player/resume-interrupted"));

  // Les appuis rapides sur ±5 / ±15 s s'additionnent : un seul saut est envoyé après 400 ms.
  const [jump, setJump] = useState(0);
  const jumpTimer = useRef<number | undefined>(undefined);
  const jumpTotal = useRef(0);
  useEffect(() => () => window.clearTimeout(jumpTimer.current), []);
  const jumpBy = (delta: number) => {
    jumpTotal.current += delta;
    setJump(jumpTotal.current);
    window.clearTimeout(jumpTimer.current);
    jumpTimer.current = window.setTimeout(() => {
      const deltaSec = jumpTotal.current;
      jumpTotal.current = 0;
      setJump(0);
      if (deltaSec !== 0) void run(() => api.post("/player/seek-by", { deltaSec }));
    }, 400);
  };

  // Écrans vers lesquels transférer la lecture : chargés à l'ouverture de la liste (un écran peut apparaître à tout moment).
  const [players, setPlayers] = useState<PlayerTarget[] | null>(null);
  const loadPlayers = () => {
    api.get<PlayerTarget[]>("/players").then(setPlayers).catch(() => {});
  };
  const screen = (p: { deviceName?: string; client?: string }) => [p.deviceName, p.client].filter(Boolean).join(" · ") || "Écran";
  const here = state.session;
  const screens = players ?? (here?.deviceId ? [{ deviceId: here.deviceId, deviceName: here.deviceName, client: here.client }] : []);
  const transfer = (deviceId: string) => {
    if (deviceId === here?.deviceId) return;
    void run(async () => {
      await api.post("/player/transfer", { deviceId });
      loadPlayers();
    }, "Lecture transférée");
  };

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
            {jump !== 0 && <span className="jump-pending">{jump > 0 ? `+${jump}` : jump} s</span>}
            <span>{runtime > 0 ? `-${duration(runtime - position)}` : "--:--"}</span>
          </div>
          {credits !== undefined && (
            <p className="hint">Générique à {duration(credits)} : passage automatique au film suivant.</p>
          )}
          <div className="jumps" role="group" aria-label="Avancer ou reculer">
            {[-15, -5, 5, 15].map((delta) => (
              <button key={delta} className="jump" disabled={!canSeek} onClick={() => jumpBy(delta)} aria-label={`${delta > 0 ? "Avancer" : "Reculer"} de ${Math.abs(delta)} secondes`}>
                {delta > 0 ? `+${delta}` : `−${-delta}`}
                <small>s</small>
              </button>
            ))}
          </div>
        </>
      ) : interrupted ? (
        <>
          <Thumb itemId={interrupted.id} seriesId={interrupted.seriesId} height={360} className="thumb-hero" />
          <div className="np-meta">
            <div className="np-series">{interrupted.seriesName ?? state.series?.name ?? ""}</div>
            <div className="np-title">
              {episodeCode(interrupted) && <span className="code">{episodeCode(interrupted)}</span>} {interrupted.name}
            </div>
            <span className="chip">arrêté</span>
          </div>
          <button className="primary resume-button" disabled={!ready} onClick={resumeInterrupted}>
            <PlayIcon size={18} /> Reprendre à {duration(interrupted.positionSec)}
          </button>
          <p className="hint">Relance l'épisode là où il s'est arrêté (30 s avant) et réactive le mode auto.</p>
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
        <button className="round" disabled={!ready || !state.canPrevious} onClick={() => run(() => api.post("/player/previous"))} aria-label="Épisode précédent" title="Épisode précédent">
          <PrevIcon />
        </button>
        <button
          className="round round-main"
          disabled={!ready || (!np && !interrupted)}
          onClick={() => (np ? run(() => api.post(np.isPaused ? "/player/resume" : "/player/pause")) : resumeInterrupted())}
          aria-label={!np || np.isPaused ? "Reprendre" : "Pause"}
        >
          {!np || np.isPaused ? <PlayIcon size={34} /> : <PauseIcon size={34} />}
        </button>
        <button className="round" disabled={!ready || !state.series} onClick={() => run(() => api.post("/player/skip"))} aria-label="Épisode suivant" title="Épisode suivant">
          <NextIcon />
        </button>
      </div>
      <div className="secondary-controls">
        <button className="small" disabled={!ready || !np} onClick={() => run(() => api.post("/player/stop"))} title="Arrête la lecture et désactive le mode auto (reprise possible ensuite)">
          <StopIcon size={14} /> Stop
        </button>
      </div>
      <Listbox
        label="Lire sur"
        value={here?.deviceId ?? null}
        options={screens.map((p) => ({ value: p.deviceId, label: screen(p) }))}
        placeholder="Choisir un écran"
        disabled={state.jellyfin !== "ok"}
        onOpen={loadPlayers}
        onChange={transfer}
      />
      {players !== null && players.length < 2 && (
        <p className="hint">Aucun autre écran : ouvrir MPV Shim ou l'appli Jellyfin sur l'autre écran, connecté avec le même compte. Nouveau PC : Réglages → Ajouter un écran.</p>
      )}
    </section>
  );
}
