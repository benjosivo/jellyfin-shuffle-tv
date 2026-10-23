import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AudioDevice } from "./shared/types.js";

// Sorties audio du PC, sous la forme que mpv attend dans `audio-device=` :
// - Windows : `wasapi/{0.0.0.00000000}.{GUID de la sortie}`, lu dans le registre (sorties actives seulement) ;
// - Linux : `pulse/<nom du sink>` (PulseAudio et PipeWire-Pulse), lu avec `pactl`.

const run = promisify(execFile);

// Étiquette Windows d'une sortie : « Haut-parleurs (Realtek(R) Audio) », comme dans le mélangeur de volume.
const WINDOWS_LIST = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render'
$devices = foreach ($key in Get-ChildItem $root -ErrorAction SilentlyContinue) {
  if (((Get-ItemProperty $key.PSPath).DeviceState -band 0xF) -ne 1) { continue }
  $props = Get-ItemProperty "$($key.PSPath)\\Properties"
  $name = $props.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
  $adapter = $props.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
  if (-not $name) { continue }
  [pscustomobject]@{ id = $key.PSChildName; name = $(if ($adapter) { "$name ($adapter)" } else { $name }) }
}
ConvertTo-Json -InputObject @($devices) -Compress
`;

const GUID = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;

export function parseWindowsDevices(json: string): AudioDevice[] {
  const parsed: unknown = JSON.parse(json.trim() || "[]");
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row): row is { id: string; name: string } => typeof row?.id === "string" && typeof row?.name === "string" && GUID.test(row.id))
    .map((row) => ({ id: `wasapi/{0.0.0.00000000}.${row.id.toLowerCase()}`, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parsePactlSinks(json: string): AudioDevice[] {
  const parsed: unknown = JSON.parse(json.trim() || "[]");
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((sink): sink is { name: string; description?: string } => typeof sink?.name === "string" && sink.name !== "")
    .map((sink) => ({ id: `pulse/${sink.name}`, name: sink.description || sink.name }));
}

/** Sorties audio de ce PC ; liste vide si le système ne sait pas les énumérer. */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  if (process.platform === "win32") {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_LIST], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    return parseWindowsDevices(stdout);
  }
  if (process.platform !== "linux") return [];
  try {
    const { stdout } = await run("pactl", ["--format=json", "list", "sinks"], { encoding: "utf8", timeout: 10_000 });
    return parsePactlSinks(stdout);
  } catch {
    return []; // pactl absent ou serveur de son injoignable
  }
}
