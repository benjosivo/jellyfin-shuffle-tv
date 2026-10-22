import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigManager, LEGACY_IDENTITY, makePaths } from "./config.js";
import type { PlayerLoop } from "./player/loop.js";
import { Setup } from "./setup.js";
import { Store } from "./store.js";

// Faux Jellyfin : seul le token « ancien-token » est valide pour l'utilisateur u1.
const calls: string[] = [];
let url = "";
const server = http.createServer((req, res) => {
  const token = /Token="([^"]+)"/.exec(req.headers.authorization ?? "")?.[1];
  calls.push(`${req.method} ${req.url} ${token ?? "-"}`);
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/System/Info/Public") return res.end(JSON.stringify({ ServerName: "Maison", Version: "10.10" }));
  if (req.url === "/Users/u1" && token === "ancien-token") return res.end(JSON.stringify({ Id: "u1", Name: "Salon" }));
  res.statusCode = req.url === "/Sessions/Logout" ? 204 : 401;
  res.end();
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

async function legacyMachine(token: string) {
  const paths = makePaths(await fs.mkdtemp(path.join(os.tmpdir(), "setup-")));
  await fs.writeFile(paths.tokenFile, token);
  await fs.writeFile(paths.userIdFile, "u1");
  const config = await ConfigManager.load(paths);
  const store = await Store.open(paths.stateFile);
  const loop = { resetConnection() {} } as unknown as PlayerLoop;
  return { config, setup: new Setup(config, store, loop) };
}

describe("migration d'une machine configurée avec l'ancien auth.py", () => {
  it("garde le token existant s'il est valide sur le serveur choisi, sans redemander le mot de passe", async () => {
    const { config, setup } = await legacyMachine("ancien-token");
    expect(config.identity).toEqual(LEGACY_IDENTITY);
    await setup.setServer(url);
    expect(config.serverUrl).toBe(url);
    expect(config.userName).toBe("Salon");
    expect(await config.readCredentials()).toEqual({ token: "ancien-token", userId: "u1" });
    expect(calls).not.toContain(`POST /Sessions/Logout ancien-token`);
  });

  it("efface un token refusé par le serveur choisi (il faudra se connecter)", async () => {
    const { config, setup } = await legacyMachine("token-invalide");
    await setup.setServer(url);
    expect(config.serverUrl).toBe(url);
    expect(await config.readCredentials()).toBeUndefined();
  });
});
