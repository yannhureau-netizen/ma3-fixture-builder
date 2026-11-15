// Modèle de données de l'appli + modèles de canaux prêts à l'emploi + vérifications.
import { getAttribute, geometryFor, attributeLabel, channelGeometry, partGeometryName, RESERVED_GEOMETRIES, UNUSED, registerAttributes } from './attributes.js';
import { makeUuid } from './gdtf.js';

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newFixture() {
  return {
    id: uid(),
    uuid: makeUuid(),      // identifiant GDTF, stable d'un export à l'autre
    manufacturer: '',
    name: '',
    shortName: '',
    description: '',
    kind: 'moving',        // 'moving' = lyre, 'fixed' = projecteur fixe
    lampType: 'LED',
    power: 100,            // W
    beamAngle: 25,         // degrés
    beamType: 'Spot',
    revision: 1,
    thumbnail: '',         // photo (data URL PNG), affichée dans le Patch de MA3
    length: 0,             // dimensions en mm (0 = valeur par défaut)
    width: 0,
    height: 0,
    weight: 0,             // kg
    parts: [],             // sous-éléments : [{ id, name }] (pixels, calque d'effet…)
    wheels: [],            // roues : [{ id, name, kind: 'color'|'gobo'|'other', slots: [{ id, name, color, image }] }]
    modes: [{ id: uid(), name: 'Mode 1', channels: [] }],
    updatedAt: Date.now(),
  };
}

// Une plage DMX d'un canal (ChannelFunction en GDTF)
export function newFunction(attribute, from = 0, name = '', phys) {
  const a = getAttribute(attribute);
  const p = phys || a.phys;
  // wheel : id de la roue liée à cette plage ; chaque réglage (set) peut viser une fente (slot, 1 = première)
  return { id: uid(), name, attribute, from, physFrom: p[0], physTo: p[1], wheel: '', sets: [] };
}

const COLOR_PRESET = [
  ['Blanc', '#ffffff'], ['Rouge', '#ff0000'], ['Orange', '#ff8000'], ['Jaune', '#ffff00'],
  ['Vert', '#00ff00'], ['Cyan', '#00ffff'], ['Bleu', '#0000ff'], ['Magenta', '#ff00ff'],
];

export function newSlot(name = '', color = '#ffffff') {
  return { id: uid(), name, color, image: '' };
}

export function newWheel(kind, fx) {
  const n = fx.wheels.filter(w => w.kind === kind).length + 1;
  if (kind === 'color') {
    return { id: uid(), name: `Couleurs ${n}`, kind, slots: COLOR_PRESET.map(([name, c]) => newSlot(name, c)) };
  }
  if (kind === 'gobo') {
    return { id: uid(), name: `Gobos ${n}`, kind, slots: ['Ouvert', 'Gobo 1', 'Gobo 2', 'Gobo 3', 'Gobo 4', 'Gobo 5', 'Gobo 6'].map(s => newSlot(s)) };
  }
  return { id: uid(), name: `Roue ${fx.wheels.length + 1}`, kind: 'other', slots: [newSlot('Ouvert'), newSlot('Effet 1')] };
}

export function newChannel(attribute, { fine = false, def = 0, functions, part = '' } = {}) {
  return {
    id: uid(),
    attribute,
    part,                  // '' = projecteur principal, sinon id d'un sous-élément
    fine,
    defaultValue: def,
    functions: functions || [newFunction(attribute)],
  };
}

function withSets(fn, sets) {
  fn.sets = sets.map(([name, from]) => ({ id: uid(), name, from, slot: 0 }));
  return fn;
}

