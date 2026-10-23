import { useEffect, useRef, useState } from "react";
import type { AccessInfo } from "../../src/shared/types";
import { api } from "./api";
import { EpisodesPanel } from "./components/EpisodesPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { MoviesPanel } from "./components/MoviesPanel";
import { NowPlayingPanel } from "./components/NowPlayingPanel";
import { QrOverlay } from "./components/QrOverlay";
import { QueuePanel } from "./components/QueuePanel";
import { SettingsPage } from "./components/SettingsPage";
import { SetupWizard } from "./components/SetupWizard";
import { SoundPanel } from "./components/SoundPanel";
import { SlidersIcon } from "./components/icons";
import { StatusBanner } from "./components/StatusBanner";
import { useServerState } from "./useServerState";

export function App() {
  const { state, receivedAt, connection } = useServerState();
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [showQr, setShowQr] = useState(() => new URLSearchParams(location.search).has("qr"));
  const [wizard, setWizard] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Les réglages ont leur entrée d'historique : « retour » du téléphone les ferme au lieu de quitter l'appli.
  const settingsPushed = useRef(false);

  useEffect(() => {
    const onPop = () => {
      settingsPushed.current = false;
      setSettingsOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openSettings = () => {
    history.pushState(null, "");
    settingsPushed.current = true;
    setSettingsOpen(true);
    window.scrollTo(0, 0);
  };
  const closeSettings = () => {
    if (settingsPushed.current) history.back();
    else setSettingsOpen(false);
  };

  useEffect(() => {
    api
      .get<AccessInfo>("/access")
      .then((info) => {
        setAccess(info);
        // Ouverte sur le PC lui-même : on propose tout de suite le QR code pour le téléphone.
        if (info.isLocal) setShowQr(true);
      })
      .catch(() => {});
  }, []);

  // Une fois lancé, l'assistant reste ouvert jusqu'au bout, même si la configuration devient valide en cours de route.
  const unconfigured = state !== null && !state.configured;
  useEffect(() => {
    if (unconfigured) setWizard(true);
  }, [unconfigured]);

  if (!state) {
    return (
      <div className="splash">
        <div className="spinner" />
        <p>{connection === "lost" ? "Serveur injoignable…" : "Connexion…"}</p>
      </div>
    );
  }

  const needsSetup = !state.configured;
  const qrButton = (
    <button className="icon-button" onClick={() => setShowQr(true)} aria-label="Ouvrir sur le téléphone" title="Ouvrir sur le téléphone">
      <PhoneIcon />
    </button>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>En boucle</span>
        </div>
        {state.configured && (
          <span className={`chip ${state.settings.autoMode ? "chip-on" : ""}`}>Auto {state.settings.autoMode ? "on" : "off"}</span>
        )}
        {qrButton}
        {state.configured && !wizard && (
          <button
            className={`icon-button ${settingsOpen ? "current" : ""}`}
            onClick={settingsOpen ? closeSettings : openSettings}
            aria-label="Réglages"
            aria-current={settingsOpen ? "page" : undefined}
            title="Réglages"
          >
            <SlidersIcon />
          </button>
        )}
      </header>

      {wizard || needsSetup ? (
        <SetupWizard state={state} onDone={() => {
          setWizard(false);
          setShowQr(true);
        }} onCancel={needsSetup ? undefined : () => setWizard(false)} />
      ) : settingsOpen ? (
        <SettingsPage state={state} onOpenSetup={() => setWizard(true)} onBack={closeSettings} />
      ) : (
        <main>
          <StatusBanner state={state} connection={connection} onOpenSetup={() => setWizard(true)} />
          <NowPlayingPanel state={state} receivedAt={receivedAt} />
          <SoundPanel state={state} />
          <QueuePanel state={state} />
          {state.series?.kind === "movies" && <MoviesPanel state={state} />}
          <EpisodesPanel state={state} />
          <HistoryPanel state={state} />
        </main>
      )}

      {showQr && <QrOverlay access={access} remoteClients={state.remoteClients} isLocal={access?.isLocal ?? false} onClose={() => setShowQr(false)} />}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}
