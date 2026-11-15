// Testeur DMX : pour des valeurs de canaux données, trouve la plage active, le réglage, la valeur physique,
// et calcule un aperçu (couleur, intensité, shutter/strobe, gobo, Pan/Tilt).
import { getAttribute, attributeLabel, UNUSED } from './attributes.js';
import { functionGroups, functionEnd } from './model.js';
import { isHex } from './color.js';

// Plage active d'un canal pour la valeur v. valueOf(id) donne la valeur actuelle d'un autre canal.
export function evaluate(c, v, valueOf) {
  const groups = functionGroups(c);
  let chosen = null;
  for (const list of groups.values()) {
    const cond = list[0].cond;
    if (!cond || !cond.master) continue;
    const mv = valueOf(cond.master);
    if (mv != null && mv >= cond.from && mv <= cond.to) { chosen = list; break; }
  }
  if (!chosen) chosen = groups.get('') || [...groups.values()][0] || [];
  if (!chosen.length) return null;
  let fn = chosen[0];
  for (const f of chosen) if (f.from <= v) fn = f;
  const end = functionEnd(c, fn);
  let set = null;
  for (const s of [...fn.sets].sort((a, b) => a.from - b.from)) if (s.from <= v && s.from <= end) set = s;
  const span = end - fn.from;
  const t = span > 0 ? (v - fn.from) / span : 0;
  const phys = Number(fn.physFrom) + (Number(fn.physTo) - Number(fn.physFrom)) * t;
  return { fn, set, phys, end, conditional: !!fn.cond };
}

const round = (x, d = 0) => {
  const p = 10 ** d;
  return (Math.round(x * p) / p).toLocaleString('fr-FR');
};

// Valeur physique lisible selon l'unité de la fonction
export function formatPhys(attrName, phys, fn) {
  const unit = getAttribute(attrName).unit;
  const constant = Number(fn.physFrom) === Number(fn.physTo);
  switch (unit) {
    case 'Angle': return `${round(phys, 1)}°`;
    case 'AngularSpeed': return constant && phys === 0 ? 'arrêt' : `${round(phys, 1)} °/s`;
    case 'Frequency': return `${round(phys, 1)} Hz`;
    case 'Temperature': return phys > 0 ? `${round(phys)} K` : '';
    case 'Percent': return `${round(phys)} %`;
    case 'ColorComponent':
    case 'LuminousIntensity': return `${round(phys * 100)} %`;
    default:
      if (constant) return '';
      if (Math.min(fn.physFrom, fn.physTo) >= 0 && Math.max(fn.physFrom, fn.physTo) <= 1) return `${round(phys * 100)} %`;
      return round(phys, 2);
  }
}

// Texte affiché à côté du fader
export function describe(c, ev, fx) {
  if (!ev) return '';
  const parts = [ev.fn.name || attributeLabel(ev.fn.attribute)];
  if (ev.set && ev.set.name) parts.push(ev.set.name);
  // sur une roue, la fente suffit : la valeur physique n'apporte rien
  const p = ev.fn.wheel && ev.set && ev.set.slot > 0 ? '' : formatPhys(ev.fn.attribute, ev.phys, ev.fn);
  if (p) parts.push(p);
  let txt = parts.join(' · ');
  if (ev.conditional) {
    const m = fx && fx.modes.flatMap(x => x.channels).find(x => x.id === ev.fn.cond.master);
    txt += ` (variante selon ${m ? attributeLabel(m.attribute) : 'un autre canal'})`;
  }
  return txt;
}

const ADD = {
  ColorAdd_R: [1, 0, 0], ColorAdd_G: [0, 1, 0], ColorAdd_B: [0, 0, 1], ColorAdd_W: [1, 1, 1],
  ColorAdd_WW: [1, 0.78, 0.55], ColorAdd_CW: [0.8, 0.88, 1], ColorAdd_A: [1, 0.75, 0],
  ColorAdd_UV: [0.35, 0, 0.9], ColorAdd_L: [0.7, 1, 0], ColorAdd_C: [0, 1, 1],
};
const SUB = { ColorSub_C: 0, ColorSub_M: 1, ColorSub_Y: 2 };

function hexToRgb(hex) {
  const n = isHex(hex) ? parseInt(hex.slice(1), 16) : 0xffffff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const clamp01 = x => Math.max(0, Math.min(1, x));

// Aperçu du mode : état du projecteur principal et de chaque sous-élément
export function preview(fx, mode, valueOf) {
  const zones = new Map(); // '' = principal, sinon id de sous-élément
  const zone = k => {
    if (!zones.has(k)) zones.set(k, { add: null, sub: null, dim: null, closed: false, strobe: 0, wheelColor: null, gobo: null });
    return zones.get(k);
  };
  zone('');
  let pan = null;
  let tilt = null;
  for (const c of mode.channels) {
    if (c.attribute === UNUSED) continue;
    const v = valueOf(c.id);
    const ev = evaluate(c, v, valueOf);
    if (!ev) continue;
    const a = ev.fn.attribute;
    const z = zone(c.part || '');
    const level = clamp01(ev.phys);
    if (ADD[a]) {
      z.add = z.add || [0, 0, 0];
      ADD[a].forEach((k, i) => { z.add[i] += k * level; });
    } else if (a in SUB) {
      z.sub = z.sub || [0, 0, 0];
      z.sub[SUB[a]] = level;
    } else if (a === 'Dimmer') {
      z.dim = level;
    } else if (a === 'Shutter1') {
      z.closed = Number(ev.phys) < 0.5;   // 0 = fermé, 1 = ouvert (certaines plages passent de l'un à l'autre)
    } else if (/^Shutter1Strobe/.test(a)) {
      z.strobe = Math.max(0.5, Number(ev.phys) || 1);
    } else if (a === 'Pan') {
      pan = ev.phys;
    } else if (a === 'Tilt') {
      tilt = ev.phys;
    }
    // Roues : la fente visée par le réglage actif
    if (ev.fn.wheel && ev.set && ev.set.slot > 0) {
      const w = (fx.wheels || []).find(x => x.id === ev.fn.wheel);
      const slot = w && w.slots[ev.set.slot - 1];
      if (slot) {
        if (w.kind === 'gobo') { if (slot.image) z.gobo = slot.image; }
        else if (w.kind === 'color') z.wheelColor = hexToRgb(slot.color);
      }
    }
  }

  const main = zones.get('');
  const result = [];
  for (const [k, z] of zones) {
    let rgb = z.add ? z.add.map(clamp01) : [1, 1, 1];
    if (z.sub) rgb = rgb.map((x, i) => x * (1 - z.sub[i]));
    if (z.wheelColor) rgb = rgb.map((x, i) => x * z.wheelColor[i]);
    // un sous-élément sans intensité propre suit celle du principal
    let level = z.dim != null ? z.dim : (k && main.dim != null ? main.dim : 1);
    if (k && main.dim != null && z.dim != null) level *= main.dim;
    const closed = z.closed || (k && main.closed);
    if (closed) level = 0;
    const part = k ? (fx.parts || []).find(p => p.id === k) : null;
    result.push({
      key: k,
      name: part ? part.name : 'Principal',
      rgb, level,
      css: `rgb(${rgb.map(x => Math.round(x * level * 255)).join(',')})`,
      strobe: closed ? 0 : (z.strobe || (k ? main.strobe : 0)),
      gobo: z.gobo,
      closed,
    });
  }
  return { zones: result, pan, tilt };
}
