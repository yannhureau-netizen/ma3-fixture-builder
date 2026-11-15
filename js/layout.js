// Disposition des sous-éléments (pixels) : position X/Y de chaque élément, en mm, par rapport au
// centre du projecteur. X suit la longueur, Y la largeur. Sert à l'export (vue 3D de grandMA3),
// au schéma de l'étape 1 et à l'aperçu du testeur.

export const SHAPES = [
  ['line', 'En ligne'],
  ['grid', 'En grille'],
  ['ring', 'En cercle'],
];

export const ORDERS = [
  ['normal', 'Ligne par ligne'],
  ['snake', 'En serpentin'],
];

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Dimensions utilisées pour disposer : celles du projecteur, sinon une taille plausible
export function boxSize(fx, count = (fx.parts || []).length) {
  const L = num(fx.length) > 0 ? num(fx.length) : Math.max(100, count * 100);
  const W = num(fx.width) > 0 ? num(fx.width) : 100;
  return { L, W };
}

export function hasLayout(fx) {
  return (fx.parts || []).some(p => num(p.x) !== 0 || num(p.y) !== 0);
}

// Groupe de pixels (sous-élément qui pilote plusieurs pixels à la fois, ex. « moitié gauche ») :
// p.group = true et p.members = ids des pixels. Il n'est pas disposé lui-même : il recouvre ses pixels.
export const isGroup = (fx, p) => !!(p.group && Array.isArray(p.members) && p.members.some(id => (fx.parts || []).some(q => q.id === id)));

// Calcule la position de chaque sous-élément, dans l'ordre de la liste
export function arrangeParts(fx, { shape = 'line', cols = 4, order = 'normal', reverse = false } = {}) {
  const parts = (fx.parts || []).filter(p => !isGroup(fx, p));
  const n = parts.length;
  if (!n) return;
  const { L, W } = boxSize(fx, n);
  const r1 = v => Math.round(v * 10) / 10;
  if (shape === 'ring') {
    const R = Math.min(L, W) / 2 * 0.8;
    parts.forEach((p, i) => {
      // départ en haut, sens des aiguilles d'une montre
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      p.x = r1(R * Math.cos(a));
      p.y = r1(R * Math.sin(a));
    });
  } else {
    const c = shape === 'grid' ? Math.max(1, Math.min(n, Math.round(cols) || 1)) : n;
    const rows = Math.ceil(n / c);
    const pitchX = L / c;
    const pitchY = W / rows;
    parts.forEach((p, i) => {
      const row = Math.floor(i / c);
      let col = i % c;
      if (order === 'snake' && row % 2 === 1) col = c - 1 - col;
      if (reverse) col = c - 1 - col;
      p.x = r1(-L / 2 + pitchX * (col + 0.5));
      p.y = r1(rows === 1 ? 0 : -W / 2 + pitchY * (row + 0.5));
    });
  }
  fitGroups(fx);
}

// Place chaque groupe au centre de ses pixels, avec une étendue qui les recouvre
export function fitGroups(fx) {
  const parts = fx.parts || [];
  const cs = cellSize(fx);
  const r1 = v => Math.round(v * 10) / 10;
  for (const g of parts) {
    if (!isGroup(fx, g)) { if (g.group) { delete g.w; delete g.h; } continue; }
    const m = parts.filter(p => g.members.includes(p.id));
    const xs = m.map(p => num(p.x)), ys = m.map(p => num(p.y));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    g.x = r1((x0 + x1) / 2);
    g.y = r1((y0 + y1) / 2);
    g.w = r1(x1 - x0 + cs * 1.1);
    g.h = r1(y1 - y0 + cs * 1.1);
  }
}

export function clearLayout(fx) {
  (fx.parts || []).forEach(p => { delete p.x; delete p.y; delete p.w; delete p.h; });
}

// Taille d'une cellule (mm) : distance au voisin le plus proche, pour le modèle 3D des pixels
export function cellSize(fx) {
  // les groupes de pixels (qui recouvrent plusieurs pixels) ne comptent pas pour la taille d'une cellule
  const all = fx.parts || [];
  const cells = all.some(p => !isGroup(fx, p)) ? all.filter(p => !isGroup(fx, p)) : all;
  const pts = cells.map(p => [num(p.x), num(p.y)]);
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > 0.5 && d < best) best = d;
    }
  }
  return Number.isFinite(best) ? best * 0.9 : 100;
}

// Schéma vu de face : rectangle du projecteur et pastilles des sous-éléments.
// dots : tableau { fill, cls, style, hide } dans le même ordre que fx.parts (facultatif).
// Les groupes de pixels (p.group, avec leur étendue p.w × p.h) sont dessinés derrière les pixels.
export function layoutSvg(fx, { dots = null, numbers = true } = {}) {
  const parts = fx.parts || [];
  const { L, W } = boxSize(fx);
  const pad = Math.max(L, W) * 0.06;
  const cs = Math.min(cellSize(fx), Math.max(L, W) / 3);
  const vb = `${-L / 2 - pad} ${-W / 2 - pad} ${L + 2 * pad} ${W + 2 * pad}`;
  const font = Math.max(cs * 0.45, Math.max(L, W) * 0.02);
  const draw = (p, i) => {
    const d = dots ? dots[i] : null;
    if (d && d.hide) return '';
    const x = num(p.x), y = num(p.y);
    const cls = d && d.cls ? ` class="${d.cls}"` : '';
    const style = d && d.style ? ` style="${d.style}"` : '';
    const label = `<title>${escXml(p.name || `Élément ${i + 1}`)}</title>`;
    if (isGroup(fx, p)) {
      const w = num(p.w) > 0 ? num(p.w) : cs;
      const h = num(p.h) > 0 ? num(p.h) : cs;
      const fill = d && d.fill ? d.fill : 'none';
      return `<g>${label}<rect${cls}${style} x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${cs * 0.18}" fill="${fill}" stroke="var(--accent, #f5a524)" stroke-dasharray="${cs * 0.15} ${cs * 0.1}" stroke-width="${cs * 0.05}"/></g>`;
    }
    const fill = d && d.fill ? d.fill : 'var(--accent, #f5a524)';
    return `<g>${label}`
      + `<rect${cls}${style} x="${x - cs / 2}" y="${y - cs / 2}" width="${cs}" height="${cs}" rx="${cs * 0.18}" fill="${fill}" stroke="rgba(127,127,127,.6)" stroke-width="${cs * 0.04}"/>`
      + (numbers ? `<text x="${x}" y="${y + font * 0.35}" font-size="${font}" text-anchor="middle" fill="#fff" style="paint-order:stroke;stroke:rgba(0,0,0,.55);stroke-width:${font * 0.15}px">${i + 1}</text>` : '')
      + '</g>';
  };
  const groups = parts.map((p, i) => (isGroup(fx, p) ? draw(p, i) : '')).join('');
  const cells = parts.map((p, i) => (isGroup(fx, p) ? '' : draw(p, i))).join('');
  return `<svg class="layout-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Disposition des sous-éléments">`
    + `<rect x="${-L / 2}" y="${-W / 2}" width="${L}" height="${W}" rx="${Math.min(L, W) * 0.06}" fill="rgba(127,127,127,.12)" stroke="rgba(127,127,127,.55)" stroke-width="${Math.max(L, W) * 0.004}"/>`
    + groups + cells + '</svg>';
}

function escXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
