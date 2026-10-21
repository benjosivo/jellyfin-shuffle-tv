import { useEffect, useRef, useState } from "react";
import type { AccessInfo } from "../../../src/shared/types";
import { CloseIcon } from "./icons";

/** Grand QR code pour ouvrir l'interface sur le téléphone. Se ferme quand un téléphone se connecte. */
export function QrOverlay({
  access,
  remoteClients,
  isLocal,
  onClose,
}: {
  access: AccessInfo | null;
  remoteClients: number;
  isLocal: boolean;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const initialClients = useRef(remoteClients);
  const selected = url ?? access?.primary ?? null;

  useEffect(() => {
    // Seulement sur le PC : un nouveau client distant = le téléphone vient de scanner.
    if (isLocal && remoteClients > initialClients.current) {
      setConnected(true);
      const timer = window.setTimeout(onClose, 3000);
      return () => window.clearTimeout(timer);
    }
    initialClients.current = Math.min(initialClients.current, remoteClients);
  }, [remoteClients, isLocal, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Ouvrir sur le téléphone" onClick={onClose}>
      <div className="qr-card" onClick={(e) => e.stopPropagation()}>
        <button className="icon-button qr-close" onClick={onClose} aria-label="Fermer">
          <CloseIcon />
        </button>
        {connected ? (
          <div className="qr-connected">
            <div className="check">✓</div>
            <p>Téléphone connecté</p>
          </div>
        ) : (
          <>
            <h2>Piloter depuis le téléphone</h2>
            <p className="muted">Scanner avec l'appareil photo (même Wi-Fi que ce PC).</p>
            {selected ? (
              <>
                <img className="qr" src={`/api/qr.svg?url=${encodeURIComponent(selected)}`} alt={`QR code vers ${selected}`} />
                <a className="qr-url" href={selected}>
                  {selected.replace(/\/$/, "")}
                </a>
                {access && access.urls.length > 1 && (
                  <select className="qr-select" value={selected} onChange={(e) => setUrl(e.target.value)} aria-label="Adresse">
                    {access.urls.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                )}
              </>
            ) : (
              <p className="banner banner-warn">Aucune adresse réseau local détectée sur ce PC.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
