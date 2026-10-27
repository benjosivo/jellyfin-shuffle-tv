import { describe, expect, it } from "vitest";
import { playerScript } from "./playerScript.js";

describe("playerScript", () => {
  it("assemble l'installation de MPV Shim puis le script Windows, dans un bloc de script", () => {
    const script = playerScript("ps1");
    expect(script.startsWith("& {\n")).toBe(true);
    expect(script.trimEnd().endsWith("}")).toBe(true);
    expect(script.indexOf("function Install-MpvShim")).toBeGreaterThan(-1);
    expect(script.indexOf("function Install-MpvShim")).toBeLessThan(script.indexOf("Step 'Jellyfin MPV Shim'"));
    expect(script).not.toMatch(/\r|﻿/);
  });

  it("assemble l'installation de MPV Shim puis le script Linux, sans retour chariot", () => {
    const script = playerScript("sh");
    expect(script.indexOf("install_mpv_shim()")).toBeGreaterThan(-1);
    expect(script.indexOf("install_mpv_shim()")).toBeLessThan(script.indexOf('step "Jellyfin MPV Shim"'));
    expect(script).not.toContain("\r");
  });

  it("ajoute l'adresse de l'instance en tête, entre apostrophes", () => {
    expect(playerScript("sh", undefined, "http://192.168.1.20:8787/")).toMatch(/^SERVER_URL='http:\/\/192\.168\.1\.20:8787\/'\n/);
    expect(playerScript("ps1", undefined, "http://192.168.1.20:8787/")).toMatch(/^& \{\n\$ServerUrl = 'http:\/\/192\.168\.1\.20:8787\/'\n/);
    expect(playerScript("sh", undefined, "http://a'b/")).toContain("SERVER_URL='http://a'\\''b/'\n");
    expect(playerScript("ps1", undefined, "http://a'b/")).toContain("$ServerUrl = 'http://a''b/'\n");
  });

  it("n'ajoute rien sans adresse d'instance", () => {
    expect(playerScript("sh")).not.toContain("SERVER_URL=");
    expect(playerScript("ps1")).not.toContain("$ServerUrl =");
  });

  it("échoue clairement sans dossier d'application", () => {
    expect(() => playerScript("sh", null)).toThrow("Dossier de l'application introuvable.");
  });
});
