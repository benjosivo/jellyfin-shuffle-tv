import { describe, expect, it } from "vitest";
import type { SeriesState } from "../shared/types.js";
import * as q from "./queue.js";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `ep${i + 1}`);
const settings = { historyRatio: 0.95, queueSize: 5 };

function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

function ctx(n: number, extra: Partial<q.QueueContext> = {}): q.QueueContext {
  let t = 1000;
  return { episodeIds: ids(n), settings, random: seeded(), now: () => t++, ...extra };
}

const empty = (): SeriesState => ({ history: [], queue: [] });

describe("limits", () => {
  it("garde ~95 % pour une série de 200 épisodes (The Office)", () => {
    expect(q.limits(200, settings)).toEqual({ queueSize: 5, historyLimit: 190 });
  });

  it("laisse toujours au moins un épisode tirable sur une petite série", () => {
    expect(q.limits(10, settings)).toEqual({ queueSize: 5, historyLimit: 4 });
    expect(q.limits(3, settings)).toEqual({ queueSize: 2, historyLimit: 0 });
    expect(q.limits(1, settings)).toEqual({ queueSize: 0, historyLimit: 0 });
    expect(q.limits(0, settings)).toEqual({ queueSize: 0, historyLimit: 0 });
  });
});

describe("file d'attente", () => {
  it("remplit la file sans doublon ni épisode de l'historique", () => {
    const c = ctx(20);
    const s: SeriesState = { history: [{ id: "ep1", at: 1 }, { id: "ep2", at: 2 }], queue: [] };
    q.refill(s, c);
    expect(s.queue).toHaveLength(5);
    expect(new Set(s.queue).size).toBe(5);
    expect(s.queue).not.toContain("ep1");
    expect(s.queue).not.toContain("ep2");
  });

  it("takeNext prend la tête de file, l'ajoute à l'historique et recomplète", () => {
    const c = ctx(20);
    const s = empty();
    q.refill(s, c);
    const head = s.queue[0];
    expect(q.takeNext(s, c)).toBe(head);
    expect(s.history.at(-1)?.id).toBe(head);
    expect(s.queue).toHaveLength(5);
    expect(s.queue).not.toContain(head);
  });

  it("ne rejoue rien avant d'avoir épuisé la série (hors marge de la file)", () => {
    const c = ctx(200);
    const s = empty();
    const played: string[] = [];
    for (let i = 0; i < 190; i++) played.push(q.takeNext(s, c)!);
    expect(new Set(played).size).toBe(190);
    expect(s.history).toHaveLength(190);
  });

  it("tourne indéfiniment sur une petite série sans vider l'historique en boucle", () => {
    const c = ctx(8);
    const s = empty();
    let previous: string | undefined;
    for (let i = 0; i < 100; i++) {
      const id = q.takeNext(s, c)!;
      expect(id).toBeDefined();
      expect(id).not.toBe(previous);
      previous = id;
      const lim = q.limits(8, settings);
      expect(s.history.length).toBeLessThanOrEqual(lim.historyLimit);
      const inQueueAndHistory = s.queue.filter((x) => s.history.some((h) => h.id === x));
      expect(inQueueAndHistory).toEqual([]);
    }
  });

  it("fonctionne avec une série d'un seul épisode", () => {
    const c = ctx(1);
    const s = empty();
    expect(q.takeNext(s, c)).toBe("ep1");
    expect(q.takeNext(s, c)).toBe("ep1");
  });

  it("vide l'historique si tout est exclu (comportement du script fish)", () => {
    const c = ctx(3, { settings: { historyRatio: 1, queueSize: 0 } });
    const s: SeriesState = { history: ids(3).map((id, at) => ({ id, at })), queue: [] };
    const id = q.draw(s, c);
    expect(id).toBeDefined();
    expect(s.history).toEqual([]);
  });

  it("takeSpecific retire l'épisode de la file et compte dans l'historique", () => {
    const c = ctx(20);
    const s = empty();
    q.refill(s, c);
    const third = s.queue[2]!;
    q.takeSpecific(s, third, c);
    expect(s.queue).not.toContain(third);
    expect(s.queue).toHaveLength(5);
    expect(s.history.at(-1)?.id).toBe(third);
  });

  it("undoTake remet l'épisode en tête de file", () => {
    const c = ctx(20);
    const s = empty();
    q.refill(s, c);
    const id = q.takeNext(s, c)!;
    q.undoTake(s, id, c);
    expect(s.queue[0]).toBe(id);
    expect(s.history.find((h) => h.id === id)).toBeUndefined();
    expect(s.queue.length).toBeLessThanOrEqual(5);
  });

  it("removeFromQueue recomplète sans reprendre l'épisode retiré", () => {
    const c = ctx(20);
    const s = empty();
    q.refill(s, c);
    const removed = s.queue[1]!;
    expect(q.removeFromQueue(s, removed, c)).toBe(true);
    expect(s.queue).toHaveLength(5);
    expect(s.queue).not.toContain(removed);
    expect(q.removeFromQueue(s, "inconnu", c)).toBe(false);
  });

  it("reorder n'accepte qu'une permutation exacte", () => {
    const s: SeriesState = { history: [], queue: ["a", "b", "c"] };
    expect(q.reorder(s, ["c", "a"])).toBe(false);
    expect(q.reorder(s, ["c", "a", "a"])).toBe(false);
    expect(q.reorder(s, ["c", "a", "x"])).toBe(false);
    expect(q.reorder(s, ["c", "a", "b"])).toBe(true);
    expect(s.queue).toEqual(["c", "a", "b"]);
  });

  it("reroll évite les épisodes de l'ancienne file quand c'est possible", () => {
    const c = ctx(50);
    const s = empty();
    q.refill(s, c);
    const before = [...s.queue];
    q.reroll(s, c);
    expect(s.queue).toHaveLength(5);
    expect(s.queue.filter((id) => before.includes(id))).toEqual([]);
  });

  it("sanitize retire les épisodes disparus et les doublons", () => {
    const c = ctx(10);
    const s: SeriesState = {
      history: [{ id: "ep1", at: 1 }, { id: "zz", at: 2 }, { id: "ep1", at: 3 }],
      queue: ["ep1", "ep2", "ep2", "old"],
    };
    q.sanitize(s, c);
    expect(s.history).toEqual([{ id: "ep1", at: 3 }]);
    expect(s.queue).toEqual(["ep2"]);
  });
});

