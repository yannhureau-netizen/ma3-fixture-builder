// Import depuis l'Open Fixture Library (OFL, open-fixture-library.org) : bibliothèque libre de fiches
// de projecteurs au format JSON. On lit le catalogue et les fiches sur GitHub (le site lui-même
// n'autorise pas la lecture depuis une autre page), puis on convertit la fiche en fiche de l'appli.
import { getAttribute, isKnownAttribute, registerAttributes, UNUSED } from './attributes.js';
import { uid, newFixture, newChannel } from './model.js';
import { toPngDataUrl } from './color.js';
import { fitGroups } from './layout.js';

const RAW = 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master';
const TREE = 'https://api.github.com/repos/OpenLightingProject/open-fixture-library/git/trees/master?recursive=1';
const JSDELIVR = 'https://data.jsdelivr.com/v1/packages/gh/OpenLightingProject/open-fixture-library@master?structure=flat';
const CACHE_KEY = 'ma3fb.ofl.catalog.v1';
const WEEK = 7 * 24 * 3600 * 1000;

// ---------- catalogue ----------
const UPPER = new Set(['led', 'rgb', 'rgbw', 'rgba', 'rgbwa', 'rgbaw', 'uv', 'dmx', 'cob', 'ip', 'fx', 'hd', 'ww', 'cw', 'ii', 'iii', 'iv', 'xl', 'xs', 'cmy', 'cto', 'qa', 'sr', 'hp', 'tw', 'ws']);
export function prettyKey(key) {
  return key.split('-').map(w => (UPPER.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}

// Liste de toutes les fiches : [{ man, key, manName, name }]
export async function loadCatalog(force = false) {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.time < WEEK && cached.items.length) return cached;
  let paths = [];
  try {
    const t = await getJson(TREE);
    paths = t.tree.map(x => x.path).filter(p => /^fixtures\/[^/]+\/[^/]+\.json$/.test(p));
  } catch {
    // limite de l'API GitHub atteinte (60 demandes par heure) : copie de jsDelivr, un peu moins à jour
    try {
      const j = await getJson(JSDELIVR);
      paths = j.files.map(f => f.name.replace(/^\//, '')).filter(p => /^fixtures\/[^/]+\/[^/]+\.json$/.test(p));
    } catch {
      if (cached && cached.items.length) return cached;
      throw new Error('catalogue injoignable (pas de connexion Internet ?)');
    }
  }
  let mans = {};
  try { mans = await getJson(`${RAW}/fixtures/manufacturers.json`); } catch { /* noms de dossiers à la place */ }
  const items = paths
    .map(p => p.split('/'))
    .filter(([, man]) => man !== 'manufacturers.json')
    .map(([, man, file]) => {
      const key = file.replace(/\.json$/, '');
      return { man, key, manName: (mans[man] && mans[man].name) || prettyKey(man), name: prettyKey(key) };
    })
    .sort((a, b) => a.manName.localeCompare(b.manName) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const out = { time: Date.now(), items, manufacturers: Object.fromEntries(Object.entries(mans).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.name])) };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(out)); } catch { /* stockage plein : pas de cache */ }
  return out;
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function searchCatalog(items, q, max = 60) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const res = [];
  for (const it of items) {
    const hay = norm(`${it.manName} ${it.man} ${it.name} ${it.key}`);
    if (words.every(w => hay.includes(w))) { res.push(it); if (res.length >= max) break; }
  }
  return res;
}

// Lien vers une fiche OFL (site ou GitHub) -> { man, key }
export function parseOflUrl(text) {
  const t = String(text || '').trim();
  let m = /open-fixture-library\.org\/([a-z0-9-]+)\/([a-z0-9-]+)/i.exec(t);
  if (m && m[1] !== 'manufacturers' && m[1] !== 'categories') return { man: m[1].toLowerCase(), key: m[2].toLowerCase() };
  m = /fixtures\/([a-z0-9-]+)\/([a-z0-9-]+)\.json/i.exec(t);
  if (m) return { man: m[1].toLowerCase(), key: m[2].toLowerCase() };
  m = /^([a-z0-9-]+)\/([a-z0-9-]+)$/i.exec(t);
  if (m) return { man: m[1].toLowerCase(), key: m[2].toLowerCase() };
  return null;
}

export async function fetchOflFixture(man, key, depth = 0) {
  const json = await getJson(`${RAW}/fixtures/${man}/${key}.json`);
  // fiche renommée ou déplacée : on suit le lien
  if (json.redirectTo && depth < 3) {
    const [m2, k2] = json.redirectTo.split('/');
    return fetchOflFixture(m2, k2, depth + 1);
  }
  return { json, man, key };
}

// ---------- outils de lecture des valeurs OFL ----------
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

function parseEntity(v, units) {
  if (v == null) return null;
  if (typeof v === 'number') return { n: v, unit: '' };
  const s = String(v).trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*([a-z%]*)\s*(.*)$/i.exec(s);
  if (m) return { n: Number(m[1]), unit: m[2].toLowerCase(), rest: m[3].toLowerCase() };
  return { word: s.toLowerCase(), units };
}

const pct = e => (e && e.unit === '%' ? e.n / 100 : null);

