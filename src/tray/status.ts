import type { PublicState, TraySummary } from "../shared/types.js";

// État résumé pour les icônes de la zone de notification (Windows et Linux).

const pad = (n?: number) => String(n ?? 0).padStart(2, "0");

export function traySummary(state: PublicState): TraySummary {
  const base = { canPause: false, canResume: false, canSkip: false, canPrevious: false };
  if (!state.configured) {
    return { ...base, level: "warning", title: "À configurer", detail: "Ouvrir l'interface pour lancer l'assistant." };
  }
  if (state.jellyfin === "unauthorized") {
    return { ...base, level: "warning", title: "Connexion Jellyfin refusée", detail: "Se reconnecter dans les réglages." };
  }
  if (state.jellyfin !== "ok") {
    return { ...base, level: "warning", title: "Jellyfin injoignable", detail: state.jellyfinError ?? "" };
  }
  if (state.player !== "ok") {
    return { ...base, level: "warning", title: "MPV Shim introuvable", detail: "Lancer MPV Shim et le connecter au serveur." };
  }

  const canSkip = Boolean(state.series);
  const canPrevious = state.canPrevious;
  const order = state.series ? state.order : undefined;
  const np = state.nowPlaying;
  if (np) {
    const code = np.season !== undefined || np.episode !== undefined ? `S${pad(np.season)}E${pad(np.episode)} ` : "";
    const detail = `${np.seriesName ? `${np.seriesName} · ` : ""}${code}${np.name}`;
    if (np.isPaused) {
      return { level: "paused", title: "En pause", detail, canPause: false, canResume: true, canSkip, canPrevious, order };
    }
    return {
      level: "playing",
      title: np.managed ? "Lecture en boucle" : "Lecture manuelle",
      detail,
      canPause: true,
      canResume: false,
      canSkip,
      canPrevious,
      order,
    };
  }
  return {
    ...base,
    canSkip,
    canPrevious,
    order,
    level: "idle",
    title: state.settings.autoMode ? "En attente du prochain épisode" : "Mode auto désactivé",
    detail: state.series ? `Série : ${state.series.name}` : "Aucune série sélectionnée",
  };
}

/** Résumé quand le serveur ne répond pas (calculé par l'icône). */
export const STOPPED: TraySummary = {
  level: "stopped",
  title: "Arrêté",
  detail: "Le serveur Jellyfin en boucle ne répond pas.",
  canPause: false,
  canResume: false,
  canSkip: false,
  canPrevious: false,
};
