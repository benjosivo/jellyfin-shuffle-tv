import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { log as defaultLog } from "./log.js";

// Blocage de la mise en veille tant qu'un contenu est ouvert (en pause aussi). Le système n'offre pas d'API Node : on garde en
// vie un petit process enfant qui tient le verrou, et on le laisse mourir pour le relâcher.
//
// - Windows : PowerShell appelle SetThreadExecutionState (système + écran) et attend sur stdin.
// - Linux   : `systemd-inhibit` (logind) garde un verrou « sleep:idle » tant que `cat` lit stdin.
//
// Dans les deux cas le process s'arrête à la fermeture de stdin : si l'application disparaît sans
// prévenir, le verrou tombe avec elle.

const run = promisify(execFile);

/** Délai de maintien après la fin de la lecture : couvre le passage d'un épisode au suivant. */
export const RELEASE_GRACE_MS = 90_000;
/** Délai avant un nouvel essai quand le process de blocage s'est arrêté tout seul. */
export const RETRY_AFTER_MS = 60_000;

type Logger = Pick<typeof defaultLog, "info" | "warn">;

export interface Holder {
  release(): void;
}

/** Prend le verrou. `onLost` est appelé si le process s'arrête sans qu'on l'ait demandé. */
export type Acquire = (onLost: () => void) => Holder | undefined;

// ES_CONTINUOUS (0x80000000) | ES_DISPLAY_REQUIRED (2) | ES_SYSTEM_REQUIRED (1), en décimal :
// PowerShell lirait l'hexadécimal comme un entier signé, refusé par le paramètre `uint`.
const WINDOWS_SCRIPT = `
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
if ([Win32.Power]::SetThreadExecutionState(2147483651) -eq 0) { exit 1 }
[void][Console]::In.ReadToEnd()
`;

function holdChild(command: string, args: string[], onLost: () => void, windowsHide = false): Holder | undefined {
  const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide });
  let released = false;
  const lost = () => {
    if (!released) onLost();
  };
  child.once("error", lost);
  child.once("exit", lost);
  child.stdin.on("error", () => undefined); // EPIPE si le process est déjà parti
  return {
    release() {
      released = true;
      child.stdin.end();
      child.kill();
    },
  };
}

const windowsAcquire: Acquire = (onLost) =>
  holdChild(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")],
    onLost,
    true,
  );

const linuxAcquire: Acquire = (onLost) =>
  holdChild(
    "systemd-inhibit",
    ["--what=sleep:idle", "--who=Jellyfin en boucle", "--why=Lecture en cours", "--mode=block", "cat"],
    onLost,
  );

/** Méthode de blocage de ce système, ou `undefined` s'il n'y en a pas (macOS, Linux sans systemd). */
export async function detectAcquire(platform: NodeJS.Platform = process.platform): Promise<Acquire | undefined> {
  if (platform === "win32") return windowsAcquire;
  if (platform !== "linux") return undefined;
  try {
    await run("systemd-inhibit", ["--version"], { timeout: 5000 });
    return linuxAcquire;
  } catch {
    return undefined;
  }
}

export class SleepGuard {
  private holder?: Holder;
  private releaseTimer?: NodeJS.Timeout;
  private retryAt = 0;

  constructor(
    private readonly acquire: Acquire | undefined,
    private readonly log: Logger = defaultLog,
    private readonly graceMs = RELEASE_GRACE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Ce système sait bloquer la veille. */
  get available(): boolean {
    return this.acquire !== undefined;
  }

  /** Le verrou est tenu en ce moment. */
  get held(): boolean {
    return this.holder !== undefined;
  }

  /** À appeler à chaque changement d'état : `wanted` = la veille doit être bloquée maintenant. */
  want(wanted: boolean): void {
    if (wanted) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = undefined;
      this.take();
    } else if (this.holder && !this.releaseTimer) {
      this.releaseTimer = setTimeout(() => this.release(), this.graceMs);
      this.releaseTimer.unref();
    }
  }

  /** Relâche tout de suite (arrêt de l'application). */
  stop(): void {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = undefined;
    this.release();
  }

  private take(): void {
    if (this.holder || !this.acquire || this.now() < this.retryAt) return;
    const holder: Holder | undefined = this.acquire(() => {
      if (this.holder !== holder) return;
      this.holder = undefined;
      this.retryAt = this.now() + RETRY_AFTER_MS;
      this.log.warn("Le blocage de la veille s'est arrêté ; nouvel essai dans une minute.");
    });
    if (!holder) return;
    this.holder = holder;
    this.log.info("Mise en veille bloquée pendant la lecture.");
  }

  private release(): void {
    if (!this.holder) return;
    this.holder.release();
    this.holder = undefined;
    this.log.info("Mise en veille de nouveau possible.");
  }
}
