import fs from "node:fs/promises";
import path from "node:path";
import { ConfigManager, type Paths } from "./config.js";
import { revokeToken } from "./jellyfin/client.js";

// Révocation des jetons Jellyfin à la désinstallation : celui de l'application et, si MPV Shim
// est retiré lui aussi, ceux enregistrés par MPV Shim. Toujours au mieux : un serveur
// injoignable n'empêche jamais la désinstallation.

export interface RevokeResult {
  label: string;
  server: string;
  outcome: "revoked" | "already" | "failed";
  error?: string;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

async function attempt(label: string, server: string, run: () => Promise<"revoked" | "already">): Promise<RevokeResult> {
  try {
    return { label, server, outcome: await run() };
  } catch (err) {
    return { label, server, outcome: "failed", error: (err as Error).message };
  }
}

/** Jeton de l'application (dossier de configuration `paths.dir`). */
export async function revokeAppToken(paths: Paths): Promise<RevokeResult[]> {
  if (!(await exists(paths.tokenFile))) return [];
  const config = await ConfigManager.load(paths);
  const credentials = await config.readCredentials();
  const server = config.serverUrl;
  if (!credentials || !server) return [];
  return [await attempt("application", server, () => revokeToken(server, config.identity, credentials.token))];
}

interface MpvShimServer {
  address?: string;
  AccessToken?: string;
}

/** Jetons de MPV Shim (cred.json dans son dossier de configuration). */
export async function revokeMpvShimTokens(configDir: string): Promise<RevokeResult[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(configDir, "cred.json"), "utf8");
  } catch {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (Array.isArray(data) ? data : ((data as { Servers?: unknown[] })?.Servers ?? [])) as MpvShimServer[];
  const results: RevokeResult[] = [];
  for (const entry of list) {
    const server = entry?.address?.replace(/\/+$/, "");
    const token = entry?.AccessToken;
    if (!server || !token) continue;
    results.push(await attempt("MPV Shim", server, () => revokeToken(server, undefined, token)));
  }
  return results;
}
