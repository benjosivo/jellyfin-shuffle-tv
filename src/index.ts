import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import QRCode from "qrcode";
import { createApi } from "./api/routes.js";
import { ConfigManager, makePaths, server as serverConfig } from "./config.js";
import { JellyfinClient } from "./jellyfin/client.js";
import { log, setLogFile } from "./log.js";
import { accessUrls } from "./net.js";
import { Library } from "./player/library.js";
import { PlayerLoop } from "./player/loop.js";
import { playerScript } from "./playerScript.js";
import { isConfigured, playerMatch, Setup } from "./setup.js";
import type { PublicState } from "./shared/types.js";
import { detectAcquire, SleepGuard } from "./sleep.js";
import { Store } from "./store.js";
import { APP_INFO, formatVersion } from "./version.js";

async function main(): Promise<void> {
  const paths = makePaths();
  const config = await ConfigManager.load(paths);
  setLogFile(paths.logFile);
  log.info(`===== DÉMARRAGE JELLYFIN EN BOUCLE ${formatVersion(APP_INFO)} =====`);
  log.info(`Configuration : ${paths.dir}`);

  const store = await Store.open(paths.stateFile, paths.legacyHistoryFile);
  if (store.state.pendingImport) log.info(`Ancien historique trouvé (${store.state.pendingImport.length} épisodes) : import au premier contact.`);

  const client = new JellyfinClient(config);
  const library = new Library(client);
  const loop = new PlayerLoop({
    api: client,
    store,
    library,
    match: () => playerMatch(config),
    isConfigured: () => isConfigured(config),
    defaultSeriesName: () => config.defaultSeriesName,
    selectPlayer: (deviceId) => setup.selectPlayer(deviceId),
  });
  const setup: Setup = new Setup(config, store, loop);

  const sleepGuard = new SleepGuard(await detectAcquire());
  loop.on("state", (state: PublicState) => {
    sleepGuard.want(state.settings.preventSleep && state.nowPlaying !== null);
  });

  const app = express();
  app.disable("x-powered-by");
  app.use("/api", createApi({ loop, library, client, config, setup, sleepGuard }));

  // Installation d'un nouvel écran de lecture : `irm <url>/lecteur.ps1 | iex` ou `curl -fsSL <url>/lecteur.sh | bash`.
  for (const kind of ["ps1", "sh"] as const) {
    app.get(`/lecteur.${kind}`, (req, res) => {
      try {
        // L'adresse par laquelle le nouvel écran a joint l'instance : il saura la rejoindre.
        const serverUrl = `${req.protocol}://${req.get("host") ?? `localhost:${serverConfig.port}`}/`;
        res.set("Content-Type", "text/plain; charset=utf-8").send(playerScript(kind, undefined, serverUrl));
      } catch (err) {
        log.error(`Script lecteur.${kind} indisponible : ${(err as Error).message}`);
        res.status(404).type("text/plain").send("Script introuvable.\n");
      }
    });
  }

  // Front (build Vite) servi en statique, avec repli sur index.html.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/server/index.js → dist/web ; en dev (tsx src/index.ts) → dist/web à la racine.
  const webDir = path.resolve(here, path.basename(here) === "server" ? "../web" : "../dist/web");
  if (fs.existsSync(path.join(webDir, "index.html"))) {
    app.use(express.static(webDir, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(webDir, "index.html"));
    });
  } else {
    log.warn("Interface web absente : lancer `npm run build`.");
  }

  const httpServer = app.listen(serverConfig.port, serverConfig.host, () => {
    void announce();
  });
  httpServer.on("error", (err) => {
    log.error(`Impossible d'écouter sur ${serverConfig.host}:${serverConfig.port} : ${err.message}`);
    process.exit(1);
  });

  if (!(await isConfigured(config))) {
    log.info("Pas encore configuré : ouvrir l'interface pour lancer l'assistant.");
  }
  loop.start();

  const shutdown = async (signal: string) => {
    log.info(`Arrêt (${signal}).`);
    loop.stop();
    sleepGuard.stop();
    httpServer.close();
    await store.flush();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/** URL d'accès + QR code dans le terminal / journal. */
async function announce(): Promise<void> {
  const urls = accessUrls(serverConfig.port, serverConfig.publicUrl);
  log.info(`Interface : http://localhost:${serverConfig.port}/`);
  for (const url of urls) log.info(`Depuis le téléphone : ${url}`);
  if (urls[0]) {
    // Caractères pleins sans codes couleur ANSI (journald les stockerait en « blob data »),
    // inversés pour un terminal sombre : les blocs dessinés sont les modules clairs.
    const qr = await QRCode.toString(urls[0], { type: "utf8", margin: 2, color: { dark: "#ffffff", light: "#000000" } });
    console.log(`\nScanner pour ouvrir ${urls[0]} :\n${qr}`);
  } else {
    log.warn("Aucune adresse réseau local trouvée : le téléphone ne pourra pas joindre l'interface.");
  }
}

process.on("unhandledRejection", (reason) => {
  log.error(`Promesse rejetée non gérée : ${(reason as Error)?.stack ?? String(reason)}`);
});
process.on("uncaughtException", (err) => {
  // État incertain : on s'arrête, le service (systemd / run.ps1) relance.
  log.error(`Exception non gérée : ${err.stack ?? err.message}`);
  process.exit(1);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
