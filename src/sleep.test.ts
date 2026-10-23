import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectAcquire, RELEASE_GRACE_MS, RETRY_AFTER_MS, SleepGuard, type Acquire } from "./sleep.js";

const quiet = { info: () => {}, warn: () => {} };

function fakeAcquire() {
  const calls = { acquired: 0, released: 0, lose: [] as (() => void)[] };
  const acquire: Acquire = (onLost) => {
    calls.acquired++;
    calls.lose.push(onLost);
    return { release: () => void calls.released++ };
  };
  return { acquire, calls };
}

describe("SleepGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("prend le verrou une seule fois tant que la lecture continue", () => {
    const { acquire, calls } = fakeAcquire();
    const guard = new SleepGuard(acquire, quiet);
    guard.want(true);
    guard.want(true);
    expect(calls.acquired).toBe(1);
    expect(guard.held).toBe(true);
  });

  it("garde le verrou pendant le délai de grâce, puis le relâche", () => {
    const { acquire, calls } = fakeAcquire();
    const guard = new SleepGuard(acquire, quiet);
    guard.want(true);
    guard.want(false);
    vi.advanceTimersByTime(RELEASE_GRACE_MS - 1);
    expect(calls.released).toBe(0);
    vi.advanceTimersByTime(1);
    expect(calls.released).toBe(1);
    expect(guard.held).toBe(false);
  });

  it("annule le relâchement quand la lecture repart avant la fin du délai", () => {
    const { acquire, calls } = fakeAcquire();
    const guard = new SleepGuard(acquire, quiet);
    guard.want(true);
    guard.want(false);
    vi.advanceTimersByTime(RELEASE_GRACE_MS / 2);
    guard.want(true);
    vi.advanceTimersByTime(RELEASE_GRACE_MS);
    expect(calls.released).toBe(0);
    expect(calls.acquired).toBe(1);
  });

  it("stop() relâche tout de suite", () => {
    const { acquire, calls } = fakeAcquire();
    const guard = new SleepGuard(acquire, quiet);
    guard.want(true);
    guard.stop();
    expect(calls.released).toBe(1);
    vi.advanceTimersByTime(RELEASE_GRACE_MS * 2);
    expect(calls.released).toBe(1);
  });

  it("réessaie après un délai quand le process s'arrête tout seul, sans boucler", () => {
    const { acquire, calls } = fakeAcquire();
    const guard = new SleepGuard(acquire, quiet);
    guard.want(true);
    calls.lose[0]!();
    expect(guard.held).toBe(false);

    guard.want(true);
    expect(calls.acquired).toBe(1);
    vi.advanceTimersByTime(RETRY_AFTER_MS);
    guard.want(true);
    expect(calls.acquired).toBe(2);
  });

  it("ne fait rien sans méthode de blocage", () => {
    const guard = new SleepGuard(undefined, quiet);
    guard.want(true);
    expect(guard.available).toBe(false);
    expect(guard.held).toBe(false);
  });
});

describe("detectAcquire", () => {
  it("n'a pas de méthode sur les autres systèmes", async () => {
    expect(await detectAcquire("darwin")).toBeUndefined();
  });

  it("a une méthode sous Windows", async () => {
    expect(await detectAcquire("win32")).toBeTypeOf("function");
  });
});
