import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigManager, makePaths } from "./config.js";
import { revokeAppToken, revokeMpvShimTokens } from "./revoke.js";

// Faux Jellyfin : un jeton valide tant qu'il n'a pas été révoqué.
const valid = new Set(["app-token", "mpv-token"]);
const calls: string[] = [];
let url = "";
const server = http.createServer((req, res) => {
  const token = /Token="([^"]+)"/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  calls.push(`${req.method} ${req.url} ${token}`);
  if (req.url === "/Sessions/Logout" && req.method === "POST") {
    res.statusCode = valid.delete(token) ? 204 : 401;
  } else {
    res.statusCode = 404;
  }
  res.end();
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("révocation à la désinstallation", () => {
  it("révoque le jeton de l'application, puis le signale déjà invalide", async () => {
    const paths = makePaths(await fs.mkdtemp(path.join(os.tmpdir(), "revoke-")));
    const config = await ConfigManager.load(paths);
    await config.update({ serverUrl: url });
    await config.saveCredentials("app-token", "u1");

    expect((await revokeAppToken(paths)).map((r) => r.outcome)).toEqual(["revoked"]);
    expect((await revokeAppToken(paths)).map((r) => r.outcome)).toEqual(["already"]);
  });

  it("ne fait rien sans dossier de configuration (et n'en crée pas)", async () => {
    const dir = path.join(os.tmpdir(), `absent-${Date.now()}`);
    expect(await revokeAppToken(makePaths(dir))).toEqual([]);
    await expect(fs.access(dir)).rejects.toThrow();
  });

  it("révoque les jetons de MPV Shim (cred.json)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mpv-shim-"));
    await fs.writeFile(
      path.join(dir, "cred.json"),
      JSON.stringify([{ address: `${url}/`, AccessToken: "mpv-token", UserId: "u1" }, { address: url }]),
    );
    const results = await revokeMpvShimTokens(dir);
    expect(results.map((r) => r.outcome)).toEqual(["revoked"]);
    expect(calls).toContain("POST /Sessions/Logout mpv-token");
  });

  it("continue si le serveur est injoignable", async () => {
    const paths = makePaths(await fs.mkdtemp(path.join(os.tmpdir(), "revoke-")));
    const config = await ConfigManager.load(paths);
    await config.update({ serverUrl: "http://127.0.0.1:1" });
    await config.saveCredentials("x", "u1");
    const [result] = await revokeAppToken(paths);
    expect(result?.outcome).toBe("failed");
  });
});
