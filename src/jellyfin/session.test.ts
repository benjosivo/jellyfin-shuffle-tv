import { describe, expect, it } from "vitest";
import { findPlayerSession, judgeSession } from "./session.js";
import type { JfSession } from "./types.js";

const base = { ownDeviceId: "cachyos-office-auto", userName: "Salon", pattern: /mpv/i };

const self: JfSession = {
  Id: "1",
  Client: "CachyOS Office Auto",
  DeviceId: "cachyos-office-auto",
  UserName: "Salon",
  SupportsRemoteControl: true,
};
const mpv: JfSession = {
  Id: "2",
  Client: "Jellyfin MPV Shim",
  DeviceName: "cachyos",
  DeviceId: "abc",
  UserName: "Salon",
  SupportsRemoteControl: true,
  LastActivityDate: "2026-10-20T10:00:00Z",
};
const web: JfSession = { Id: "3", Client: "Jellyfin Web", DeviceName: "Firefox", DeviceId: "web", UserName: "Salon", SupportsRemoteControl: true };

describe("findPlayerSession", () => {
  it("exclut la session du token de l'application (bug de l'ancien script)", () => {
    expect(findPlayerSession([self, web, mpv], base)?.Id).toBe("2");
    expect(judgeSession(self, base).matches).toBe(false);
  });

  it("exige le bon utilisateur et le contrôle à distance", () => {
    expect(findPlayerSession([{ ...mpv, UserName: "Autre" }], base)).toBeUndefined();
    expect(findPlayerSession([{ ...mpv, SupportsRemoteControl: false }], base)).toBeUndefined();
  });

  it("prend la session la plus récente s'il y en a plusieurs", () => {
    const older = { ...mpv, Id: "old", LastActivityDate: "2026-10-01T10:00:00Z" };
    expect(findPlayerSession([older, mpv], base)?.Id).toBe("2");
  });

  it("PLAYER_DEVICE_ID prime sur le motif et l'utilisateur", () => {
    const cfg = { ...base, deviceId: "web" };
    expect(findPlayerSession([mpv, web], cfg)?.Id).toBe("3");
  });
});
