import type { Request, Response } from "express";
import { isLoopback } from "../net.js";
import type { PlayerLoop } from "../player/loop.js";
import type { PublicState } from "../shared/types.js";

// Server-Sent Events : l'état complet est poussé à la connexion puis à chaque changement.

const PING_MS = 15000;

export function createEventsHandler(loop: PlayerLoop) {
  const clients = new Set<{ res: Response; remote: boolean }>();

  const updateRemoteCount = () => {
    loop.remoteClients = [...clients].filter((client) => client.remote).length;
  };

  loop.on("state", (state: PublicState) => {
    const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) client.res.write(payload);
  });

  return (req: Request, res: Response) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    const client = { res, remote: !isLoopback(req.socket.remoteAddress) };
    clients.add(client);
    res.write(`event: state\ndata: ${JSON.stringify(loop.snapshot())}\n\n`);
    if (client.remote) updateRemoteCount();

    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(client);
      if (client.remote) updateRemoteCount();
    });
  };
}