// Boutons « + … » : chaque modèle ajoute un ou plusieurs canaux.
export const TEMPLATES = [
  { key: 'dim', label: 'Intensité', make: () => [newChannel('Dimmer')] },
  { key: 'dim16', label: 'Intensité 16 bits', make: () => [newChannel('Dimmer', { fine: true })] },
  { key: 'pt16', label: 'Pan / Tilt 16 bits', make: () => [newChannel('Pan', { fine: true, def: 128 }), newChannel('Tilt', { fine: true, def: 128 })] },
  { key: 'pt8', label: 'Pan / Tilt 8 bits', make: () => [newChannel('Pan', { def: 128 }), newChannel('Tilt', { def: 128 })] },
  { key: 'rgb', label: 'RGB', make: () => ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B'].map(a => newChannel(a)) },
  { key: 'rgbw', label: 'RGBW', make: () => ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B', 'ColorAdd_W'].map(a => newChannel(a)) },
  { key: 'rgbwauv', label: 'RGBWA + UV', make: () => ['ColorAdd_R', 'ColorAdd_G', 'ColorAdd_B', 'ColorAdd_W', 'ColorAdd_A', 'ColorAdd_UV'].map(a => newChannel(a)) },
  { key: 'cmy', label: 'CMY', make: () => ['ColorSub_C', 'ColorSub_M', 'ColorSub_Y'].map(a => newChannel(a)) },
  {
    key: 'shutter', label: 'Shutter / Strobe',
    make: () => [newChannel('Shutter1', {
      def: 8,
      functions: [
        newFunction('Shutter1', 0, 'Fermé', [0, 0]),
        newFunction('Shutter1', 8, 'Ouvert', [1, 1]),
        newFunction('Shutter1Strobe', 16, 'Strobe', [1, 25]),
        newFunction('Shutter1', 250, 'Ouvert 2', [1, 1]),
      ],
    })],
  },
  {
    key: 'strobe', label: 'Strobe seul',
    make: () => [newChannel('Shutter1', {
      functions: [
        newFunction('Shutter1', 0, 'Pas de strobe', [1, 1]),
        newFunction('Shutter1Strobe', 10, 'Strobe', [1, 25]),
      ],
    })],
  },
  { key: 'color1', label: 'Roue de couleurs', make: () => [newChannel('Color1', { functions: [withSets(newFunction('Color1', 0, 'Couleurs'), [['Blanc', 0]])] })] },
  { key: 'gobo1', label: 'Roue de gobos', make: () => [newChannel('Gobo1', { functions: [withSets(newFunction('Gobo1', 0, 'Gobos'), [['Ouvert', 0]])] })] },
  { key: 'gobo1rot', label: 'Rotation gobo', make: () => [newChannel('Gobo1PosRotate', { def: 128 })] },
  { key: 'prism', label: 'Prisme', make: () => [newChannel('Prism1', { functions: [withSets(newFunction('Prism1', 0, 'Prisme'), [['Sans prisme', 0], ['Prisme', 128]])] })] },
  { key: 'zoom', label: 'Zoom', make: () => [newChannel('Zoom')] },
  { key: 'focus', label: 'Focus', make: () => [newChannel('Focus1')] },
  { key: 'iris', label: 'Iris', make: () => [newChannel('Iris')] },
  { key: 'frost', label: 'Frost', make: () => [newChannel('Frost1')] },
  { key: 'cto', label: 'CTO', make: () => [newChannel('CTO')] },
  { key: 'speed', label: 'Vitesse moteurs', make: () => [newChannel('PositionMSpeed')] },
  { key: 'ctrl', label: 'Contrôle / Reset', make: () => [newChannel('Control1', { functions: [withSets(newFunction('Control1', 0, 'Contrôle'), [['Rien', 0], ['Reset', 200]])] })] },
  { key: 'unused', label: 'Canal inutilisé', make: () => [newChannel(UNUSED)] },
  { key: 'other', label: 'Autre canal…', make: () => [newChannel('Control1')] },
];

// Modèles proposés pour créer des cellules identiques (barre LED à pixels…)
export const CELL_TEMPLATES = [
  { key: 'rgb', label: 'RGB', keys: ['rgb'] },
  { key: 'rgbw', label: 'RGBW', keys: ['rgbw'] },
  { key: 'rgbwauv', label: 'RGBWA + UV', keys: ['rgbwauv'] },
  { key: 'dimrgb', label: 'Intensité + RGB', keys: ['dim', 'rgb'] },
  { key: 'dimrgbw', label: 'Intensité + RGBW', keys: ['dim', 'rgbw'] },
  { key: 'dim', label: 'Intensité seule', keys: ['dim'] },
];

export function makeCellChannels(cellKey, partId) {
  const ct = CELL_TEMPLATES.find(x => x.key === cellKey);
  return ct.keys.flatMap(k => TEMPLATES.find(t => t.key === k).make()).map(c => ({ ...c, part: partId }));
}

// Relie les canaux « Roue de couleurs / gobos n » à la n-ième roue du bon type, si elle existe
export function linkWheels(fx, channels) {
  channels.forEach(c => c.functions.forEach(fn => {
    const m = /^(Color|Gobo)([12])$/.exec(fn.attribute);
    if (!m || fn.wheel) return;
    const w = (fx.wheels || []).filter(x => x.kind === (m[1] === 'Color' ? 'color' : 'gobo'))[Number(m[2]) - 1];
    if (w) fn.wheel = w.id;
  }));
  return channels;
}

// Copie profonde d'un canal avec de nouveaux identifiants
export function copyChannel(c) {
  const n = JSON.parse(JSON.stringify(c));
  n.id = uid();
  n.functions.forEach(f => { f.id = uid(); f.sets.forEach(s => { s.id = uid(); }); });
  return n;
}

// Nouveau mode à partir d'un autre : canaux choisis, éventuellement tous passés en 8 bits
export function deriveMode(src, { name, to8bit, keepIds }) {
  const channels = src.channels.filter(c => keepIds.has(c.id)).map(c => {
    const n = copyChannel(c);
    if (to8bit) n.fine = false;
    return n;
  });
  return { id: uid(), name, channels };
}

// Nombre d'adresses DMX occupées par un mode
export function footprint(mode) {
  return mode.channels.reduce((n, c) => n + (c.fine ? 2 : 1), 0);
}

// Vérifications : renvoie une liste de messages { level: 'error'|'warn', text }
export function validate(fx) {
  const out = [];
  const err = text => out.push({ level: 'error', text });
  const warn = text => out.push({ level: 'warn', text });

  if (!fx.manufacturer.trim()) err('Indique le fabricant.');
  if (!fx.name.trim()) err('Indique le nom du projecteur.');
  if (!fx.modes.length) err('Il faut au moins un mode DMX.');
  registerAttributes(fx.attrDefs);

  const wheels = fx.wheels || [];
  const wheelNames = new Set();
  for (const w of wheels) {
    const n = String(w.name || '').replace(/\./g, ' ').trim();
    if (!n) err('Une roue n\'a pas de nom.');
    else if (wheelNames.has(n.toLowerCase())) err(`Deux roues s'appellent « ${n} ».`);
    wheelNames.add(n.toLowerCase());
    if (!w.slots.length) err(`La roue « ${n} » n'a aucune fente.`);
  }

  const parts = fx.parts || [];
  const partNames = new Set(RESERVED_GEOMETRIES.map(n => n.toLowerCase()));
  for (const p of parts) {
    const n = partGeometryName(p);
    if (!n) { err('Un sous-élément n\'a pas de nom.'); continue; }
    if (partNames.has(n.toLowerCase())) {
      err(RESERVED_GEOMETRIES.some(r => r.toLowerCase() === n.toLowerCase())
        ? `Le nom « ${n} » est réservé, choisis-en un autre pour ce sous-élément.`
        : `Deux sous-éléments s'appellent « ${n} ».`);
    }
    partNames.add(n.toLowerCase());
  }

  const modeNames = new Set();
  for (const m of fx.modes) {
    const mn = m.name.trim() || '(sans nom)';
    if (modeNames.has(mn)) err(`Deux modes portent le même nom : « ${mn} ».`);
    modeNames.add(mn);
    if (!m.channels.length) err(`Le mode « ${mn} » n'a aucun canal.`);
    if (footprint(m) > 512) err(`Le mode « ${mn} » dépasse 512 adresses DMX.`);

    const seen = new Set();
    m.channels.forEach((c, i) => {
      const where = `Mode « ${mn} », canal ${i + 1}`;
      if (!c.attribute.trim()) { err(`${where} : choisis une fonction.`); return; }
      if (c.attribute === UNUSED) return;   // simple réservation d'adresse
      if (c.part && !parts.some(p => p.id === c.part)) warn(`${where} : son sous-élément a été supprimé, il sera rattaché au projecteur principal.`);
      if (c.part && geometryFor(c.attribute, fx.kind) !== 'Beam') warn(`${where} : Pan et Tilt restent toujours sur le projecteur principal.`);
      const geo = channelGeometry(c, fx);
      const key = geo + '_' + c.attribute;
      const onWhat = geo === 'Beam' || geo === 'Yoke' || geo === 'Head' ? 'le projecteur principal' : `l'élément « ${geo} »`;
      if (seen.has(key)) err(`${where} : « ${attributeLabel(c.attribute)} » est déjà utilisé sur ${onWhat} dans ce mode. Supprime le doublon, choisis une autre fonction, ou place ce canal sur un autre sous-élément.`);
      seen.add(key);
      if (getAttribute(c.attribute).custom) warn(`${where} : « ${c.attribute} » n'est pas un nom GDTF standard, MA3 le classera dans « Control ».`);
      if (!(c.defaultValue >= 0 && c.defaultValue <= 255)) err(`${where} : la valeur par défaut doit être entre 0 et 255.`);

      const fns = c.functions;
      if (!fns.length) { err(`${where} : aucune plage DMX.`); return; }
      const sorted = [...fns].sort((a, b) => a.from - b.from);
      if (sorted[0].from !== 0) err(`${where} : la première plage doit commencer à 0.`);
      sorted.forEach((f, k) => {
        if (!(f.from >= 0 && f.from <= 255)) err(`${where} : valeur de départ ${f.from} hors de 0–255.`);
        if (k > 0 && f.from === sorted[k - 1].from) err(`${where} : deux plages commencent à ${f.from}.`);
        if (!f.attribute.trim()) err(`${where} : une plage n'a pas de fonction.`);
        const to = k < sorted.length - 1 ? sorted[k + 1].from - 1 : 255;
        const wheel = f.wheel ? wheels.find(w => w.id === f.wheel) : null;
        if (f.wheel && !wheel) warn(`${where} : la roue liée à la plage « ${f.name || f.attribute} » n'existe plus, le lien sera ignoré.`);
        f.sets.forEach(s => {
          if (s.from < f.from || s.from > to) err(`${where} : le réglage « ${s.name} » (${s.from}) sort de sa plage ${f.from}–${to}.`);
          if (wheel && s.slot > wheel.slots.length) err(`${where} : le réglage « ${s.name} » vise la fente ${s.slot}, mais la roue « ${wheel.name} » n'en a que ${wheel.slots.length}.`);
        });
      });
    });
  }
  return out;
}
