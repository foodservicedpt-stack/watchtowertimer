// Genera los iconos PNG de la PWA sin dependencias externas.
// Dibuja la marca de WatchtowerTimer (anillo verde sobre fondo profundo, "W" blanca)
// usando funciones de distancia con signo (SDF) y codifica PNG a mano con node:zlib.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------- PNG ----------
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro "None"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- SDF ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function sdCircle(px, py, cx, cy, r) { return Math.hypot(px - cx, py - cy) - r; }
function sdRing(px, py, cx, cy, r, half) { return Math.abs(Math.hypot(px - cx, py - cy) - r) - half; }
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const t = clamp01((apx * abx + apy * aby) / (abx * abx + aby * aby));
  return Math.hypot(apx - abx * t, apy - aby * t);
}
function sdPolyline(px, py, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, sdSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}

// Paleta de la marca
const DEEP = [11, 32, 40];      // #0b2028
const INK = [16, 42, 51];       // #102a33
const MOSS = [139, 196, 173];   // #8bc4ad
const WHITE = [255, 253, 248];  // #fffdf8

function mix(base, over, a) {
  return [
    Math.round(base[0] + (over[0] - base[0]) * a),
    Math.round(base[1] + (over[1] - base[1]) * a),
    Math.round(base[2] + (over[2] - base[2]) * a),
  ];
}

function render(size, { fullBleed = false } = {}) {
  const s = size;
  const bg = fullBleed ? sdRoundRect(0, 0, 0, 0, 0, 0, 0) : null; // sin límite
  const corner = fullBleed ? 0 : 0.22 * s;
  const half = s / 2;
  const W = [
    [0.315, 0.66], [0.385, 0.375], [0.5, 0.545], [0.615, 0.375], [0.685, 0.66],
  ].map(([x, y]) => [x * s, y * s]);
  const wHalf = 0.038 * s;
  const ringR = 0.325 * s, ringHalf = 0.032 * s;
  const badgeR = 0.245 * s;
  const aa = 1.0; // ancho de antialias en píxeles

  const rgba = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let color = DEEP;
      let alpha = 1;
      // Forma del fondo (esquinas redondeadas salvo máscara)
      if (!fullBleed) {
        const d = sdRoundRect(x, y, half, half, half, half, corner);
        if (d > 0) { alpha = 0; } // fuera del icono
        else if (d > -aa) alpha = clamp01(0.5 - d); // borde suavizado
      }
      if (alpha > 0) {
        // Anillo verde
        const dr = sdRing(x, y, half, half, ringR, ringHalf);
        if (dr < aa) color = mix(color, MOSS, clamp01(0.5 - dr));
        // Insignia de tinta
        const db = sdCircle(x, y, half, half, badgeR);
        if (db < aa) color = mix(color, INK, clamp01(0.5 - db));
        // "W" blanca
        const dw = sdPolyline(x, y, W) - wHalf;
        if (dw < aa) color = mix(color, WHITE, clamp01(0.5 - dw));
      }
      const i = (y * s + x) * 4;
      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2];
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePNG(s, s, rgba);
}

const outDir = join(root, "icons");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon-192.png"), render(192));
writeFileSync(join(outDir, "icon-512.png"), render(512));
writeFileSync(join(outDir, "icon-maskable-512.png"), render(512, { fullBleed: true }));
writeFileSync(join(outDir, "apple-touch-icon.png"), render(180, { fullBleed: true }));
console.log("Iconos generados en", outDir);