describe("dans l'ordre", () => {
  const seq = (): SeriesState => ({ history: [], queue: [], order: "sequential" });

  it("successeur et prédécesseur bouclent sur la série", () => {
    const c = ctx(4);
    expect(q.successor("ep4", c)).toBe("ep1");
    expect(q.successor(undefined, c)).toBe("ep1");
    expect(q.predecessor("ep1", c)).toBe("ep4");
    expect(q.predecessor("ep3", c)).toBe("ep2");
  });

  it("la file est la suite de l'épisode en cours, y compris des épisodes déjà vus", () => {
    const c = ctx(20, { currentId: "ep7" });
    const s: SeriesState = { ...seq(), history: [{ id: "ep8", at: 1 }, { id: "ep7", at: 2 }] };
    q.refill(s, c);
    expect(s.queue).toEqual(["ep8", "ep9", "ep10", "ep11", "ep12"]);
    q.sanitize(s, c);
    expect(s.queue[0]).toBe("ep8"); // un épisode déjà vu reste dans la file en mode ordre
  });

  it("enchaîne dans l'ordre et repart au début après le dernier épisode", () => {
    const c = ctx(6);
    const s = seq();
    const played = Array.from({ length: 8 }, () => q.takeNext(s, c));
    expect(played).toEqual(["ep1", "ep2", "ep3", "ep4", "ep5", "ep6", "ep1", "ep2"]);
  });

  it("lire maintenant : la suite repart de l'épisode choisi", () => {
    const c = ctx(20, { currentId: "ep2" });
    const s = seq();
    q.refill(s, c);
    q.takeSpecific(s, "ep15", c);
    expect(s.queue).toEqual(["ep16", "ep17", "ep18", "ep19", "ep20"]);
  });

  it("passer d'un mode à l'autre reconstruit la file", () => {
    const c = ctx(30, { currentId: "ep10" });
    const s = empty();
    q.refill(s, c);
    q.setOrder(s, "sequential", c);
    expect(s.queue).toEqual(["ep11", "ep12", "ep13", "ep14", "ep15"]);
    q.setOrder(s, "shuffle", c);
    expect(s.order).toBe("shuffle");
    expect(s.queue).toHaveLength(5);
  });
});

describe("lire ensuite / épisode précédent", () => {
  it("lire ensuite place l'épisode en tête sans dépasser la taille de la file", () => {
    const c = ctx(20);
    const s = empty();
    q.refill(s, c);
    const third = s.queue[2]!;
    q.playNext(s, "ep20", c);
    expect(s.queue[0]).toBe("ep20");
    expect(s.queue).toHaveLength(5);
    q.playNext(s, third, c);
    expect(s.queue[0]).toBe(third);
    expect(s.queue.filter((id) => id === third)).toHaveLength(1);
  });

  it("aléatoire : précédent remonte l'historique, et suivant ramène à l'épisode quitté", () => {
    const s: SeriesState = { history: ["ep3", "ep9", "ep5"].map((id, at) => ({ id, at })), queue: ["ep1", "ep2"] };
    const c = ctx(20, { currentId: "ep5" });
    expect(q.stepBack(s, c)).toBe("ep9");
    expect(s.queue[0]).toBe("ep5");
    expect(s.history.map((h) => h.id)).toEqual(["ep3", "ep9"]);
    // Un deuxième « précédent » remonte encore.
    expect(q.stepBack(s, ctx(20, { currentId: "ep9" }))).toBe("ep3");
    expect(s.queue.slice(0, 2)).toEqual(["ep9", "ep5"]);
  });

  it("dans l'ordre : précédent = épisode d'avant dans la série, l'épisode quitté devient le suivant", () => {
    const s: SeriesState = { history: [], queue: [], order: "sequential" };
    const c = ctx(20, { currentId: "ep1" });
    expect(q.stepBack(s, c)).toBe("ep20");
    expect(s.queue[0]).toBe("ep1");
  });
});
