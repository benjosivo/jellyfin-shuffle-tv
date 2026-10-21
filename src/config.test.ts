import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigManager, LEGACY_IDENTITY, makePaths, normalizeServerUrl } from "./config.js";

async function tmp() {
  return makePaths(await fs.mkdtemp(path.join(os.tmpdir(), "config-test-")));
}

describe("ConfigManager", () => {
  it("PC neuf : identité unique générée, pas de serveur", async () => {
    const paths = await tmp();
    const config = await ConfigManager.load(paths);
    expect(config.serverUrl).toBeUndefined();
    expect(config.identity.deviceId).toMatch(/^jellyfin-boucle-[0-9a-f-]{36}$/);
    expect(await config.readCredentials()).toBeUndefined();
    // L'identité est conservée d'un lancement à l'autre.
    const again = await ConfigManager.load(paths);
    expect(again.identity).toEqual(config.identity);
  });

  it("machine configurée avec l'ancien auth.py : garde l'identité du token, le serveur reste à choisir", async () => {
    const paths = await tmp();
    await fs.writeFile(paths.tokenFile, "abc\n");
    await fs.writeFile(paths.userIdFile, "user1\n");
    const config = await ConfigManager.load(paths);
    expect(config.serverUrl).toBeUndefined();
    expect(config.userName).toBeUndefined();
    expect(config.identity).toEqual(LEGACY_IDENTITY);
    expect(await config.readCredentials()).toEqual({ token: "abc", userId: "user1" });
  });

  it("enregistre les identifiants en 600", async () => {
    const paths = await tmp();
    const config = await ConfigManager.load(paths);
    await config.saveCredentials("tok", "uid");
    if (process.platform !== "win32") {
      expect((await fs.stat(paths.tokenFile)).mode & 0o777).toBe(0o600);
    }
    await config.clearCredentials();
    expect(await config.readCredentials()).toBeUndefined();
  });
});

describe("normalizeServerUrl", () => {
  it("ajoute http:// et le port 8096 à une simple adresse", () => {
    expect(normalizeServerUrl("192.0.2.10")).toBe("http://192.0.2.10:8096");
    expect(normalizeServerUrl(" jellyfin.local:8920 ")).toBe("http://jellyfin.local:8920");
  });
  it("garde une URL complète telle quelle", () => {
    expect(normalizeServerUrl("https://media.example.org/jellyfin/")).toBe("https://media.example.org/jellyfin");
    expect(normalizeServerUrl("http://192.0.2.10:8096")).toBe("http://192.0.2.10:8096");
  });
});
