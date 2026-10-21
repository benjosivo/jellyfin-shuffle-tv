import os from "node:os";

// Adresses auxquelles le téléphone peut joindre l'interface (pour le QR code).

export interface LanAddress {
  address: string;
  iface: string;
}

const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|tailscale|tun|tap|wg|zt|lxc|lxd|cni|flannel|podman)|vEthernet|VirtualBox|VMware|Hyper-V|Loopback|WSL/i;

function privateRank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  const [a, b] = address.split(".").map(Number);
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return 2;
  if (address.startsWith("169.254.")) return 9; // auto-configurée : rarement joignable
  return 5;
}

export function lanAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): LanAddress[] {
  const result: (LanAddress & { rank: number })[] = [];
  for (const [iface, list] of Object.entries(interfaces)) {
    for (const info of list ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const rank = privateRank(info.address) + (VIRTUAL_IFACE.test(iface) ? 10 : 0);
      result.push({ address: info.address, iface, rank });
    }
  }
  return result.sort((a, b) => a.rank - b.rank).map(({ address, iface }) => ({ address, iface }));
}

export function accessUrls(port: number, publicUrl?: string, interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  const urls = lanAddresses(interfaces).map(({ address }) => `http://${address}:${port}/`);
  if (publicUrl) urls.unshift(publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`);
  return [...new Set(urls)];
}

export function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.");
}
