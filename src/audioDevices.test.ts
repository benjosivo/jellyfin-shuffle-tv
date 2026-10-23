import { describe, expect, it } from "vitest";
import { parsePactlSinks, parseWindowsDevices } from "./audioDevices.js";

describe("sorties audio Windows", () => {
  it("construit l'identifiant wasapi de mpv et trie par nom", () => {
    const json = JSON.stringify([
      { id: "{66C79EA4-5FFD-4062-BE35-3CBC70680051}", name: "Haut-parleurs (Logitech PRO X Wireless Gaming Headset)" },
      { id: "{08d741ae-9367-455d-a8f2-f1e27d5b4df6}", name: "Casque (Benji’s AirPods)" },
    ]);
    expect(parseWindowsDevices(json)).toEqual([
      { id: "wasapi/{0.0.0.00000000}.{08d741ae-9367-455d-a8f2-f1e27d5b4df6}", name: "Casque (Benji’s AirPods)" },
      { id: "wasapi/{0.0.0.00000000}.{66c79ea4-5ffd-4062-be35-3cbc70680051}", name: "Haut-parleurs (Logitech PRO X Wireless Gaming Headset)" },
    ]);
  });

  it("accepte une seule sortie (PowerShell n'emballe pas toujours dans un tableau) ou aucune", () => {
    expect(parseWindowsDevices(JSON.stringify({ id: "{08d741ae-9367-455d-a8f2-f1e27d5b4df6}", name: "A" }))).toHaveLength(1);
    expect(parseWindowsDevices("[]")).toEqual([]);
    expect(parseWindowsDevices("")).toEqual([]);
  });

  it("écarte ce qui n'est pas un GUID", () => {
    expect(parseWindowsDevices(JSON.stringify([{ id: "x\nvolume=100", name: "Piégé" }]))).toEqual([]);
  });
});

describe("sorties audio Linux", () => {
  it("préfixe le nom du sink par pulse/ et préfère la description", () => {
    const json = JSON.stringify([
      { name: "alsa_output.pci-0000_00_1f.3.analog-stereo", description: "Audio interne Stéréo analogique" },
      { name: "bluez_output.AA_BB", description: "" },
    ]);
    expect(parsePactlSinks(json)).toEqual([
      { id: "pulse/alsa_output.pci-0000_00_1f.3.analog-stereo", name: "Audio interne Stéréo analogique" },
      { id: "pulse/bluez_output.AA_BB", name: "bluez_output.AA_BB" },
    ]);
    expect(parsePactlSinks("[]")).toEqual([]);
  });
});
