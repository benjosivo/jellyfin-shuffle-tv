import { useEffect, useState } from "react";
import type { AppVersion, LogLine, PublicState, SeriesSummary } from "../../../src/shared/types";
import { api } from "../api";
import { useAction } from "../toast";

export function SettingsPanel({ state, onOpenSetup }: { state: PublicState; onOpenSetup: () => void }) {
  const run = useAction();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [changeBefore, setChangeBefore] = useState(String(state.settings.changeBeforeEndSec));
  const [queueSize, setQueueSize] = useState(String(state.settings.queueSize));
  const [logs, setLogs] = useState<LogLine[] | null>(null);
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);

  useEffect(() => {
    api.get<AppVersion>("/version").then(setAppVersion).catch(() => setAppVersion(null));
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

  const toggleLogs = () => {
    if (logs) return setLogs(null);
    void run(async () => setLogs((await api.get<LogLine[]>("/logs?limit=100")).reverse()));
  };

  return (
    <section className="card">
      <h2>Réglages</h2>

      <label className="field">
        <span>Source</span>
        <select value={state.series?.id ?? ""} onFocus={loadSeries} onChange={(e) => changeSeries(e.target.value)}>
          {!state.series && <option value="">— choisir —</option>}
          {state.series && !series?.some((s) => s.id === state.series!.id) && (
            <option value={state.series.id}>{state.series.name}</option>
          )}
          {series?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.year ? ` (${s.year})` : ""}
            </option>
          ))}
        </select>
      </label>
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
    </section>
  );
}
