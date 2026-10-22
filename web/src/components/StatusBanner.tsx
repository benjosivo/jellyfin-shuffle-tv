import type { PublicState } from "../../../src/shared/types";
import type { Connection } from "../useServerState";

export function StatusBanner({ state, connection, onOpenSetup }: { state: PublicState; connection: Connection; onOpenSetup: () => void }) {
  if (connection === "lost") {
    return <div className="banner banner-error">Serveur de l'application injoignable. Reconnexion…</div>;
  }
  if (state.jellyfin === "unreachable") {
    return (
      <div className="banner banner-error">
        <strong>Jellyfin injoignable.</strong> {state.jellyfinError}
      </div>
    );
  }
  if (state.jellyfin === "unauthorized") {
    return (
      <div className="banner banner-error">
        <strong>Connexion Jellyfin refusée.</strong>{" "}
        <button className="link" onClick={onOpenSetup}>Se reconnecter</button>
      </div>
    );
  }
  if (state.player === "missing") {
    return (
      <div className="banner banner-warn">
        <strong>MPV Shim introuvable.</strong> Vérifier qu'il est lancé et connecté au même utilisateur.{" "}
        <button className="link" onClick={onOpenSetup}>Aide</button>
      </div>
    );
  }
  if (state.series?.kind === "movies" && state.series.episodeCount === 0) {
    return <div className="banner banner-warn">La liste de films est vide : ajouter des films ci-dessous.</div>;
  }
  if (!state.series && state.jellyfin === "ok") {
    return <div className="banner banner-warn">Aucune série sélectionnée : en choisir une dans les réglages.</div>;
  }
  if (state.nowPlaying && !state.nowPlaying.managed && state.settings.autoMode) {
    return (
      <div className="banner banner-info">
        Lecture lancée manuellement : la boucle reprendra à l'arrêt (ou avec « Passer »).
      </div>
    );
  }
  return null;
}
