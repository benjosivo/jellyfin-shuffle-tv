import { useEffect, useState } from "react";
import type { AppVersion, AudioStatus, LogLine, PublicState, SeriesSummary, UpdateStatus } from "../../../src/shared/types";
import { api } from "../api";
import { useAction } from "../toast";
import { Listbox } from "./Listbox";

export function SettingsPanel({ state, onOpenSetup }: { state: PublicState; onOpenSetup: () => void }) {
  const run = useAction();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [changeBefore, setChangeBefore] = useState(String(state.settings.changeBeforeEndSec));
  const [queueSize, setQueueSize] = useState(String(state.settings.queueSize));
  const [logs, setLogs] = useState<LogLine[] | null>(null);
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api.get<AppVersion>("/version").then(setAppVersion).catch(() => setAppVersion(null));
    api.get<AudioStatus>("/audio").then(setAudio).catch(() => setAudio(null));
  }, []);
  useEffect(() => setChangeBefore(String(state.settings.changeBeforeEndSec)), [state.settings.changeBeforeEndSec]);
  useEffect(() => setQueueSize(String(state.settings.queueSize)), [state.settings.queueSize]);

  const loadSeries = () => {
    if (series === null && state.jellyfin === "ok") {
      api.get<SeriesSummary[]>("/series").then(setSeries).catch(() => setSeries([]));
    }
  };
  useEffect(loadSeries, [state.jellyfin]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeSeries = (seriesId: string) => {
    if (!seriesId || seriesId === state.series?.id) return;
    const name = series?.find((s) => s.id === seriesId)?.name ?? "cette série";
    void run(() => api.put("/series", { seriesId, playNow: state.player === "ok" }), `Série : ${name}`);
  };

  const saveNumbers = () =>
    run(
      () => api.patch("/settings", { changeBeforeEndSec: Number(changeBefore), queueSize: Number(queueSize) }),
      "Réglages enregistrés",
    );
  const dirty = changeBefore !== String(state.settings.changeBeforeEndSec) || queueSize !== String(state.settings.queueSize);

  const checkUpdate = async () => {
    setChecking(true);
    setUpdate(null);
    await run(async () => setUpdate(await api.get<UpdateStatus>("/update")));
    setChecking(false);
  };
  const installUpdate = async () => {
    const started = await run(() => api.post("/update"), "Mise à jour lancée : l'application redémarre dans quelques minutes.");
    if (started) setUpdate(null);
  };

  const changeCompressor = async (enabled: boolean) => {
    const saved = await run(() => api.put("/audio/compressor", { enabled }));
    if (!saved) return;
    setAudio((current) => (current ? { ...current, compressor: enabled } : current));
    setRestartPending(true);
  };
  const restartPlayer = async () => {
    setRestarting(true);
    await run(async () => {
      const { restarted } = await api.post<{ restarted: boolean }>("/audio/restart-player");
      if (restarted) setRestartPending(false);
    }, "MPV Shim relancé");
    setRestarting(false);
  };

  const toggleLogs = () => {
    if (logs) return setLogs(null);
    void run(async () => setLogs((await api.get<LogLine[]>("/logs?limit=100")).reverse()));
  };

  return (
    <section className="card">
      <h2>Réglages</h2>

      <Listbox
        label="Source"
        value={state.series?.id ?? null}
        placeholder="Choisir une source"
        options={[
          ...(state.series && !series?.some((s) => s.id === state.series!.id) ? [{ value: state.series.id, label: state.series.name }] : []),
          ...(series ?? []).map((s) => ({ value: s.id, label: `${s.name}${s.year ? ` (${s.year})` : ""}` })),
        ]}
        onOpen={loadSeries}
        onChange={changeSeries}
      />
      {state.series && (
        <p className="hint">
          {state.series.episodeCount} {state.series.kind === "movies" ? "films" : "épisodes"} · l'historique et la file de chaque source sont conservés.
        </p>
      )}

      <label className="toggle">
        <input type="checkbox" checked={state.settings.autoMode} onChange={(e) => run(() => api.post("/auto", { enabled: e.target.checked }))} />
        <span className="toggle-track" aria-hidden="true" />
        <span>
          Mode auto
          <small>Enchaîne les épisodes et coupe avant la fin pour bloquer l'autoplay.</small>
        </span>
      </label>

      <label className="toggle">
        <input type="checkbox" checked={state.settings.skipCredits} onChange={(e) => run(() => api.patch("/settings", { skipCredits: e.target.checked }))} />
        <span className="toggle-track" aria-hidden="true" />
        <span>
          Passer le générique des films
          <small>Film suivant dès le début du générique (détecté par Intro Skipper). Sans détection : « Changer à » ci-dessous.</small>
        </span>
      </label>

      {audio?.available && (
        <>
          <label className="toggle">
            <input type="checkbox" checked={audio.compressor} onChange={(e) => changeCompressor(e.target.checked)} />
            <span className="toggle-track" aria-hidden="true" />
            <span>
              Compresseur audio
              <small>Atténue les pics de volume (explosions, musique) par rapport aux dialogues.</small>
            </span>
          </label>
          {restartPending && (
            <div className="update">
              <button className="small primary" onClick={restartPlayer} disabled={restarting}>
                {restarting ? "Relance…" : "Relancer MPV Shim"}
              </button>
              <p className="hint">Réglage enregistré. Il s'applique après la relance, qui coupe la lecture en cours.</p>
            </div>
          )}
        </>
      )}

      <div className="field-row">
        <label className="field">
          <span>Changer à (s avant la fin)</span>
          <input type="number" inputMode="numeric" min={0} max={600} value={changeBefore} onChange={(e) => setChangeBefore(e.target.value)} />
        </label>
        <label className="field">
          <span>Épisodes à l'avance</span>
          <input type="number" inputMode="numeric" min={0} max={50} value={queueSize} onChange={(e) => setQueueSize(e.target.value)} />
        </label>
      </div>
      {dirty && (
        <button className="primary" onClick={saveNumbers}>
          Enregistrer
        </button>
      )}

      <div className="account">
        <div>
          <div className="muted small-text">Lecteur</div>
          <div>{state.session ? `${state.session.client ?? "?"} · ${state.session.deviceName ?? "?"}` : "introuvable"}</div>
        </div>
        <button className="small" onClick={onOpenSetup}>
          Serveur &amp; compte
        </button>
      </div>

      <div className="card-foot">
        <button className="link" onClick={toggleLogs}>
          {logs ? "Masquer le journal" : "Journal"}
        </button>
      </div>
      {logs && (
        <ul className="logs">
          {logs.map((line, i) => (
            <li key={i} className={`log-${line.level}`}>
              <time>{new Date(line.at).toLocaleTimeString("fr-FR")}</time> {line.message}
            </li>
          ))}
        </ul>
      )}
      {appVersion && (
        <p className="hint version">
          Version {appVersion.version}
          {appVersion.commit ? ` (${appVersion.commit})` : ""}
        </p>
      )}
      <div className="update">
        <button className="small" onClick={checkUpdate} disabled={checking}>
          {checking ? "Recherche…" : "Chercher une mise à jour"}
        </button>
        {update?.state === "available" && (
          <button className="small primary" onClick={installUpdate}>
            Installer
          </button>
        )}
      </div>
      {update && (
        <div className="hint">
          <p>{update.message}</p>
          {update.changes && update.changes.length > 0 && (
            <ul className="update-changes">
              {update.changes.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
