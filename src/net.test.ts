import type os from "node:os";
import { describe, expect, it } from "vitest";
import { accessUrls, isLoopback, lanAddresses } from "./net.js";

const v4 = (address: string, internal = false) =>
  ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "", cidr: null }) as os.NetworkInterfaceInfo;

describe("lanAddresses", () => {
  it("privilégie l'IP du réseau local et relègue les interfaces virtuelles", () => {
    const list = lanAddresses({
      lo: [v4("127.0.0.1", true)],
      docker0: [v4("172.17.0.1")],
      tailscale0: [v4("100.101.1.2")],
      enp3s0: [v4("192.168.1.50")],
    });
    expect(list[0]).toEqual({ address: "192.168.1.50", iface: "enp3s0" });
    expect(list.map((a) => a.address)).not.toContain("127.0.0.1");
  });

  it("PUBLIC_URL passe en premier", () => {
    expect(accessUrls(8787, "http://salon.lan:8787", { eth0: [v4("10.0.0.5")] })).toEqual([
      "http://salon.lan:8787/",
      "http://10.0.0.5:8787/",
    ]);
  });
});

describe("isLoopback", () => {
  it("reconnaît les adresses locales", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("192.168.1.20")).toBe(false);
  });
});
