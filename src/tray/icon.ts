import type { TrayLevel } from "../shared/types.js";

// Icônes d'état dessinées en mémoire (pas de dépendance) : un disque de couleur et un symbole blanc.
//   lecture ▶ vert · pause ❚❚ bleu · attente ■ gris · problème ! orange · arrêté ✕ rouge

export const LEVEL_COLORS: Record<TrayLevel, string> = {
  playing: "#3fb27f",
  paused: "#5b9be6",
  idle: "#8a91a3",
  warning: "#f0a830",
  stopped: "#e5534b",
};

type Shape = (x: number, y: number) => boolean;

// Coordonnées normalisées : (0,0) en haut à gauche, (1,1) en bas à droite.
const disc: Shape = (x, y) => (x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.47 ** 2;

function triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Shape {
  const sign = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  return (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx, cy);
    const d3 = sign(x, y, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
}

const rect =
  (x0: number, y0: number, x1: number, y1: number): Shape =>
  (x, y) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1;

const union =
  (...shapes: Shape[]): Shape =>
  (x, y) =>
    shapes.some((shape) => shape(x, y));

/** Segment épais entre deux points (pour la croix). */
function stroke(ax: number, ay: number, bx: number, by: number, width: number): Shape {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (width / 2) ** 2;
  };
}

const GLYPHS: Record<TrayLevel, Shape> = {
  playing: triangle(0.39, 0.29, 0.39, 0.71, 0.73, 0.5),
  paused: union(rect(0.34, 0.3, 0.45, 0.7), rect(0.55, 0.3, 0.66, 0.7)),
  idle: rect(0.34, 0.34, 0.66, 0.66),
  warning: union(rect(0.445, 0.24, 0.555, 0.6), rect(0.445, 0.67, 0.555, 0.77)),
  stopped: union(stroke(0.34, 0.34, 0.66, 0.66, 0.12), stroke(0.66, 0.34, 0.34, 0.66, 0.12)),
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Pixels RGBA (non prémultipliés), avec anticrénelage par suréchantillonnage 4×4. */
export function renderIcon(level: TrayLevel, size: number): Buffer {
  const [r, g, b] = hexToRgb(LEVEL_COLORS[level]);
  const glyph = GLYPHS[level];
  const out = Buffer.alloc(size * size * 4);
  const n = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let coverDisc = 0;
      let coverGlyph = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const x = (px + (sx + 0.5) / n) / size;
          const y = (py + (sy + 0.5) / n) / size;
          if (disc(x, y)) {
            coverDisc++;
            if (glyph(x, y)) coverGlyph++;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (coverDisc === 0) continue;
      const white = coverGlyph / coverDisc;
      out[i] = Math.round(r + (255 - r) * white);
      out[i + 1] = Math.round(g + (255 - g) * white);
      out[i + 2] = Math.round(b + (255 - b) * white);
      out[i + 3] = Math.round((coverDisc / (n * n)) * 255);
    }
  }
  return out;
}

/** Format StatusNotifierItem : ARGB32 en ordre réseau (big-endian). */
export function toArgb(rgba: Buffer): Buffer {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 3]!;
    out[i + 1] = rgba[i]!;
    out[i + 2] = rgba[i + 1]!;
    out[i + 3] = rgba[i + 2]!;
  }
  return out;
}
