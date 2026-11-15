// Couleurs : conversion entre le format de l'appli (#rrggbb) et celui de GDTF (CIE 1931 « x,y,Y »).
// Images : conversion de n'importe quelle image en PNG réduit (format exigé par GDTF pour les gobos).

const WHITE = { x: 0.3127, y: 0.329 };
const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function isHex(s) {
  return /^#[0-9a-f]{6}$/i.test(s || '');
}

export function hexToXyY(hex) {
  const n = isHex(hex) ? parseInt(hex.slice(1), 16) : 0xffffff;
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const s = X + Y + Z;
  if (s <= 0) return { x: WHITE.x, y: WHITE.y, Y: 0 };
  return { x: X / s, y: Y / s, Y: Y * 100 };
}

// Format GDTF : "x,y,Y" (Y en %)
export function hexToGdtfColor(hex) {
  const c = hexToXyY(hex);
  return `${c.x.toFixed(6)},${c.y.toFixed(6)},${c.Y.toFixed(6)}`;
}

export function gdtfColorToHex(str) {
  const p = String(str || '').replace(/[{}\s]/g, '').split(',').map(Number);
  if (p.length < 2 || !p.every(Number.isFinite) || p[1] <= 0) return '#ffffff';
  const [x, y] = p;
  const Yv = p.length > 2 ? p[2] / 100 : 1;
  if (Yv <= 0.001) return '#000000';
  const X = (x / y) * Yv;
  const Z = ((1 - x - y) / y) * Yv;
  let rgb = [
    3.2406 * X - 1.5372 * Yv - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Yv + 0.0415 * Z,
    0.0557 * X - 0.204 * Yv + 1.057 * Z,
  ].map(v => Math.max(0, v));
  const max = Math.max(...rgb);
  if (max > 1) rgb = rgb.map(v => v / max);
  return '#' + rgb.map(v => Math.round(toGamma(v) * 255).toString(16).padStart(2, '0')).join('');
}

// Image (Blob/File) -> data URL PNG, côté le plus long réduit à 256 px
export async function toPngDataUrl(blob, maxSize = 256) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || maxSize;
    const h = img.naturalHeight || maxSize;
    const s = Math.min(1, maxSize / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function dataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
