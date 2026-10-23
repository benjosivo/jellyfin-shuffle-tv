import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_INFO, APP_VERSION, formatVersion, readAppVersion } from "./version.js";

describe("version", () => {
  it("package.json est la seule source", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(readAppVersion().version).toBe(pkg.version);
  });

  it("le commit est un hash court quand le dossier est un dépôt git", () => {
    if (APP_INFO.commit !== undefined) expect(APP_INFO.commit).toMatch(/^[0-9a-f]{7,}$/);
  });

  it("formatage avec et sans commit", () => {
    expect(formatVersion({ version: "0.1.0", commit: "f96ebaf" })).toBe("0.1.0 (f96ebaf)");
    expect(formatVersion({ version: "0.1.0" })).toBe("0.1.0");
  });
});
