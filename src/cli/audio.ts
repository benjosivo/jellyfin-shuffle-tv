// Utilisé par deploy/*/install et deploy/*/uninstall pour le compresseur audio de MPV Shim.
//
//   node dist/server/cli/audio.js enable-default [--dir <dossier MPV Shim>]
//   node dist/server/cli/audio.js remove         [--dir <dossier MPV Shim>]
//
// Sans --dir, le dossier est cherché comme le fait l'application. Sort toujours avec le code 0.

import path from "node:path";
import { enableCompressorByDefault, findMpvShimConfigDir, removeCompressorBlock } from "../audio.js";

const [command] = process.argv.slice(2);
const dirFlag = process.argv.indexOf("--dir");
const dir = (dirFlag >= 0 ? process.argv[dirFlag + 1] : undefined) ?? (await findMpvShimConfigDir());

try {
  if (!dir) {
    console.log("! Dossier de configuration de MPV Shim introuvable : compresseur non touché.");
  } else if (command === "enable-default") {
    const result = await enableCompressorByDefault(dir);
    if (result === "enabled") console.log(`✓ Compresseur audio activé (${path.join(dir, "mpv.conf")}). Pris en compte au prochain démarrage de MPV Shim.`);
    else if (result === "kept") console.log("✓ Compresseur audio : réglage existant conservé.");
    else console.log("✓ mpv.conf contient déjà un filtre audio personnel : compresseur non ajouté (réglable dans l'interface).");
  } else if (command === "remove") {
    if (await removeCompressorBlock(dir)) console.log(`✓ Compresseur audio retiré de ${path.join(dir, "mpv.conf")}.`);
  } else {
    console.log("Usage : audio.js enable-default|remove [--dir <dossier>]");
  }
} catch (err) {
  console.log(`! Compresseur audio non modifié : ${(err as Error).message}`);
}
