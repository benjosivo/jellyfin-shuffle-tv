import { useEffect, useRef, useState } from "react";
import type { PublicState, Track } from "../../../src/shared/types";
import { api } from "../api";
import { useAction } from "../toast";
import { VolumeIcon } from "./icons";

export function SoundPanel({ state }: { state: PublicState }) {
  const run = useAction();
  const ready = state.player === "ok" && Boolean(state.nowPlaying);
  const commands = state.session?.supportedCommands ?? [];
  // Liste vide = information absente : on laisse essayer.
  const supports = (name: string) => commands.length === 0 || commands.includes(name);

  const [volume, setVolume] = useState(state.volume ?? 100);
  const editing = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!editing.current && state.volume !== null) setVolume(state.volume);
  }, [state.volume]);

  const changeVolume = (value: number) => {
    setVolume(value);
    editing.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void run(() => api.post("/player/volume", { volume: value })).finally(() => {
        // On laisse au lecteur le temps de remonter la nouvelle valeur.
        window.setTimeout(() => (editing.current = false), 2500);
      });
    }, 250);
  };

  return (
    <section className="card">
      <h2>Son &amp; pistes</h2>
      <div className="volume-row">
        <button
          className={`icon-button ${state.muted ? "active" : ""}`}
          disabled={!ready || !supports(state.muted ? "Unmute" : "Mute")}
          onClick={() => run(() => api.post("/player/volume", { muted: !state.muted }))}
          aria-label={state.muted ? "Réactiver le son" : "Couper le son"}
        >
          <VolumeIcon muted={state.muted} />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          disabled={!ready || !supports("SetVolume")}
          onChange={(e) => changeVolume(Number(e.target.value))}
          aria-label="Volume"
        />
        <span className="volume-value">{state.volume === null ? "–" : volume}</span>
      </div>

      <TrackSelect
        label="Audio"
        tracks={state.audioTracks}
        current={state.audioIndex}
        disabled={!ready || !supports("SetAudioStreamIndex") || state.audioTracks.length < 2}
        onChange={(index) => run(() => api.post("/player/audio", { index }))}
      />
      <TrackSelect
        label="Sous-titres"
        tracks={state.subtitleTracks}
        current={state.subtitleIndex ?? -1}
        offOption
        disabled={!ready || !supports("SetSubtitleStreamIndex") || state.subtitleTracks.length === 0}
        onChange={(index) => run(() => api.post("/player/subtitle", { index }))}
      />
      {ready && commands.length > 0 && !supports("SetVolume") && (
        <p className="hint">Ce lecteur ne déclare pas le réglage du volume à distance.</p>
      )}
    </section>
  );
}

function TrackSelect({
  label,
  tracks,
  current,
  offOption,
  disabled,
  onChange,
}: {
  label: string;
  tracks: Track[];
  current: number | null;
  offOption?: boolean;
  disabled: boolean;
  onChange: (index: number) => void;
}) {
  const known = current === null || current === -1 || tracks.some((t) => t.index === current);
  return (
    <label className="field">
      <span>{label}</span>
      <select value={current ?? ""} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {current === null && <option value="">—</option>}
        {offOption && <option value={-1}>Désactivés</option>}
        {!known && <option value={current!}>Piste {current}</option>}
        {tracks.map((t) => (
          <option key={t.index} value={t.index}>
            {t.label}
            {t.isDefault ? " (défaut)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
