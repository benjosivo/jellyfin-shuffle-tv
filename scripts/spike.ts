// Spike : vérifie, sur la vraie machine, ce que MPV Shim accepte avant de se fier à l'application.
//
//   npm run spike            → liste les sessions et indique celle qui serait pilotée
//   npm run spike -- --test  → teste pas à pas les commandes sur l'épisode en cours
//
// Un rapport est écrit dans <dossier de config>/spike-report.json.

import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { ConfigManager, makePaths } from "../src/config.js";
import { fetchPublicInfo, JellyfinClient } from "../src/jellyfin/client.js";
import { describeSession, explainSessions, findPlayerSession } from "../src/jellyfin/session.js";
import { TICKS_PER_SECOND, type JfPlayState, type JfSession } from "../src/jellyfin/types.js";
import { toTracks } from "../src/player/library.js";
import { playerMatch } from "../src/setup.js";

const testMode = process.argv.includes("--test");
const paths = makePaths();
const config = await ConfigManager.load(paths);
const client = new JellyfinClient(config);
const report: Record<string, unknown> = { date: new Date().toISOString(), serverUrl: config.serverUrl, tests: [] };
const tests = report.tests as unknown[];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const title = (text: string) => console.log(`\n=== ${text} ===`);

async function finish(code = 0): Promise<never> {
  await fs.writeFile(paths.spikeReport, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nRapport : ${paths.spikeReport}`);
  rl.close();
  process.exit(code);
}

// 1. Connexion -----------------------------------------------------------------

title("Connexion");
if (!config.serverUrl || !(await config.readCredentials())) {
  console.log("Pas encore configuré : lancer l'application (npm start) et suivre l'assistant, puis relancer le spike.");
  await finish(1);
}
try {
  const info = await fetchPublicInfo(config.serverUrl!, config.identity);
  console.log(`Serveur : ${info.ServerName ?? "?"} (Jellyfin ${info.Version ?? "?"}) sur ${config.serverUrl}`);
  report.server = info;
} catch (err) {
  console.log(`Jellyfin injoignable : ${(err as Error).message}`);
  await finish(1);
}
console.log(`Identité de l'application : Client="${config.identity.client}", DeviceId="${config.identity.deviceId}"`);
console.log(`Utilisateur attendu pour MPV Shim : ${config.userName ?? "(aucun)"}`);

// 2. Sessions ------------------------------------------------------------------

title("Sessions");
let sessions: JfSession[];
try {
  sessions = await client.getSessions();
} catch (err) {
  console.log(`GET /Sessions impossible : ${(err as Error).message}`);
  await finish(1);
}
const match = playerMatch(config);
const verdicts = explainSessions(sessions!, match);
report.sessions = verdicts.map((v) => ({ ...describeSession(v.session), matches: v.matches, reasons: v.reasons }));

for (const { session, matches, reasons } of verdicts) {
  console.log(`\n${matches ? "✅" : "  "} ${session.Client ?? "?"} — ${session.DeviceName ?? "?"}`);
  console.log(`   Id=${session.Id}  DeviceId=${session.DeviceId ?? "?"}  User=${session.UserName ?? "?"}`);
  console.log(`   SupportsRemoteControl=${session.SupportsRemoteControl ?? false}  NowPlaying=${session.NowPlayingItem?.Name ?? "-"}`);
  const commands = describeSession(session).supportedCommands;
  if (commands.length) console.log(`   SupportedCommands : ${commands.join(", ")}`);
  console.log(`   → ${reasons.join(" ; ")}`);
  if (session.Client === "CachyOS Office Auto") {
    console.log("   ⚠ C'est le client de auth.py : l'ancien script fish ciblait cette session-là.");
  }
}

const player = findPlayerSession(sessions!, match);
title("Résultat");
if (!player) {
  console.log("Aucune session MPV Shim reconnue.");
  console.log("- MPV Shim est-il lancé et connecté avec le même utilisateur ?");
  console.log("- Sinon, repérer sa ligne ci-dessus et fixer PLAYER_DEVICE_ID=<DeviceId> (ou PLAYER_MATCH=<motif>).");
  await finish(1);
}
console.log(`Session retenue : ${player!.Client} sur ${player!.DeviceName} (DeviceId=${player!.DeviceId})`);
report.player = describeSession(player!);

if (!testMode) {
  console.log("\nPour tester les commandes sur l'épisode en cours : npm run spike -- --test");
  await finish(0);
}

// 3. Tests des commandes -----------------------------------------------------------

title("Tests des commandes");
if (!player!.NowPlayingItem) {
  console.log("Rien en lecture sur MPV Shim : lancer un épisode puis relancer le test.");
  await finish(1);
}

const sessionId = player!.Id;
const itemId = player!.NowPlayingItem!.Id;
const tracks = toTracks(await client.getItem(itemId));
report.tracks = tracks;
console.log(`Épisode : ${player!.NowPlayingItem!.Name}`);
console.log(`Pistes audio : ${tracks.audio.map((t) => `${t.index}=${t.label}`).join(", ") || "aucune"}`);
console.log(`Sous-titres : ${tracks.subtitles.map((t) => `${t.index}=${t.label}`).join(", ") || "aucun"}`);

async function playState(): Promise<JfPlayState> {
  const list = await client.getSessions();
  return list.find((s) => s.Id === sessionId)?.PlayState ?? {};
}

async function step(
  name: string,
  run: () => Promise<void>,
  check: (before: JfPlayState, after: JfPlayState) => boolean | undefined,
): Promise<void> {
  const answer = (await rl.question(`\n▶ ${name} ? [O/n/q] `)).trim().toLowerCase();
  if (answer === "q") await finish(0);
  if (answer === "n") {
    tests.push({ name, skipped: true });
    return;
  }
  const before = await playState();
  let error: string | undefined;
  try {
    await run();
  } catch (err) {
    error = (err as Error).message;
  }
  await sleep(3000);
  const after = await playState();
  const observed = error ? false : check(before, after);
  const seen = (await rl.question("  L'effet est-il visible sur l'écran ? [o/n] ")).trim().toLowerCase() === "o";
  const status = error ? `❌ refusé (${error})` : observed === undefined ? "– non vérifiable via PlayState" : observed ? "✅ PlayState à jour" : "⚠ PlayState inchangé";
  console.log(`  ${status}`);
  tests.push({ name, error, playStateChanged: observed, visibleOnScreen: seen, before, after });
}

const initial = await playState();
const volume = initial.VolumeLevel ?? 100;
const target = volume >= 20 ? volume - 10 : volume + 10;

await step(
  `SetVolume ${volume} → ${target}`,
  () => client.command(sessionId, "SetVolume", { Volume: String(target) }),
  (_b, a) => a.VolumeLevel === target,
);
await step(
  `SetVolume retour à ${volume}`,
  () => client.command(sessionId, "SetVolume", { Volume: String(volume) }),
  (_b, a) => a.VolumeLevel === volume,
);
await step("Mute", () => client.command(sessionId, "Mute"), (_b, a) => a.IsMuted === true);
await step("Unmute", () => client.command(sessionId, "Unmute"), (_b, a) => a.IsMuted === false);

const otherAudio = tracks.audio.find((t) => t.index !== initial.AudioStreamIndex);
if (otherAudio) {
  await step(
    `SetAudioStreamIndex → ${otherAudio.index} (${otherAudio.label})`,
    () => client.command(sessionId, "SetAudioStreamIndex", { Index: String(otherAudio.index) }),
    (_b, a) => a.AudioStreamIndex === otherAudio.index,
  );
  if (initial.AudioStreamIndex !== undefined) {
    await step(
      `SetAudioStreamIndex retour à ${initial.AudioStreamIndex}`,
      () => client.command(sessionId, "SetAudioStreamIndex", { Index: String(initial.AudioStreamIndex) }),
      (_b, a) => a.AudioStreamIndex === initial.AudioStreamIndex,
    );
  }
} else {
  console.log("\n(une seule piste audio : SetAudioStreamIndex non testé)");
}

const otherSub = tracks.subtitles.find((t) => t.index !== initial.SubtitleStreamIndex);
if (otherSub) {
  await step(
    `SetSubtitleStreamIndex → ${otherSub.index} (${otherSub.label})`,
    () => client.command(sessionId, "SetSubtitleStreamIndex", { Index: String(otherSub.index) }),
    (_b, a) => a.SubtitleStreamIndex === otherSub.index,
  );
}
await step(
  "SetSubtitleStreamIndex → -1 (désactivés)",
  () => client.command(sessionId, "SetSubtitleStreamIndex", { Index: "-1" }),
  (_b, a) => a.SubtitleStreamIndex === -1 || a.SubtitleStreamIndex === undefined,
);

const position = (await playState()).PositionTicks ?? 0;
const forward = position + 30 * TICKS_PER_SECOND;
await step(
  "Seek +30 s",
  () => client.playstate(sessionId, "Seek", { seekPositionTicks: forward }),
  (_b, a) => (a.PositionTicks ?? 0) >= forward - 2 * TICKS_PER_SECOND,
);
await step(
  "Seek retour",
  () => client.playstate(sessionId, "Seek", { seekPositionTicks: position }),
  (_b, a) => (a.PositionTicks ?? 0) < forward - 10 * TICKS_PER_SECOND,
);
await step("Pause", () => client.playstate(sessionId, "Pause"), (_b, a) => a.IsPaused === true);
await step("Unpause", () => client.playstate(sessionId, "Unpause"), (_b, a) => a.IsPaused === false);

title("Terminé");
console.log("Si une commande est refusée ou sans effet, envoyer spike-report.json pour adapter l'application.");
await finish(0);
