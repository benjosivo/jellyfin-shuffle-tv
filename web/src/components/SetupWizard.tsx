import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { DiscoveredServer, PublicState, SeriesSummary, SetupStatus } from "../../../src/shared/types";
import { api } from "../api";
import { useAction } from "../toast";
import { CheckIcon, FilmIcon } from "./icons";

type Step = "server" | "login" | "player" | "series" | "done";
const STEPS: { id: Step; label: string }[] = [
  { id: "server", label: "Serveur" },
  { id: "login", label: "Connexion" },
  { id: "player", label: "MPV Shim" },
  { id: "series", label: "Série" },
];

function firstIncomplete(status: SetupStatus): Step {
  if (!status.serverUrl || !status.serverReachable) return "server";
  if (!status.loggedIn) return "login";
  if (!status.playerFound) return "player";
  if (!status.seriesSelected) return "series";
  return "done";
}

export function SetupWizard({ state, onDone, onCancel }: { state: PublicState; onDone: () => void; onCancel?: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<Step | null>(null);

  const refresh = useCallback(async () => {
    const next = await api.get<SetupStatus>("/setup");
    setStatus(next);
    return next;
  }, []);

  // Ouvert depuis les réglages : on commence au début ; sinon à la première étape à faire.
  const openedManually = useRef(Boolean(onCancel));
  useEffect(() => {
    refresh()
      .then((s) => setStep(openedManually.current ? "server" : firstIncomplete(s)))
      .catch(() => setStep("server"));
  }, [refresh]);

  // Le lecteur et la série sont suivis en direct par l'état SSE.
  useEffect(() => {
    if (step === "player" || step === "series") void refresh().catch(() => {});
  }, [state.player, state.series?.id, step, refresh]);

  if (!status || !step) {
    return (
      <main className="wizard">
        <div className="spinner" />
      </main>
    );
  }

  const go = async (next: Step) => {
    await refresh().catch(() => {});
    setStep(next);
  };

  return (
    <main className="wizard">
      <section className="card">
        <div className="card-head">
          <h2>Configuration</h2>
          {onCancel && (
            <button className="link" onClick={onCancel}>
              Fermer
            </button>
          )}
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={s.id === step ? "current" : ""}>
              <button className="link" onClick={() => setStep(s.id)}>
                {i + 1}. {s.label}
              </button>
            </li>
          ))}
        </ol>

        {step === "server" && <ServerStep status={status} onNext={() => go("login")} />}
        {step === "login" && <LoginStep status={status} onNext={() => go("player")} />}
        {step === "player" && <PlayerStep status={status} refresh={refresh} onNext={() => go("series")} />}
        {step === "series" && <SeriesStep state={state} onNext={() => go("done")} />}
        {step === "done" && (
          <div className="step">
            <p className="big">
              C'est prêt <CheckIcon size={24} />
            </p>
            <p className="muted">
              {status.playerFound
                ? "La lecture en boucle va démarrer sur MPV Shim."
                : "La lecture démarrera dès que MPV Shim sera connecté."}
            </p>
            <button className="primary" onClick={onDone}>
              Piloter depuis le téléphone
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function ServerStep({ status, onNext }: { status: SetupStatus; onNext: () => void }) {
  const run = useAction();
  const [url, setUrl] = useState(status.serverUrl ?? "");
  const [servers, setServers] = useState<DiscoveredServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = status.envOverrides.includes("JELLYFIN_URL");

  const discover = useCallback(() => {
    setServers(null);
    api
      .get<DiscoveredServer[]>("/setup/discover")
      .then((list) => {
        setServers(list);
        if (list.length === 1 && !status.serverUrl) setUrl(list[0]!.address);
      })
      .catch(() => setServers([]));
  }, [status.serverUrl]);
  useEffect(discover, [discover]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    const ok = await run(() => api.post("/setup/server", { url }));
    setBusy(false);
    if (ok) onNext();
  };

  return (
    <form className="step" onSubmit={submit}>
      <p>Adresse du serveur Jellyfin de la maison.</p>
      <div className="discovered">
        {servers === null ? (
          <p className="muted small-text">Recherche sur le réseau…</p>
        ) : servers.length === 0 ? (
          <p className="muted small-text">
            Aucun serveur trouvé automatiquement.{" "}
            <button type="button" className="link" onClick={discover}>
              Relancer
            </button>
          </p>
        ) : (
          servers.map((s) => (
            <button type="button" key={s.id} className={`server ${url === s.address ? "selected" : ""}`} onClick={() => setUrl(s.address)} disabled={locked}>
              <strong>{s.name}</strong>
              <span className="muted">{s.address}</span>
            </button>
          ))
        )}
      </div>
      <label className="field">
        <span>Adresse</span>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="192.168.1.10 ou http://serveur:8096"
          value={url}
          disabled={locked}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {locked && <p className="hint">Fixée par la variable d'environnement JELLYFIN_URL.</p>}
      {status.serverReachable && status.serverName && (
        <p className="hint">
          Connecté à « {status.serverName} » (Jellyfin {status.serverVersion}).
        </p>
      )}
      <button className="primary" type="submit" disabled={busy || !url.trim()}>
        {busy ? "Vérification…" : "Continuer"}
      </button>
    </form>
  );
}

function LoginStep({ status, onNext }: { status: SetupStatus; onNext: () => void }) {
  const run = useAction();
  const [username, setUsername] = useState(status.userName ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const ok = await run(() => api.post("/setup/login", { username, password }));
    setBusy(false);
    setPassword("");
    if (ok) onNext();
  };

  return (
    <form className="step" onSubmit={submit}>
      {status.loggedIn && (
        <div className="banner banner-info">
          Connecté en tant que <strong>{status.userName}</strong>.{" "}
          <button type="button" className="link" onClick={onNext}>
            Continuer
          </button>
        </div>
      )}
      <p>
        Compte Jellyfin utilisé pour la lecture en boucle (le même que dans MPV Shim). Le mot de passe n'est pas enregistré : seul un
        jeton de connexion est conservé sur ce PC.
      </p>
      <label className="field">
        <span>Utilisateur</span>
        <input type="text" autoComplete="username" autoCapitalize="off" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className="field">
        <span>Mot de passe</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button className="primary" type="submit" disabled={busy || !username.trim()}>
        {busy ? "Connexion…" : status.loggedIn ? "Changer de compte" : "Se connecter"}
      </button>
    </form>
  );
}

function PlayerStep({ status, refresh, onNext }: { status: SetupStatus; refresh: () => Promise<SetupStatus>; onNext: () => void }) {
  const run = useAction();
  const windows = status.platform === "win32";

  // Tant que MPV Shim n'est pas trouvé, on revérifie régulièrement.
  useEffect(() => {
    if (status.playerFound) return;
    const timer = window.setInterval(() => void refresh().catch(() => {}), 3000);
    return () => window.clearInterval(timer);
  }, [status.playerFound, refresh]);

  const choose = (deviceId: string | null) => run(async () => {
    await api.post("/setup/player", { deviceId });
    await refresh();
  });

  return (
    <div className="step">
      {status.playerFound ? (
        <div className="banner banner-ok">
          <CheckIcon size={16} /> MPV Shim est connecté
        </div>
      ) : (
        <>
          <p>
            La vidéo est jouée par <strong>Jellyfin MPV Shim</strong> sur ce PC ({status.deviceName}). Il est installé par le script
            d'installation ; il reste à le connecter :
          </p>
          <ol className="instructions">
            <li>
              Lancer <strong>Jellyfin MPV Shim</strong> ({windows ? "menu Démarrer" : "menu des applications"}). Son icône apparaît
              près de l'horloge.
            </li>
            <li>
              Dans la fenêtre qui s'ouvre (sinon : clic droit sur l'icône → <em>Configure Servers</em>), ajouter le serveur{" "}
              <code>{status.serverUrl}</code> avec l'utilisateur <code>{status.userName}</code>.
            </li>
            <li>Cette page le détecte automatiquement.</li>
          </ol>
          <p className="muted small-text">
            <span className="spinner spinner-inline" /> En attente de MPV Shim…
          </p>
        </>
      )}

      {status.candidates.length > 0 && (
        <>
          <h3>Lecteurs vus sur le serveur</h3>
          <ul className="candidates">
            {status.candidates.map((c) => (
              <li key={c.deviceId ?? c.client}>
                <div>
                  <strong>{c.client ?? "?"}</strong> · {c.deviceName ?? "?"} <span className="muted">({c.userName ?? "?"})</span>
                  <div className="muted small-text">{c.matches ? "Utilisé" : c.reasons.join(" ; ")}</div>
                </div>
                {!c.matches && c.deviceId && (
                  <button className="small" onClick={() => choose(c.deviceId!)}>
                    Utiliser
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {status.playerDeviceId && (
        <button className="link" onClick={() => choose(null)}>
          Revenir à la détection automatique
        </button>
      )}

      <button className="primary" onClick={onNext}>
        {status.playerFound ? "Continuer" : "Passer pour l'instant"}
      </button>
    </div>
  );
}

function SeriesStep({ state, onNext }: { state: PublicState; onNext: () => void }) {
  const run = useAction();
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.get<SeriesSummary[]>("/series").then(setSeries).catch(() => setSeries([]));
  }, []);

  const pick = async (seriesId: string) => {
    if (await run(() => api.put("/series", { seriesId, playNow: false }))) onNext();
  };
  const visible = (series ?? []).filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="step">
      <p>Série à lire en boucle (modifiable à tout moment dans les réglages).</p>
      {state.series && (
        <div className="banner banner-info">
          Série actuelle : <strong>{state.series.name}</strong>.{" "}
          <button className="link" onClick={onNext}>
            Garder
          </button>
        </div>
      )}
      <label className="field">
        <span>Rechercher</span>
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      {series === null ? (
        <div className="spinner" />
      ) : visible.length === 0 ? (
        <p className="muted">Aucune série.</p>
      ) : (
        <ul className="series-list">
          {visible.map((s) => (
            <li key={s.id}>
              <button className={s.id === state.series?.id ? "selected" : ""} onClick={() => pick(s.id)}>
                {s.kind === "movies" ? (
                  <span className="series-icon" aria-hidden="true">
                    <FilmIcon />
                  </span>
                ) : (
                  <img src={`/api/image/${s.id}?maxHeight=160`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                )}
                <span>
                  {s.name}
                  {s.year ? <small> {s.year}</small> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