function brightness(v) {
  const e = parseEntity(v);
  if (!e) return null;
  if (e.word) return e.word === 'off' ? 0 : e.word === 'dark' ? 0.01 : e.word === 'bright' ? 1 : null;
  return pct(e) ?? (e.unit === 'lm' ? null : e.n);
}

// Vitesse de rotation signée, en °/s (sens horaire positif)
function rotSpeed(v) {
  const e = parseEntity(v);
  if (!e) return null;
  const sign = /ccw/.test(e.word || e.rest || '') ? -1 : 1;
  if (e.word) {
    if (/stop/.test(e.word)) return 0;
    if (/slow/.test(e.word)) return 10 * sign;
    if (/fast/.test(e.word)) return 180 * sign;
    return null;
  }
  if (e.unit === 'rpm') return e.n * 6 * sign;
  if (e.unit === 'hz') return e.n * 360 * sign;
  if (e.unit === '%') return e.n / 100 * 180 * sign;
  return null;
}

function hertz(v) {
  const e = parseEntity(v);
  if (!e) return null;
  if (e.word) return /stop/.test(e.word) ? 0 : /slow/.test(e.word) ? 1 : /fast/.test(e.word) ? 20 : null;
  if (e.unit === 'hz') return e.n;
  if (e.unit === 'bpm') return e.n / 60;
  if (e.unit === '%') return 1 + e.n / 100 * 24;
  return null;
}

function degrees(v) {
  const e = parseEntity(v);
  if (!e || e.word) return null;
  return e.unit === 'deg' || e.unit === '' ? e.n : null;
}

function kelvin(v) {
  const e = parseEntity(v);
  if (!e || e.word) return null;
  return e.unit === 'k' ? e.n : null;
}

// Plage physique : propriété xxxStart/xxxEnd ou xxx seule
function range(cap, prop, fn) {
  if (cap[prop] != null) { const v = fn(cap[prop]); return v == null ? null : [v, v]; }
  const a = cap[`${prop}Start`] != null ? fn(cap[`${prop}Start`]) : null;
  const b = cap[`${prop}End`] != null ? fn(cap[`${prop}End`]) : null;
  return a == null || b == null ? null : [a, b];
}

