import dgram from "node:dgram";
import os from "node:os";

// Découverte des serveurs Jellyfin du réseau local : Jellyfin répond en UDP (port 7359)
// au message « who is JellyfinServer? » par un JSON { Address, Id, Name }.

export interface DiscoveredServer {
  id: string;
  name: string;
  address: string;
}

const DISCOVERY_PORT = 7359;
const MESSAGE = Buffer.from("who is JellyfinServer?");

export function broadcastAddresses(): string[] {
  const result = new Set<string>(["255.255.255.255"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const ip = info.address.split(".").map(Number);
      const mask = info.netmask.split(".").map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      result.add(ip.map((octet, i) => (octet | (~mask[i]! & 255)) & 255).join("."));
    }
  }
  return [...result];
}

export function discoverServers(timeoutMs = 2000, port = DISCOVERY_PORT): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredServer>();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {
        // déjà fermé
      }
      resolve([...found.values()]);
    };

    socket.on("error", finish);
    socket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString("utf8")) as { Address?: string; Id?: string; Name?: string };
        if (data.Address) {
          const id = data.Id ?? data.Address;
          found.set(id, { id, name: data.Name ?? data.Address, address: data.Address.replace(/\/+$/, "") });
        }
      } catch {
        // réponse non JSON : ignorée
      }
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);
      for (const address of broadcastAddresses()) {
        socket.send(MESSAGE, port, address, () => {});
      }
      setTimeout(finish, timeoutMs);
    });
  });
}
