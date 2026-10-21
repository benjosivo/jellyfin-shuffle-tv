import express, { type NextFunction, type Request, type Response } from "express";
import QRCode from "qrcode";
import { server as serverConfig } from "../config.js";
import { HttpError } from "../errors.js";
import { JellyfinError, type JellyfinClient } from "../jellyfin/client.js";
import { describeSession, explainSessions } from "../jellyfin/session.js";
import { log } from "../log.js";
import { accessUrls, isLoopback } from "../net.js";
import type { Library } from "../player/library.js";
import type { PlayerLoop } from "../player/loop.js";
import { playerMatch, type Setup } from "../setup.js";
import type { ConfigManager } from "../config.js";
import type { AccessInfo, Settings } from "../shared/types.js";
import { traySummary } from "../tray/status.js";
import { createEventsHandler } from "./events.js";

export interface ApiDeps {
  loop: PlayerLoop;
  library: Library;
  client: JellyfinClient;
  config: ConfigManager;
  setup: Setup;
}

const ITEM_ID = /^[0-9a-f-]{32,36}$/i;

export function createApi({ loop, library, client, config, setup }: ApiDeps): express.Router {
  const api = express.Router();
  api.use(express.json({ limit: "64kb" }));

  // --- État -------------------------------------------------------------------

  api.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  api.get("/state", (_req, res) => {
    res.json(loop.snapshot());
  });

  api.get("/events", createEventsHandler(loop));

  api.get("/tray", (_req, res) => {
    res.json(traySummary(loop.snapshot()));
  });

  api.get("/logs", (req, res) => {
    res.json(log.recent(intQuery(req, "limit", 100, 1, 200)));
  });

  api.get("/debug/sessions", async (_req, res) => {
    const sessions = await loop.rawSessions();
    res.json(
      explainSessions(sessions, playerMatch(config)).map((verdict) => ({
        ...describeSession(verdict.session),
        matches: verdict.matches,
        reasons: verdict.reasons,
      })),
    );
  });

  // --- Lecteur ------------------------------------------------------------------

  api.post("/player/pause", async (_req, res) => {
    await loop.pause();
    res.status(204).end();
  });
  api.post("/player/resume", async (_req, res) => {
    await loop.resume();
    res.status(204).end();
  });
  api.post("/player/skip", async (_req, res) => {
    res.json({ episodeId: await loop.skip() });
  });
  api.post("/player/stop", async (_req, res) => {
    await loop.stopPlayback();
    res.status(204).end();
  });
  api.post("/player/seek-by", async (req, res) => {
    const delta = req.body?.deltaSec;
    if (typeof delta !== "number" || !Number.isFinite(delta) || delta < -600 || delta > 600 || delta === 0) {
      throw new HttpError(400, "deltaSec doit être un nombre non nul entre -600 et 600.");
    }
    await loop.seekBy(delta);
    res.status(204).end();
  });
  api.post("/player/previous", async (_req, res) => {
    res.json({ episodeId: await loop.previous() });
  });
  api.post("/player/seek", async (req, res) => {
    await loop.seek(numberField(req, "positionSec", 0));
    res.status(204).end();
  });
  api.post("/player/volume", async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.muted === "boolean") await loop.setMuted(body.muted);
    else await loop.setVolume(numberField(req, "volume", 0, 100));
    res.status(204).end();
  });
  api.post("/player/audio", async (req, res) => {
    await loop.setAudioTrack(integerField(req, "index", 0));
    res.status(204).end();
  });
  api.post("/player/subtitle", async (req, res) => {
    await loop.setSubtitleTrack(integerField(req, "index", -1));
    res.status(204).end();
  });

  api.post("/auto", async (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") throw new HttpError(400, "enabled (booléen) requis.");
    await loop.setAutoMode(enabled);
    res.status(204).end();
  });

  api.patch("/settings", async (req, res) => {
    const body = (req.body ?? {}) as Partial<Settings>;
    const patch: Partial<Settings> = {};
    for (const key of ["changeBeforeEndSec", "historyRatio", "queueSize", "pollIntervalMs"] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    res.json(await loop.updateSettings(patch));
  });

  // --- Séries -------------------------------------------------------------------

  api.get("/series", async (_req, res) => {
    res.json(await library.listSeries(true));
  });

  api.put("/series", async (req, res) => {
    const seriesId = stringField(req, "seriesId");
    const playNow = req.body?.playNow !== false;
    await loop.setSeries(seriesId, playNow);
    res.status(204).end();
  });

  // --- Épisodes, file et historique ----------------------------------------------

  api.get("/episodes", async (_req, res) => {
    res.json(await loop.episodes());
  });

  api.put("/order", async (req, res) => {
    const order = req.body?.order;
    if (order !== "shuffle" && order !== "sequential") throw new HttpError(400, "order : « shuffle » ou « sequential ».");
    await loop.setOrder(order);
    res.status(204).end();
  });

  api.get("/queue", (_req, res) => {
    res.json(loop.snapshot().queue);
  });
  api.post("/queue/reroll", async (_req, res) => {
    await loop.reroll();
    res.status(204).end();
  });
  api.post("/queue/play-next", async (req, res) => {
    await loop.playNext(stringField(req, "episodeId"));
    res.status(204).end();
  });
  api.post("/queue/play-now", async (req, res) => {
    res.json({ episodeId: await loop.playNow(stringField(req, "episodeId")) });
  });
  api.delete("/queue/:episodeId", async (req, res) => {
    await loop.removeFromQueue(String(req.params.episodeId));
    res.status(204).end();
  });
  api.patch("/queue", async (req, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order) || !order.every((id) => typeof id === "string")) {
      throw new HttpError(400, "order (liste d'IDs) requis.");
    }
    await loop.reorderQueue(order);
    res.status(204).end();
  });

  api.get("/history", (req, res) => {
    res.json(loop.history(intQuery(req, "limit", 50, 1, 1000)));
  });
  api.delete("/history", async (_req, res) => {
    await loop.resetHistory();
    res.status(204).end();
  });

  // --- Images (proxy : le token ne sort jamais du serveur) ----------------------

  api.get("/image/:itemId", async (req, res) => {
    const itemId = String(req.params.itemId);
    if (!ITEM_ID.test(itemId)) throw new HttpError(400, "ID invalide.");
    const maxHeight = intQuery(req, "maxHeight", 300, 32, 1080);
    let upstream: globalThis.Response;
    try {
      upstream = await client.image(itemId, maxHeight);
    } catch (err) {
      if (err instanceof JellyfinError && err.status === 404) throw new HttpError(404, "Pas d'image.");
      throw err;
    }
    res.set("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });

  // --- Accès depuis le téléphone (QR code) -------------------------------------

  api.get("/access", (req, res) => {
    const urls = accessUrls(serverConfig.port, serverConfig.publicUrl);
    const info: AccessInfo = { urls, primary: urls[0] ?? null, isLocal: isLoopback(req.socket.remoteAddress) };
    res.json(info);
  });

  api.get("/qr.svg", async (req, res) => {
    const urls = accessUrls(serverConfig.port, serverConfig.publicUrl);
    const wanted = typeof req.query.url === "string" ? req.query.url : urls[0];
    if (!wanted || !urls.includes(wanted)) throw new HttpError(400, "Adresse inconnue.");
    const svg = await QRCode.toString(wanted, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    res.set("Content-Type", "image/svg+xml");
    res.set("Cache-Control", "no-cache");
    res.send(svg);
  });

  // --- Assistant de configuration ---------------------------------------------

  api.get("/setup", async (_req, res) => {
    res.json(await setup.status());
  });
  api.get("/setup/discover", async (_req, res) => {
    res.json(await setup.discover());
  });
  api.post("/setup/server", async (req, res) => {
    res.json(await setup.setServer(stringField(req, "url")));
  });
  api.post("/setup/login", async (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    res.json(await setup.login(stringField(req, "username"), password));
  });
  api.post("/setup/logout", async (_req, res) => {
    await setup.logout();
    res.status(204).end();
  });
  api.post("/setup/player", async (req, res) => {
    const deviceId = req.body?.deviceId;
    if (deviceId !== null && typeof deviceId !== "string") throw new HttpError(400, "deviceId (chaîne ou null) requis.");
    await setup.choosePlayer(deviceId || null);
    res.status(204).end();
  });

  api.use((_req, _res) => {
    throw new HttpError(404, "Route inconnue.");
  });

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof JellyfinError) {
      const status = err.kind === "unreachable" ? 503 : err.kind === "unconfigured" ? 409 : 502;
      res.status(status).json({ error: err.message });
    } else if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "JSON invalide." });
    } else {
      log.error(`Erreur interne : ${(err as Error)?.stack ?? String(err)}`);
      res.status(500).json({ error: "Erreur interne." });
    }
  });

  return api;
}

function stringField(req: Request, name: string): string {
  const value = req.body?.[name];
  if (typeof value !== "string" || value === "") throw new HttpError(400, `${name} requis.`);
  return value;
}

function numberField(req: Request, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = req.body?.[name];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${name} doit être un nombre entre ${min} et ${max}.`);
  }
  return value;
}

function integerField(req: Request, name: string, min: number): number {
  const value = numberField(req, name, min);
  if (!Number.isInteger(value)) throw new HttpError(400, `${name} doit être un entier.`);
  return value;
}

function intQuery(req: Request, name: string, fallback: number, min: number, max: number): number {
  const value = Number(req.query[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
