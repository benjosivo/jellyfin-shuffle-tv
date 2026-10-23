import { useEffect, useState } from "react";
import type { AppVersion, AudioDevice, AudioStatus, LogLine, PublicState, SeriesSummary, Settings, SleepStatus, UpdateStatus } from "../../../src/shared/types";
import { api } from "../api";
import { useAction } from "../toast";
import { ArrowLeftIcon } from "./icons";
import { Listbox } from "./Listbox";
import { Group, Row, StepperRow, ToggleRow } from "./SettingsRows";

export function SettingsPage({ state, onOpenSetup, onBack }: { state: PublicState; onOpenSetup: () => void; onBack: () => void }) {
  const run = useAction();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [logs, setLogs] = useState<LogLine[] | null>(null);
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  const [devices, setDevices] = useState<AudioDevice[] | null>(null);
  const [sleep, setSleep] = useState<SleepStatus | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api.get<AppVersion>("/version").then(setAppVersion).catch(() => setAppVersion(null));
    api.get<AudioStatus>("/audio").then(setAudio).catch(() => setAudio(null));
    api.get<SleepStatus>("/sleep").then(setSleep).catch(() => setSleep({ available: false }));
  }, []);

  // Les sorties audio se lisent sur le PC (quelques centaines de ms sous Windows) : après l'état, hors du chemin critique.
  const audioAvailable = audio?.available === true;
  useEffect(() => {
    if (audioAvailable) api.get<AudioDevice[]>("/audio/devices").then(setDevices).catch(() => setDevices([]));
  }, [audioAvailable]);

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

  const patch = (body: Partial<Settings>) => run(() => api.patch("/settings", body));
  const saveNumber = (body: Partial<Settings>) => run(() => api.patch("/settings", body), "Réglage enregistré");

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
    if (saved) {
      setAudio((current) => (current ? { ...current, compressor: enabled } : current));
      setRestartPending(true);
    }
    return saved;
  };
  const changeDevice = async (value: string) => {
    const device = value === "" ? null : value;
    if (device === (audio?.device ?? null)) return;
    const saved = await run(() => api.put("/audio/device", { device }));
    if (saved) {
      setAudio((current) => (current ? { ...current, device } : current));
      setRestartPending(true);
    }
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

  const sourceUnit = state.series?.kind === "movies" ? "films" : "épisodes";
  const player = state.session ? `${state.session.client ?? "?"} · ${state.session.deviceName ?? "?"}` : "introuvable";

  return (
    <div className="settings">
      <header className="page-head">
        <button className="link back" onClick={onBack}>
          <ArrowLeftIcon size={18} /> Retour
        </button>
        <h1>Réglages</h1>
      </header>

      <Group title="Lecture">
        <div className="row row-stack">
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
            <p className="row-desc">
              {state.series.episodeCount} {sourceUnit}. L'historique et la file de chaque source sont conservés.
            </p>
          )}
        </div>
        <ToggleRow
          title="Mode auto"
          description="Enchaîne les épisodes et coupe avant la fin pour bloquer l'autoplay."
          checked={state.settings.autoMode}
          onChange={(enabled) => run(() => api.post("/auto", { enabled }))}
        />
        <ToggleRow
          title="Passer le générique des films"
          description="Film suivant dès le début du générique, détecté par Intro Skipper. Sans détection, c'est le délai ci-dessous qui joue."
          checked={state.settings.skipCredits}
          onChange={(skipCredits) => patch({ skipCredits })}
        />
        <StepperRow
          title="Changer avant la fin"
          description="Secondes restantes à partir desquelles on passe à la suite."
          value={state.settings.changeBeforeEndSec}
          min={0}
          max={600}
          step={5}
          unit="s"
          onCommit={(changeBeforeEndSec) => saveNumber({ changeBeforeEndSec })}
        />
        <StepperRow
          title="Épisodes à l'avance"
          description="Taille de la file « À suivre »."
          value={state.settings.queueSize}
          min={0}
          max={50}
          onCommit={(queueSize) => saveNumber({ queueSize })}
        />
      </Group>

      <Group title="Sur ce PC">
        <ToggleRow
          title="Empêcher la mise en veille"
          description={
            sleep?.available === false
              ? "Indisponible ici : sous Linux, il faut systemd (commande systemd-inhibit)."
              : "Garde le PC éveillé tant qu'un contenu est ouvert, même en pause. La veille revient 90 secondes après l'arrêt."
          }
          checked={state.settings.preventSleep}
          disabled={sleep?.available === false}
          onChange={(preventSleep) => patch({ preventSleep })}
        />
        {audio?.available && (
          <div className="row row-stack">
            <Listbox
              label="Sortie audio"
              value={audio.device ?? ""}
              options={[
                { value: "", label: "Par défaut du système" },
                ...(devices ?? []).map((d) => ({ value: d.id, label: d.name })),
                // Sortie choisie mais débranchée ou inconnue : elle reste visible plutôt que de se faire passer pour le défaut.
                ...(audio.device && devices && !devices.some((d) => d.id === audio.device)
                  ? [{ value: audio.device, label: "Sortie introuvable (débranchée ?)" }]
                  : []),
              ]}
              onChange={changeDevice}
            />
            <p className="row-desc">Où MPV Shim joue le son. S'applique après la relance de MPV Shim.</p>
          </div>
        )}
        {audio?.available && (
          <ToggleRow
            title="Compresseur audio"
            description="Atténue les pics de volume (explosions, musique) par rapport aux dialogues."
            checked={audio.compressor}
            onChange={changeCompressor}
          />
        )}
        {audio?.available && restartPending && (
          <Row title="Relancer MPV Shim" description="Le réglage s'applique après la relance, qui coupe la lecture en cours.">
            <button className="small primary" onClick={restartPlayer} disabled={restarting}>
              {restarting ? "Relance…" : "Relancer"}
            </button>
          </Row>
        )}
      </Group>

      <Group title="Serveur">
        <Row title="Serveur et compte" description={`Lecteur : ${player}`}>
          <button className="small" onClick={onOpenSetup} aria-label="Modifier le serveur et le compte">
            Modifier
          </button>
        </Row>
      </Group>

      <Group title="Application">
        <Row
          title="Version"
          description={appVersion ? `${appVersion.version}${appVersion.commit ? ` (${appVersion.commit})` : ""}` : "inconnue"}
        >
          <button className="small" onClick={checkUpdate} disabled={checking}>
            {checking ? "Recherche…" : "Chercher une mise à jour"}
          </button>
        </Row>
        {update && (
          <div className="row row-stack">
            <p className="row-note">{update.message}</p>
            {update.changes && update.changes.length > 0 && (
              <ul className="update-changes">
                {update.changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            )}
            {update.state === "available" && (
              <button className="small primary" onClick={installUpdate}>
                Installer
              </button>
            )}
          </div>
        )}
        <Row title="Journal" description="Les dernières lignes du journal de l'application.">
          <button className="small" onClick={toggleLogs}>
            {logs ? "Masquer" : "Afficher"}
          </button>
        </Row>
        {logs && (
          <div className="row row-stack">
            <ul className="logs">
              {logs.map((line, i) => (
                <li key={i} className={`log-${line.level}`}>
                  <time>{new Date(line.at).toLocaleTimeString("fr-FR")}</time> {line.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Group>
    </div>
  );
}
