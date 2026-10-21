import fs from "node:fs/promises";
import path from "node:path";

/**
 * Écrit un fichier de façon atomique (fichier temporaire puis rename).
 * Sous Windows, rename peut échouer brièvement (EPERM/EBUSY, antivirus, indexeur) : on réessaie.
 */
export async function writeFileAtomic(file: string, content: string, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, { encoding: "utf8", mode });
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
  if (mode !== undefined && process.platform !== "win32") await fs.chmod(file, mode);
}
