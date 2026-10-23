import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCompressor,
  COMPRESSOR_FILTER,
  compressorState,
  enableCompressorByDefault,
  findMpvShimConfigDir,
  hasOwnAudioFilter,
  mpvShimConfigCandidates,
  readCompressor,
  removeCompressor,
  removeCompressorBlock,
  writeCompressor,
} from "./audio.js";

const OWN = "hwdec=auto\nvolume-max=150\n";

describe("bloc du compresseur dans mpv.conf", () => {
  it("ajoute le bloc à la fin sans toucher au reste", () => {
    const conf = applyCompressor(OWN, true);
    expect(conf.startsWith(OWN)).toBe(true);
    expect(conf).toContain(`af-append=${COMPRESSOR_FILTER}`);
    expect(compressorState(conf)).toBe("on");
  });

  it("désactive en gardant le bloc en commentaire, et réactive sans le dupliquer", () => {
    const off = applyCompressor(applyCompressor(OWN, true), false);
    expect(compressorState(off)).toBe("off");
    expect(off).toContain(`# af-append=${COMPRESSOR_FILTER}`);
    const on = applyCompressor(off, true);
    expect(compressorState(on)).toBe("on");
    expect(on.match(/>>> jellyfin-en-boucle/g)).toHaveLength(1);
    expect(on.startsWith(OWN)).toBe(true);
  });

  it("retire le bloc et rend le fichier d'origine", () => {
    expect(removeCompressor(applyCompressor(OWN, true))).toBe(OWN);
    expect(removeCompressor(OWN)).toBe(OWN);
    expect(compressorState(OWN)).toBe("absent");
  });

  it("complète une dernière ligne sans retour à la ligne et garde les fins de ligne Windows", () => {
    expect(applyCompressor("hwdec=auto", true)).toMatch(/^hwdec=auto\n# >>>/);
    const crlf = applyCompressor("hwdec=auto\r\n", true);
    expect(crlf).not.toMatch(/[^\r]\n/);
    expect(removeCompressor(crlf)).toBe("hwdec=auto\r\n");
    expect(compressorState(crlf)).toBe("on");
  });

  it("repère un filtre audio écrit à la main, mais pas le nôtre", () => {
    expect(hasOwnAudioFilter(OWN)).toBe(false);
    expect(hasOwnAudioFilter(applyCompressor(OWN, true))).toBe(false);
    expect(hasOwnAudioFilter("af=lavfi=[dynaudnorm]\n")).toBe(true);
    expect(hasOwnAudioFilter("af-add=loudnorm\n")).toBe(true);
    expect(hasOwnAudioFilter("# af=commenté\n")).toBe(false);
  });
});

describe("dossiers et fichier", () => {
  const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "audio-"));

  it("cherche le dossier de MPV Shim selon la plateforme", () => {
    expect(mpvShimConfigCandidates({ APPDATA: "C:\\Roaming" }, "win32", "C:\\Users\\a")[0]).toMatch(/Roaming.jellyfin-mpv-shim$/);
    expect(mpvShimConfigCandidates({}, "linux", "/home/a")).toEqual([
      path.join("/home/a", ".config", "jellyfin-mpv-shim"),
      path.join("/home/a", ".var", "app", "com.github.iwalton3.jellyfin-mpv-shim", "config", "jellyfin-mpv-shim"),
    ]);
    expect(mpvShimConfigCandidates({ MPV_SHIM_CONFIG_DIR: "/x" }, "linux")).toEqual(["/x"]);
  });

  it("renvoie le premier dossier qui existe, sinon rien", async () => {
    const dir = await tmp();
    expect(await findMpvShimConfigDir([path.join(dir, "absent"), dir])).toBe(dir);
    expect(await findMpvShimConfigDir([path.join(dir, "absent")])).toBeUndefined();
  });

  it("lit et écrit mpv.conf, même s'il n'existe pas encore", async () => {
    const dir = await tmp();
    expect(await readCompressor(dir)).toBe(false);
    await writeCompressor(dir, true);
    expect(await readCompressor(dir)).toBe(true);
    await writeCompressor(dir, false);
    expect(await readCompressor(dir)).toBe(false);
  });

  it("n'active par défaut que si rien n'est décidé", async () => {
    const fresh = await tmp();
    expect(await enableCompressorByDefault(fresh)).toBe("enabled");
    expect(await readCompressor(fresh)).toBe(true);

    const disabled = await tmp();
    await writeCompressor(disabled, false);
    expect(await enableCompressorByDefault(disabled)).toBe("kept");
    expect(await readCompressor(disabled)).toBe(false);

    const custom = await tmp();
    await fs.writeFile(path.join(custom, "mpv.conf"), "af=lavfi=[dynaudnorm]\n");
    expect(await enableCompressorByDefault(custom)).toBe("own-filter");
    expect(await fs.readFile(path.join(custom, "mpv.conf"), "utf8")).toBe("af=lavfi=[dynaudnorm]\n");
  });

  it("retire le bloc à la désinstallation et laisse le reste", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "mpv.conf"), OWN);
    await writeCompressor(dir, true);
    expect(await removeCompressorBlock(dir)).toBe(true);
    expect(await fs.readFile(path.join(dir, "mpv.conf"), "utf8")).toBe(OWN);
    expect(await removeCompressorBlock(dir)).toBe(false);
  });
});