// ---------- attributs ----------
const COLOR_ATTR = {
  red: 'ColorAdd_R', green: 'ColorAdd_G', blue: 'ColorAdd_B', white: 'ColorAdd_W', 'warm white': 'ColorAdd_WW',
  'cold white': 'ColorAdd_CW', amber: 'ColorAdd_A', uv: 'ColorAdd_UV', lime: 'ColorAdd_L', indigo: 'ColorAdd_UV',
  cyan: 'ColorSub_C', magenta: 'ColorSub_M', yellow: 'ColorSub_Y',
};
const EXPLICIT = {
  ColorAdd_C: { label: 'Cyan (LED)', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
};
const WHEEL_ATTR_UNIT = { Pos: ['Angle', [0, 360]], PosRotate: ['AngularSpeed', [-360, 360]], SelectSpin: ['AngularSpeed', [-360, 360]] };

// Attribut GDTF standard absent de la bibliothèque de l'appli (Gobo3, Control4, AnimationWheel1…) :
// on le déclare dans la fiche, à partir de son équivalent n° 1 quand il existe
function ensureAttr(fx, name) {
  if (isKnownAttribute(name)) return name;
  let def = EXPLICIT[name] || null;
  const m = /^([A-Za-z]+?)(\d+)(.*)$/.exec(name);
  if (!def && m) {
    const baseName = `${m[1]}1${m[3]}`;
    if (isKnownAttribute(baseName)) {
      const b = getAttribute(baseName);
      def = { label: `${b.label.replace(/ 1\b/, '')} ${m[2]}`.replace(/\s+/g, ' '), feature: b.feature, group: b.group, unit: b.unit, phys: b.phys };
      if (b.group && /\d/.test(b.group)) def.group = b.group.replace(/\d+/, m[2]);
    } else if (m[1] === 'Gobo' && m[3] === 'SelectShake') {
      def = { label: `Gobo ${m[2]} – shake`, feature: 'Gobo.Gobo', unit: 'None', phys: [0, 1] };
    } else if (m[1] === 'AnimationWheel') {
      const [unit, phys] = WHEEL_ATTR_UNIT[m[3]] || ['None', [0, 1]];
      def = { label: `Roue d'animation ${m[2]}${m[3] ? ` – ${m[3]}` : ''}`, feature: 'Gobo.Gobo', unit, phys };
    }
  }
  if (!def) def = { label: name, feature: 'Control.Control', unit: 'None', phys: [0, 1] };
  fx.attrDefs = fx.attrDefs || {};
  fx.attrDefs[name] = { name, pretty: def.label, ...def };
  registerAttributes({ [name]: fx.attrDefs[name] });
  return name;
}

// Attribut suivant de la même famille (Control1 -> Control2, Gobo1 -> Gobo2…) pour éviter un doublon
function nextAttr(attr, k) {
  const m = /^([A-Za-z_]+?)(\d+)(.*)$/.exec(attr);
  if (m) return `${m[1]}${Number(m[2]) + k}${m[3]}`;
  return `Control${k}`;
}

// ---------- conversion ----------
const SHUTTER_NAMES = { Open: 'Ouvert', Closed: 'Fermé', Strobe: 'Strobe', Pulse: 'Pulse', RampUp: 'Rampe montante', RampDown: 'Rampe descendante', RampUpDown: 'Rampe montante et descendante', Lightning: 'Éclairs', Spikes: 'Pics', Burst: 'Rafale' };

export async function convertOfl(json, { man = '', key = '', manName = '' } = {}) {
  const notes = [];
  const fx = newFixture();
  fx.modes = [];
  fx.attrDefs = {};
  fx.manufacturer = manName || (man ? prettyKey(man) : '');
  fx.name = String(json.name || prettyKey(key) || 'Projecteur');
  fx.shortName = String(json.shortName || '').slice(0, 16);
  const authors = json.meta && Array.isArray(json.meta.authors) ? json.meta.authors.join(', ') : '';
  fx.description = `Importé d'Open Fixture Library${man && key ? ` (${man}/${key})` : ''}${authors ? `, fiche de ${authors}` : ''}. À vérifier avec la doc du fabricant.`;
  if (!fx.manufacturer) notes.push('Le fabricant n\'est pas indiqué dans ce fichier : renseigne-le à l\'étape 1.');

  const cats = (json.categories || []).map(c => String(c).toLowerCase());
  const phys = json.physical || {};
  const avail = json.availableChannels || {};
  const templ = json.templateChannels || {};

  // --- Caractéristiques physiques (OFL : largeur, hauteur, profondeur en mm)
  const dims = Array.isArray(phys.dimensions) ? phys.dimensions.map(Number) : null;
  const hasPanTilt = Object.values({ ...avail, ...templ }).some(ch => capsOf(ch).some(c => /^(Pan|Tilt)(Continuous)?$/.test(c.type)));
  const moving = cats.includes('moving head') || cats.includes('scanner') || hasPanTilt;
  fx.kind = moving ? 'moving' : 'fixed';
  if (dims && dims.length === 3) {
    if (moving) { fx.length = dims[0]; fx.width = dims[2]; fx.height = dims[1]; }
    else { fx.length = dims[0]; fx.width = dims[1]; fx.height = dims[2]; }
  }
  if (num(phys.weight)) fx.weight = num(phys.weight);
  if (num(phys.power)) fx.power = num(phys.power);
  const bulb = String((phys.bulb && phys.bulb.type) || '').toLowerCase();
  fx.lampType = /led/.test(bulb) || !bulb ? 'LED' : /halogen/.test(bulb) ? 'Halogen' : /tungsten|incandescent/.test(bulb) ? 'Tungsten' : 'Discharge';
  const lens = phys.lens && Array.isArray(phys.lens.degreesMinMax) ? phys.lens.degreesMinMax.map(Number) : null;
  if (lens) fx.beamAngle = Math.round(lens[0] === lens[1] ? lens[0] : (lens[0] + lens[1]) / 2);
  fx.beamType = cats.includes('blinder') || cats.includes('strobe') ? 'Glow'
    : cats.includes('color changer') && !cats.includes('moving head') ? 'Wash'
    : Object.keys(json.wheels || {}).some(n => /gobo/i.test(n)) ? 'Spot' : 'Wash';

  // --- Roues
  const wheelInfo = new Map();
  const counters = { color: 0, gobo: 0, prism: 0, other: 0 };
  const goboJobs = [];
  for (const [wname, w] of Object.entries(json.wheels || {})) {
    const slots = Array.isArray(w.slots) ? w.slots : [];
    const types = slots.map(s => s.type);
    const kindRaw = types.includes('Color') ? 'color' : types.includes('Gobo') ? 'gobo'
      : types.some(t => t === 'Prism') && types.every(t => t === 'Prism' || t === 'Open') ? 'prism' : 'other';
    const n = ++counters[kindRaw];
    const wheel = { id: uid(), name: wname.replace(/\./g, ' '), kind: kindRaw === 'prism' ? 'other' : kindRaw, slots: [] };
    slots.forEach((s, i) => {
      const slot = { id: uid(), name: slotName(s, i), color: '#ffffff', image: '' };
      if (s.type === 'Color' && Array.isArray(s.colors) && s.colors[0]) slot.color = String(s.colors[0]).slice(0, 7);
      if (s.type === 'Closed') slot.color = '#000000';
      if (s.type === 'Gobo' && typeof s.resource === 'string') goboJobs.push({ slot, res: s.resource });
      wheel.slots.push(slot);
    });
    fx.wheels.push(wheel);
    const attrs = kindRaw === 'color' ? { slot: `Color${n}`, spin: `Color${n}WheelSpin`, pos: null, rot: null }
      : kindRaw === 'gobo' ? { slot: `Gobo${n}`, spin: `Gobo${n}WheelSpin`, pos: `Gobo${n}Pos`, rot: `Gobo${n}PosRotate`, shake: `Gobo${n}SelectShake` }
      : kindRaw === 'prism' ? { slot: `Prism${n}`, spin: `Prism${n}PosRotate`, pos: `Prism${n}PosRotate`, rot: `Prism${n}PosRotate` }
      : { slot: `AnimationWheel${n}`, spin: `AnimationWheel${n}SelectSpin`, pos: `AnimationWheel${n}Pos`, rot: `AnimationWheel${n}PosRotate` };
    wheelInfo.set(wname, { wheel, ...attrs, slotsRaw: slots });
  }

  // Images des gobos (bibliothèque de gobos de l'OFL)
  let goboOk = 0;
  await Promise.all(goboJobs.map(async job => {
    const res = job.res.startsWith('gobos/') ? job.res : `gobos/${job.res}`;
    for (const ext of ['svg', 'png', 'jpg']) {
      try {
        const r = await fetch(`${RAW}/resources/${res}.${ext}`);
        if (!r.ok) continue;
        const blob = await r.blob();
        const typed = new Blob([blob], { type: ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg' });
        job.slot.image = await toPngDataUrl(typed);
        goboOk++;
        return;
      } catch { /* format suivant */ }
    }
  }));
  if (goboOk) notes.push(`${goboOk} image(s) de gobo reprise(s) de la bibliothèque de l'OFL.`);
  const goboNoImg = fx.wheels.filter(w => w.kind === 'gobo').reduce((n, w) => n + w.slots.filter((s, i) => !s.image && !/ouvert|open/i.test(s.name) && i > 0).length, 0);
  if (goboNoImg) notes.push(`${goboNoImg} gobo(s) sans image : ajoute-les à l'étape « Roues » (bouton « Image… »).`);

  // --- Matrice de pixels (barres LED, panneaux…)
  const matrix = json.matrix ? buildMatrix(json.matrix) : null;
  const partByKey = new Map();
  const partFor = key => {
    if (!matrix || key == null) return '';
    const group = matrix.groups[key];
    if (group && group.length === matrix.keys.length) return '';   // groupe « tous les pixels » = projecteur entier
    if (!partByKey.has(key)) {
      const isPixel = key in matrix.pos;
      const name = isPixel ? (/^\d+$/.test(key) ? `Pixel ${key}` : /^\(/.test(key) ? `Pixel ${key.replace(/[()\s]/g, '').replace(/,/g, '-')}` : key)
        : `Groupe ${key.replace(/\//g, ' sur ')}`;
      partByKey.set(key, { id: uid(), name: name.replace(/\./g, ' '), _key: key });
    }
    return partByKey.get(key).id;
  };

  // Nom de canal (dans un mode) -> définition
  const fineOf = new Map();     // alias fin -> { coarse, level }
  const switchOf = new Map();   // alias de canal commuté -> canal déclencheur
  const register = (name, def, pixelKey) => {
    (def.fineChannelAliases || []).forEach((a, i) => fineOf.set(a, { coarse: name, level: i + 1 }));
    for (const cap of capsOf(def)) {
      for (const alias of Object.keys(cap.switchChannels || {})) switchOf.set(alias, { trigger: name, pixelKey });
    }
  };
  for (const [name, def] of Object.entries(avail)) register(name, def, null);
  const resolvedTemplates = new Map();
  if (matrix) {
    const keys = [...matrix.keys, ...Object.keys(matrix.groups)];
    for (const [tname, tdef] of Object.entries(templ)) {
      for (const k of keys) {
        const name = tname.split('$pixelKey').join(k);
        const def = JSON.parse(JSON.stringify(tdef).split('$pixelKey').join(k.replace(/"/g, '\\"')));
        resolvedTemplates.set(name, { def, pixelKey: k });
        register(name, def, k);
      }
    }
  }
  const lookup = name => {
    if (avail[name]) return { def: avail[name], pixelKey: null };
    return resolvedTemplates.get(name) || null;
  };

  // --- Modes
  let fineSplit = 0, wide = 0, unknownCh = 0, noTrigger = 0, switched = 0;
  const modeNames = new Set();
  for (const mode of json.modes || []) {
    let mname = String(mode.name || mode.shortName || 'Mode');
    while (modeNames.has(mname)) mname += ' bis';
    modeNames.add(mname);
    const entries = [];
    for (const e of mode.channels || []) {
      if (e && typeof e === 'object' && e.insert === 'matrixChannels') {
        if (!matrix) continue;
        const keys = repeatKeys(matrix, e.repeatFor);
        const tpls = e.templateChannels || [];
        if (e.channelOrder === 'perChannel') for (const t of tpls) for (const k of keys) entries.push(t.split('$pixelKey').join(k));
        else for (const k of keys) for (const t of tpls) entries.push(t.split('$pixelKey').join(k));
      } else {
        entries.push(e);
      }
    }

    const channels = [];
    const bySource = new Map();   // nom OFL -> canal créé
    const pendingSwitch = [];
    for (const name of entries) {
      if (name == null) { channels.push(newChannel(UNUSED)); continue; }
      const fine = fineOf.get(name);
      if (fine) {
        const prev = channels[channels.length - 1];
        const prevSrc = prev && prev._src;
        if (fine.level === 1 && prevSrc === fine.coarse && !prev.fine) { prev.fine = true; continue; }
        if (fine.level > 1) wide++; else fineSplit++;
        const c = newChannel(UNUSED);
        channels.push(c);
        continue;
      }
      if (switchOf.has(name)) {
        const c = newChannel(UNUSED);
        c._src = name;
        channels.push(c);
        pendingSwitch.push(c);
        bySource.set(name, c);
        continue;
      }
      const found = lookup(name);
      if (!found) { unknownCh++; channels.push(newChannel(UNUSED)); continue; }
      const c = channelFrom(fx, found.def, name, wheelInfo);
      c.part = partFor(found.pixelKey);
      c._src = name;
      channels.push(c);
      bySource.set(name, c);
    }

    // Canaux commutés : leurs plages dépendent d'un autre canal du mode (plages conditionnelles)
    for (const c of pendingSwitch) {
      const sw = switchOf.get(c._src);
      const trigger = bySource.get(sw.trigger);
      const tdef = lookup(sw.trigger);
      const targets = [];   // { from, to, target }
      for (const cap of capsOf(tdef.def)) {
        const target = (cap.switchChannels || {})[c._src];
        const [a, b] = dmxRangeOf(cap, tdef.def);
        const last = targets[targets.length - 1];
        if (last && last.target === target && last.to + 1 >= a) last.to = b;
        else targets.push({ from: a, to: b, target });
      }
      const built = targets.map(t => {
        const td = lookup(t.target);
        return { ...t, ch: td ? channelFrom(fx, td.def, t.target, wheelInfo) : null };
      }).filter(t => t.ch);
      if (!built.length) continue;
      c.attribute = built[0].ch.attribute;
      c.fine = false;
      c.defaultValue = built[0].ch.defaultValue;
      c.part = partFor(sw.pixelKey);
      if (!trigger || built.length === 1) {
        if (built.length > 1) noTrigger++;
        c.functions = built[0].ch.functions;
      } else {
        c.functions = built.flatMap(t => t.ch.functions.map(fn => ({ ...fn, cond: { master: trigger.id, from: t.from, to: t.to } })));
        switched++;
      }
    }

    // Une même fonction deux fois sur le même élément : on passe à la suivante de la famille (Control1 -> Control2…)
    const used = new Set();
    for (const c of channels) {
      if (c.attribute === UNUSED) continue;
      const geo = /^(Pan|Tilt)/.test(c.attribute) ? '' : c.part || '';
      let attr = c.attribute;
      for (let k = 1; used.has(`${geo}|${attr}`) && k < 20; k++) attr = nextAttr(c.attribute, k);
      if (attr !== c.attribute) {
        ensureAttr(fx, attr);
        c.functions.forEach(fn => { if (fn.attribute === c.attribute) fn.attribute = attr; });
        c.attribute = attr;
      }
      used.add(`${geo}|${attr}`);
    }
    channels.forEach(c => { delete c._src; });
    fx.modes.push({ id: uid(), name: mname, channels });
  }
  if (!fx.modes.length) throw new Error('aucun mode DMX dans cette fiche');

  // Sous-éléments : pixels dans l'ordre de la matrice, puis groupes ; position d'après la grille
  if (partByKey.size) {
    const order = [...matrix.keysXYZ, ...Object.keys(matrix.groups)];
    const parts = [...partByKey.values()].sort((a, b) => order.indexOf(a._key) - order.indexOf(b._key));
    const L = Number(fx.length) > 0 ? Number(fx.length) : matrix.count[0] * 100;
    const W = Number(fx.width) > 0 ? Number(fx.width) : Math.max(100, matrix.count[1] * 100);
    const place = ([x, y]) => [
      Math.round((-L / 2 + (L / matrix.count[0]) * (x - 0.5)) * 10) / 10,
      Math.round((matrix.count[1] > 1 ? -W / 2 + (W / matrix.count[1]) * (y - 0.5) : 0) * 10) / 10,
    ];
    for (const p of parts) {
      const isPixel = p._key in matrix.pos;
      const members = isPixel ? [p._key] : (matrix.groups[p._key] || []);
      const pts = members.map(k => place(matrix.pos[k]));
      if (pts.length) {
        p.x = Math.round(pts.reduce((s, q) => s + q[0], 0) / pts.length * 10) / 10;
        p.y = Math.round(pts.reduce((s, q) => s + q[1], 0) / pts.length * 10) / 10;
      }
      // groupe dont les pixels existent aussi comme sous-éléments : il les recouvre sur le schéma
      if (!isPixel) {
        const ids = members.map(k => partByKey.get(k)).filter(Boolean).map(q => q.id);
        if (ids.length) { p.group = true; p.members = ids; }
      }
    }
    parts.forEach(p => { delete p._key; });
    fx.parts = parts;
    fitGroups(fx);
    notes.push(`${parts.length} sous-élément(s) créé(s) à partir de la matrice de pixels, déjà disposés : vois le schéma à l'étape 1.`);
  }

  if (switched) notes.push(`${switched} canal(aux) dont la fonction change selon un autre canal : repris en plages conditionnelles (variantes).`);
  if (noTrigger) notes.push(`${noTrigger} canal(aux) commuté(s) sans leur canal de commande dans le mode : seule la première fonction est gardée.`);
  if (fineSplit) notes.push(`${fineSplit} canal(aux) « fin » (16 bits) ne suivent pas directement leur canal principal : leur adresse est réservée (canal inutilisé) et le canal principal reste en 8 bits.`);
  if (wide) notes.push(`${wide} octet(s) de précision 24 bits réservés (canal inutilisé) : l'appli gère jusqu'à 16 bits.`);
  if (unknownCh) notes.push(`${unknownCh} canal(aux) introuvables dans la fiche ont été remplacés par des canaux inutilisés.`);
  if (Object.keys(fx.attrDefs).length) notes.push(`Fonctions GDTF ajoutées pour cette fiche : ${Object.keys(fx.attrDefs).join(', ')}.`);
  notes.push('Les fiches de l\'OFL sont écrites par des bénévoles : vérifie les plages avec le testeur et la doc du fabricant avant le spectacle.');
  if (!Object.keys(fx.attrDefs).length) delete fx.attrDefs;
  return { fixture: fx, notes };
}

function capsOf(def) {
  if (!def) return [];
  if (Array.isArray(def.capabilities)) return def.capabilities;
  if (def.capability) return [def.capability];
  return [];
}

function resolutionOf(def) {
  const r = String(def.dmxValueResolution || '');
  const m = /^(\d+)bit$/.exec(r);
  if (m) return Math.max(1, Number(m[1]) / 8);
  return 1 + (def.fineChannelAliases || []).length;
}

// Plage DMX d'une capacité, ramenée à l'échelle 0-255 de l'appli
function dmxRangeOf(cap, def) {
  const div = 256 ** (resolutionOf(def) - 1);
  if (!Array.isArray(cap.dmxRange)) return [0, 255];
  return [Math.floor(cap.dmxRange[0] / div), Math.floor(cap.dmxRange[1] / div)];
}

function slotName(s, i) {
  if (s.name) return String(s.name);
  switch (s.type) {
    case 'Open': return 'Ouvert';
    case 'Closed': return 'Fermé';
    case 'Color': return `Couleur ${i + 1}`;
    case 'Gobo': return typeof s.resource === 'string' ? prettyKey(s.resource.split('/').pop()) : `Gobo ${i + 1}`;
    case 'Prism': return s.facets ? `Prisme ${s.facets} faces` : 'Prisme';
    case 'Iris': return 'Iris';
    case 'Frost': return 'Frost';
    default: return `Fente ${i + 1}`;
  }
}

// Valeur par défaut d'un canal (nombre à la résolution du canal, ou pourcentage)
function defaultOf(def) {
  const v = def.defaultValue;
  if (v == null) return null;
  if (typeof v === 'string' && /%$/.test(v)) return Math.round(parseFloat(v) * 2.55);
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(255, Math.floor(n / 256 ** (resolutionOf(def) - 1)));
}

// Une capacité OFL -> attribut, nom et plage physique de la plage DMX
function mapCap(fx, cap, chName, wheelInfo) {
  const t = cap.type;
  const wheelRef = Array.isArray(cap.wheel) ? cap.wheel[0] : (cap.wheel || chName);
  const w = wheelInfo.get(wheelRef) || null;
  const out = { attr: 'Control1', name: cap.comment || '', phys: null, wheel: null };
  switch (t) {
    case 'NoFunction': out.attr = null; out.name = cap.comment || 'Sans effet'; break;
    case 'Intensity': out.attr = 'Dimmer'; out.phys = range(cap, 'brightness', brightness); break;
    case 'ColorIntensity': out.attr = COLOR_ATTR[String(cap.color || '').toLowerCase()] || 'ColorAdd_W'; out.phys = range(cap, 'brightness', brightness); break;
    case 'Pan': case 'Tilt': {
      out.attr = t;
      const a = range(cap, 'angle', degrees);
      if (a) { const span = Math.abs(a[1] - a[0]); out.phys = a[1] >= a[0] ? [-span / 2, span / 2] : [span / 2, -span / 2]; }
      break;
    }
    case 'PanContinuous': out.attr = 'PanRotate'; out.phys = range(cap, 'speed', rotSpeed); break;
    case 'TiltContinuous': out.attr = 'TiltRotate'; out.phys = range(cap, 'speed', rotSpeed); break;
    case 'PanTiltSpeed': out.attr = 'PositionMSpeed'; break;
    case 'ShutterStrobe': {
      const e = cap.shutterEffect;
      out.name = cap.comment || SHUTTER_NAMES[e] || e || '';
      if (e === 'Open') { out.attr = 'Shutter1'; out.phys = [1, 1]; }
      else if (e === 'Closed') { out.attr = 'Shutter1'; out.phys = [0, 0]; }
      else {
        out.attr = e === 'Strobe' ? (cap.randomTiming ? 'Shutter1StrobeRandom' : 'Shutter1Strobe') : 'Shutter1StrobePulse';
        out.phys = range(cap, 'speed', hertz);
      }
      break;
    }
    case 'StrobeSpeed': case 'StrobeDuration': out.attr = 'Shutter1Strobe'; out.phys = range(cap, 'speed', hertz); break;
    case 'ColorPreset': out.attr = 'ColorMacro1'; out.preset = true; break;
    case 'ColorTemperature': out.attr = 'CTC'; out.phys = range(cap, 'colorTemperature', kelvin); break;
    case 'WheelSlot':
      out.attr = w ? w.slot : 'Control1';
      out.wheel = w;
      out.slotNumber = num(cap.slotNumber) ?? (cap.slotNumberStart != null ? num(cap.slotNumberStart) : null);
      break;
    case 'WheelShake':
      out.attr = w ? (w.shake || w.slot) : 'Control1';
      out.wheel = w;
      out.name = cap.comment || 'Shake';
      out.slotNumber = num(cap.slotNumber);
      out.single = true;
      break;
    case 'WheelRotation': out.attr = w ? w.spin : 'Control1'; out.phys = range(cap, 'speed', rotSpeed); break;
    case 'WheelSlotRotation':
      if (cap.angle != null || cap.angleStart != null) { out.attr = w && w.pos ? w.pos : 'Gobo1Pos'; out.phys = range(cap, 'angle', degrees); }
      else { out.attr = w && w.rot ? w.rot : 'Gobo1PosRotate'; out.phys = range(cap, 'speed', rotSpeed); }
      break;
    case 'Prism': out.attr = 'Prism1'; out.name = cap.comment || (cap.speedStart || cap.speed ? 'Prisme tournant' : 'Prisme'); break;
    case 'PrismRotation': out.attr = 'Prism1PosRotate'; out.phys = range(cap, 'speed', rotSpeed); break;
    case 'BeamAngle': case 'Zoom': out.attr = 'Zoom'; out.phys = range(cap, 'angle', degrees); break;
    case 'Focus': out.attr = 'Focus1'; break;
    case 'Iris': case 'IrisEffect': out.attr = 'Iris'; out.name = cap.comment || (t === 'IrisEffect' ? 'Effet d\'iris' : ''); break;
    case 'Frost': case 'FrostEffect': out.attr = 'Frost1'; break;
    case 'Effect': out.attr = 'Effects1'; out.name = cap.comment || cap.effectName || cap.effectPreset || ''; break;
    case 'EffectSpeed': case 'EffectDuration': case 'Speed': out.attr = 'Effects1Rate'; break;
    case 'EffectParameter': out.attr = 'Effects1Adjust1'; break;
    case 'Maintenance': out.attr = /reset/i.test(cap.comment || '') ? 'FixtureGlobalReset' : /lamp/i.test(cap.comment || '') ? 'LampControl' : 'Control1'; break;
    case 'Fog': case 'FogOutput': case 'FogType': out.attr = 'Control1'; out.name = cap.comment || 'Fumée'; break;
    default: out.attr = 'Control1'; out.name = cap.comment || t || '';
  }
  if (out.attr) ensureAttr(fx, out.attr);
  return out;
}

// Définition OFL d'un canal -> canal de l'appli (plages, réglages, roues)
function channelFrom(fx, def, chName, wheelInfo) {
  const caps = capsOf(def);
  const mapped = caps.map(cap => ({ cap, m: mapCap(fx, cap, chName, wheelInfo), r: dmxRangeOf(cap, def) }));
  // Fonction principale du canal : celle qui couvre la plus grande partie de 0-255
  const width = new Map();
  for (const { m, r } of mapped) if (m.attr) width.set(m.attr, (width.get(m.attr) || 0) + r[1] - r[0] + 1);
  let main = [...width.entries()].sort((a, b) => b[1] - a[1])[0];
  main = main ? main[0] : 'Control1';
  // canal de roue : la sélection des fentes passe avant la rotation de la roue
  const slotCap = mapped.find(x => x.cap.type === 'WheelSlot' && x.m.attr);
  if (slotCap) main = slotCap.m.attr;
  ensureAttr(fx, main);

  const functions = [];
  let prev = null;
  for (const { cap, m, r } of mapped) {
    const attr = m.attr || main;
    const from = r[0];
    // plusieurs fentes de roue (ou préréglages de couleur) à la suite : une seule plage, un réglage par fente
    const groupable = (cap.type === 'WheelSlot' || cap.type === 'ColorPreset') && !m.single;
    if (groupable && prev && prev._type === cap.type && prev.attribute === attr && prev._wheel === m.wheel) {
      prev.sets.push(setFor(cap, m, from));
      continue;
    }
    if (functions.some(f => f.from === from)) continue;   // valeurs qui se chevauchent après arrondi
    const base = getAttribute(attr).phys;
    const p = m.phys && m.phys.every(Number.isFinite) ? m.phys : (m.attr ? base : [0, 0]);
    const fn = { id: uid(), name: m.name || '', attribute: attr, from, physFrom: p[0], physTo: p[1], wheel: m.wheel ? m.wheel.wheel.id : '', sets: [] };
    if (groupable || m.single) fn.sets.push(setFor(cap, m, from));
    fn._type = cap.type;
    fn._wheel = m.wheel;
    functions.push(fn);
    prev = fn;
  }
  if (!functions.length) functions.push({ id: uid(), name: '', attribute: main, from: 0, physFrom: getAttribute(main).phys[0], physTo: getAttribute(main).phys[1], wheel: '', sets: [] });
  functions.sort((a, b) => a.from - b.from);
  if (functions[0].from !== 0) functions[0].from = 0;
  for (const f of functions) {
    // un réglage unique qui couvre toute la plage : son nom suffit pour la plage
    if (f.sets.length === 1 && !f.name && f.sets[0].from === f.from && !f.sets[0].slot) { f.name = f.sets[0].name; f.sets = []; }
    delete f._type;
    delete f._wheel;
  }
  let dv = defaultOf(def);
  if (dv == null) dv = main === 'Pan' || main === 'Tilt' ? 128 : 0;
  return { id: uid(), attribute: main, part: '', fine: false, defaultValue: dv, functions };
}

function setFor(cap, m, from) {
  if (cap.type === 'ColorPreset') {
    const name = cap.comment || (Array.isArray(cap.colors) ? cap.colors.join(' + ') : '') || 'Couleur';
    return { id: uid(), name, from, slot: 0 };
  }
  const w = m.wheel;
  const n = m.slotNumber;
  let name = cap.comment || '';
  let slot = 0;
  if (w && n != null) {
    const nameOf = k => (w.wheel.slots[k - 1] ? w.wheel.slots[k - 1].name : `Fente ${k}`);
    if (Number.isInteger(n)) { slot = n; if (!name) name = nameOf(n); }
    else if (!name) name = `${nameOf(Math.floor(n))} / ${nameOf(Math.ceil(n))}`;
    if (cap.type === 'WheelShake' && !cap.comment) name = `Shake ${nameOf(Math.round(n))}`;
  }
  if (slot > (w ? w.wheel.slots.length : 0)) slot = 0;
  return { id: uid(), name: name || 'Réglage', from, slot };
}

// ---------- matrice de pixels ----------
function buildMatrix(mx) {
  let structure;
  let count;
  if (Array.isArray(mx.pixelKeys)) {
    structure = mx.pixelKeys;
    count = [Math.max(...structure.flatMap(zl => zl.map(yl => yl.length))), Math.max(...structure.map(zl => zl.length)), structure.length];
  } else {
    count = (mx.pixelCount || [1, 1, 1]).map(Number);
    const axes = ['X', 'Y', 'Z'].filter((a, i) => count[i] > 1);
    const keyOf = (x, y, z) => {
      if (axes.length <= 1) return String(Math.max(x, y, z));
      if (axes.length === 2) {
        const first = axes.includes('X') ? x : y;
        const last = axes.includes('Y') ? y : z;
        return `(${first}, ${last})`;
      }
      return `(${x}, ${y}, ${z})`;
    };
    structure = [];
    for (let z = 1; z <= count[2]; z++) {
      const yl = [];
      for (let y = 1; y <= count[1]; y++) {
        const xl = [];
        for (let x = 1; x <= count[0]; x++) xl.push(keyOf(x, y, z));
        yl.push(xl);
      }
      structure.push(yl);
    }
  }
  const pos = {};
  structure.forEach((yl, z) => yl.forEach((xl, y) => xl.forEach((k, x) => { if (k !== null) pos[k] = [x + 1, y + 1, z + 1]; })));
  const keys = Object.keys(pos).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const byOrder = (A, B, C) => {
    const ix = { X: 0, Y: 1, Z: 2 };
    return [...keys].sort((ka, kb) => {
      const pa = pos[ka], pb = pos[kb];
      if (pa[ix[C]] !== pb[ix[C]]) return pa[ix[C]] - pb[ix[C]];
      if (pa[ix[B]] !== pb[ix[B]]) return pa[ix[B]] - pb[ix[B]];
      return pa[ix[A]] - pb[ix[A]];
    });
  };
  const keysXYZ = byOrder('X', 'Y', 'Z');
  const groups = {};
  for (const [g, def] of Object.entries(mx.pixelGroups || {})) {
    if (def === 'all') groups[g] = [...keys];
    else if (Array.isArray(def)) groups[g] = def.filter(k => k in pos);
    else if (def && typeof def === 'object') {
      const tests = {};
      for (const ax of ['x', 'y', 'z']) tests[ax] = (def[ax] || []).map(numConstraint);
      const names = (def.name || []).map(p => new RegExp(p));
      const base = def.name ? keys : keysXYZ;
      groups[g] = base.filter(k => ['x', 'y', 'z'].every((ax, i) => tests[ax].every(fn => fn(pos[k][i]))) && names.every(re => re.test(k)));
    }
  }
  return { count, pos, keys, keysXYZ, groups, byOrder };
}

function numConstraint(c) {
  c = String(c);
  if (c.startsWith('=')) { const n = parseInt(c.slice(1), 10); return p => p === n; }
  if (c.startsWith('>=')) { const n = parseInt(c.slice(2), 10); return p => p >= n; }
  if (c.startsWith('<=')) { const n = parseInt(c.slice(2), 10); return p => p <= n; }
  c = c.replace(/^even$/, '2n').replace(/^odd$/, '2n+1');
  const m = /^(\d+)n(?:\+(\d+))?$/.exec(c);
  if (m) { const d = Number(m[1]), r = Number(m[2] || 0); return p => p % d === r; }
  return () => true;
}

function repeatKeys(matrix, repeatFor) {
  if (Array.isArray(repeatFor)) return repeatFor;
  if (repeatFor === 'eachPixelGroup') return Object.keys(matrix.groups);
  if (repeatFor === 'eachPixelABC') return matrix.keys;
  const m = /^eachPixel([XYZ])([XYZ])([XYZ])$/.exec(repeatFor || '');
  if (m) return matrix.byOrder(m[1], m[2], m[3]);
  return matrix.keysXYZ;
}
