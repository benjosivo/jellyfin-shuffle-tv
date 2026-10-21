// Utilisé par deploy/*/uninstall : révoque les jetons Jellyfin avant d'effacer les fichiers.
//
//   node dist/server/cli/uninstall.js [--config-dir <dossier>] [--mpv-shim-config <dossier>]…
//
// Ne modifie aucun fichier ; sort toujours avec le code 0 (la désinstallation continue).

import { makePaths } from "../config.js";
import { revokeAppToken, revokeMpvShimTokens, type RevokeResult } from "../revoke.js";

/** Toutes les valeurs d'une option répétable. */
function options(name: string): string[] {
  return process.argv.flatMap((arg, i) => (arg === name && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
}

const results: RevokeResult[] = [...(await revokeAppToken(makePaths(options("--config-dir")[0])))];
for (const dir of options("--mpv-shim-config")) results.push(...(await revokeMpvShimTokens(dir)));

if (results.length === 0) console.log("Aucun jeton Jellyfin à révoquer.");
for (const r of results) {
  const what = `Jeton ${r.label} (${r.server})`;
  if (r.outcome === "revoked") console.log(`✓ ${what} révoqué.`);
  else if (r.outcome === "already") console.log(`✓ ${what} déjà invalide.`);
  else console.log(`! ${what} non révoqué : ${r.error}. Il sera quand même effacé de ce PC.`);
}
