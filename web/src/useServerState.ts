import { useEffect, useState } from "react";
import type { PublicState } from "../../src/shared/types";

export type Connection = "connecting" | "open" | "lost";

/** État poussé par le serveur en SSE, avec l'heure locale de réception. */
export function useServerState() {
  const [state, setState] = useState<PublicState | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [connection, setConnection] = useState<Connection>("connecting");

  useEffect(() => {
    const source = new EventSource("/api/events");
    let lostTimer: number | undefined;
    source.addEventListener("state", (event) => {
      setState(JSON.parse((event as MessageEvent<string>).data) as PublicState);
      setReceivedAt(Date.now());
      setConnection("open");
      window.clearTimeout(lostTimer);
    });
    source.onerror = () => {
      // EventSource se reconnecte tout seul ; on ne signale la perte qu'au bout de quelques secondes.
      window.clearTimeout(lostTimer);
      lostTimer = window.setTimeout(() => setConnection("lost"), 4000);
    };
    return () => {
      window.clearTimeout(lostTimer);
      source.close();
    };
  }, []);

  return { state, receivedAt, connection };
}

/** Position de lecture interpolée entre deux relevés du serveur. */
export function useLivePosition(state: PublicState | null, receivedAt: number): number {
  const [, setTick] = useState(0);
  const np = state?.nowPlaying;
  const running = Boolean(np && !np.isPaused);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!np) return 0;
  const elapsed = running ? Math.min((Date.now() - receivedAt) / 1000, 15) : 0;
  const position = np.positionSec + elapsed;
  return np.runTimeSec ? Math.min(position, np.runTimeSec) : position;
}
