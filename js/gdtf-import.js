// Ouverture d'un fichier .gdtf existant : on le convertit en fiche modifiable dans l'appli.
// Ce qui est repris : identité, source, roues (couleurs + images), modes, canaux, plages, réglages,
// sous-éléments. La forme 3D d'origine n'est pas reprise (l'appli recrée une structure simple).
import { readZip } from './unzip.js';
import { gdtfColorToHex, toPngDataUrl } from './color.js';
import { ATTRIBUTES, UNUSED, RESERVED_GEOMETRIES } from './attributes.js';
import { uid, newFixture, newChannel, condKey } from './model.js';

const LIBRARY = new Set(ATTRIBUTES.map(a => a.name));
const PAN_TILT = new Set(['Pan', 'Tilt', 'PanRotate', 'TiltRotate']);

const attr = (el, name, def = '') => (el && el.hasAttribute(name) ? el.getAttribute(name) : def);
const numOr = (v, def) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : def);

// "32768/2" -> 128 (échelle 0-255 de l'appli)
function parseDmx(v) {
  const m = /^\s*(\d+)(?:\/(\d+))?\s*$/.exec(v || '');
  if (!m) return null;
  const bytes = Math.max(1, Number(m[2] || 1));
  const raw = Number(m[1]);
  const div = 256 ** (bytes - 1);
  return { value: Math.min(255, Math.floor(raw / div)), exact: raw % div === 0, precise: raw / div };
}

// Après arrondi à 0-255, deux plages peuvent tomber sur la même valeur : on les décale d'un cran
// pour que chacune garde sa place, puis on recale les réglages dans leur plage.
function tidyFunctions(functions) {
  let shifted = false;
  // chaque variante (même condition) est découpée indépendamment
  const groups = new Map();
  for (const f of functions) {
    const k = condKey(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a._precise - b._precise);
    list.forEach((f, i) => {
      if (i > 0 && f.from <= list[i - 1].from) { f.from = Math.min(255, list[i - 1].from + 1); shifted = true; }
    });
    list.forEach((f, i) => {
      const to = i < list.length - 1 ? list[i + 1].from - 1 : 255;
      f.sets.forEach(s => { s.from = Math.max(f.from, Math.min(to, s.from)); });
      delete f._precise;
    });
  }
  return shifted;
}

export async function importGdtf(file) {
  const notes = [];
  const zip = await readZip(await file.arrayBuffer());
  const descName = zip.find('description.xml');
  if (!descName) throw new Error('il ne contient pas de description.xml, ce n\'est pas un fichier GDTF');

  const doc = new DOMParser().parseFromString(new TextDecoder().decode(await zip.get(descName)), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('son description.xml est illisible');
  const ft = doc.querySelector('FixtureType');
  if (!ft) throw new Error('aucun projecteur (FixtureType) dans le fichier');

  const fx = newFixture();
  fx.manufacturer = attr(ft, 'Manufacturer');
  fx.name = attr(ft, 'Name');
  fx.shortName = attr(ft, 'ShortName');
  fx.description = attr(ft, 'Description');
  if (attr(ft, 'FixtureTypeID')) fx.uuid = attr(ft, 'FixtureTypeID').toUpperCase();
  fx.revision = doc.querySelectorAll('Revisions > Revision').length + 1;
  fx.modes = [];
  fx.parts = [];
  fx.wheels = [];

  // --- Photo (thumbnail.png ou .svg à la racine)
  const thumbName = attr(ft, 'Thumbnail');
  if (thumbName) {
    const entry = zip.find(`${thumbName}.png`) || zip.find(`${thumbName}.svg`);
    if (entry) {
      try {
        const mime = entry.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        fx.thumbnail = await toPngDataUrl(new Blob([await zip.get(entry)], { type: mime }));
      } catch {
        notes.push('La photo du projecteur est illisible : elle n\'a pas été reprise.');
      }
    }
  }

  // --- Poids
  const weight = doc.querySelector('PhysicalDescriptions Properties Weight');
  if (weight) fx.weight = numOr(attr(weight, 'Value'), 0);

  // --- Attributs propres au fichier (absents de la bibliothèque de l'appli)
  fx.attrDefs = {};
  for (const a of doc.querySelectorAll('AttributeDefinitions > Attributes > Attribute')) {
    const name = attr(a, 'Name');
    if (!name || LIBRARY.has(name)) continue;
    const pretty = attr(a, 'Pretty') || name;
    fx.attrDefs[name] = {
      name, label: pretty, pretty,
      feature: attr(a, 'Feature') || 'Control.Control',
      group: attr(a, 'ActivationGroup') || undefined,
      unit: attr(a, 'PhysicalUnit') || 'None',
      phys: [0, 1],
    };
  }

  // --- Source lumineuse (premier faisceau trouvé)
  const beam = doc.querySelector('Geometries Beam');
  if (beam) {
    fx.lampType = attr(beam, 'LampType', 'LED');
    fx.power = numOr(attr(beam, 'PowerConsumption'), 100);
    fx.beamAngle = numOr(attr(beam, 'BeamAngle'), 25);
    fx.beamType = attr(beam, 'BeamType', 'Spot');
  }

  // --- Roues
  const wheelIds = new Map();
  for (const w of doc.querySelectorAll('Wheels > Wheel')) {
    const name = attr(w, 'Name');
    let hasImages = false;
    const slots = [];
    for (const s of w.querySelectorAll(':scope > Slot')) {
      const slot = { id: uid(), name: attr(s, 'Name'), color: gdtfColorToHex(attr(s, 'Color', '0.3127,0.3290,100')), image: '' };
      const media = attr(s, 'MediaFileName');
      if (media) {
        hasImages = true;
        const base = `wheels/${media}`.toLowerCase();
        const entry = zip.names.find(n => n.toLowerCase() === base || n.toLowerCase().startsWith(base + '.'));
        if (entry) {
          const ext = entry.split('.').pop().toLowerCase();
          const mime = ext === 'svg' ? 'image/svg+xml' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
          try {
            slot.image = await toPngDataUrl(new Blob([await zip.get(entry)], { type: mime }));
          } catch {
            notes.push(`Image du gobo « ${slot.name} » (roue « ${name} ») illisible : elle n'a pas été reprise.`);
          }
        } else {
          notes.push(`Image « ${media} » (roue « ${name} ») absente du fichier.`);
        }
      }
      slots.push(slot);
    }
    const kind = hasImages || /gobo/i.test(name) ? 'gobo'
      : (w.querySelector('Facet') || /prism|anim|effect/i.test(name)) ? 'other' : 'color';
    const wheel = { id: uid(), name, kind, slots };
    fx.wheels.push(wheel);
    wheelIds.set(name, wheel.id);
  }

  // --- Géométries : arbre, profondeur, références (projecteurs à cellules répétées)
  const geo = new Map(); // nom -> { el, tag, parent, depth }
  const walk = (el, depth, parent) => {
    for (const c of el.children) {
      const n = attr(c, 'Name');
      if (n && !geo.has(n)) geo.set(n, { el: c, tag: c.tagName, parent, depth });
      walk(c, depth + 1, n || parent);
    }
  };
  const geoRoot = doc.querySelector('FixtureType > Geometries');
  if (geoRoot) walk(geoRoot, 0, null);
  const isAncestor = (a, b) => {
    let p = geo.get(b)?.parent;
    while (p) { if (p === a) return true; p = geo.get(p)?.parent; }
    return false;
  };
  const refs = [...geo.entries()].filter(([, g]) => g.tag === 'GeometryReference').map(([name, g]) => ({
    name,
    template: attr(g.el, 'Geometry'),
    breaks: [...g.el.querySelectorAll('Break')].map(b => ({ brk: numOr(attr(b, 'DMXBreak'), 1), off: numOr(attr(b, 'DMXOffset'), 1) })),
  }));
  const templates = new Set(refs.map(r => r.template));
  const templateOf = n => {
    if (templates.has(n)) return n;
    let p = geo.get(n)?.parent;
    while (p) { if (templates.has(p)) return p; p = geo.get(p)?.parent; }
    return null;
  };
  const hasAxis = [...geo.values()].some(g => g.tag === 'Axis');

  // --- Dimensions approximatives (mm) : longueur/largeur max des modèles,
  //     hauteur = somme des modèles du pied jusqu'au premier faisceau
  const models = new Map([...doc.querySelectorAll('Models > Model')].map(m => [attr(m, 'Name'), {
    l: numOr(attr(m, 'Length'), 0), w: numOr(attr(m, 'Width'), 0), h: numOr(attr(m, 'Height'), 0),
  }]));
  const modelOf = n => models.get(attr(geo.get(n)?.el, 'Model'));
  if (models.size) {
    let L = 0, W = 0, H = 0;
    for (const n of geo.keys()) { const m = modelOf(n); if (m) { L = Math.max(L, m.l); W = Math.max(W, m.w); } }
    const firstBeam = [...geo.entries()].find(([, g]) => g.tag === 'Beam')?.[0];
    for (let n = firstBeam; n; n = geo.get(n)?.parent) { const m = modelOf(n); if (m && geo.get(n).tag !== 'Beam') H += m.h; }
    if (!H) for (const n of geo.keys()) { const m = modelOf(n); if (m) H = Math.max(H, m.h); }
    fx.length = Math.round(L * 1000);
    fx.width = Math.round(W * 1000);
    fx.height = Math.round(H * 1000);
  }

  // Sous-éléments créés au fil des modes (un par nom de géométrie)
  const partByName = new Map();
  const partId = geoName => {
    if (!partByName.has(geoName)) {
      const reserved = RESERVED_GEOMETRIES.some(r => r.toLowerCase() === geoName.toLowerCase());
      const p = { id: uid(), name: reserved ? `${geoName} 1` : geoName.replace(/\./g, ' ') };
      partByName.set(geoName, p);
      fx.parts.push(p);
    }
    return partByName.get(geoName).id;
  };

  let anyPanTilt = false;
  let inexact = false;
  let shiftedRanges = 0;
  let conditional = 0;
  let resolvedVariants = 0;
  let skippedBreaks = 0;
  let virtualCount = 0;
  let wideCount = 0;

  for (const m of doc.querySelectorAll('DMXModes > DMXMode')) {
    const modeName = attr(m, 'Name', 'Mode');
    const raw = [];
    for (const ch of m.querySelectorAll(':scope > DMXChannels > DMXChannel')) {
      const offs = attr(ch, 'Offset').split(',').map(s => Number(s.trim())).filter(x => Number.isFinite(x) && x > 0);
      const g = attr(ch, 'Geometry');
      const brkAttr = attr(ch, 'DMXBreak', '1');
      const brk = brkAttr === 'Overwrite' ? null : numOr(brkAttr, 1);
      if (!offs.length) { virtualCount++; continue; }
      const tpl = templateOf(g);
      if (tpl) {
        for (const r of refs.filter(x => x.template === tpl)) {
          const b = r.breaks.find(x => x.brk === brk) || r.breaks[0];
          const shift = b ? b.off - 1 : 0;
          raw.push({ ch, offs: offs.map(o => o + shift), geom: g, part: r.name });
        }
      } else {
        if (brk !== null && brk !== 1) { skippedBreaks++; continue; }
        raw.push({ ch, offs, geom: g, part: null });
      }
    }

    // Quelle géométrie est le « projecteur principal », lesquelles sont des sous-éléments ?
    const firstAttr = ch => attr(ch.querySelector(':scope > LogicalChannel'), 'Attribute');
    const count = new Map();
    const attrsOf = new Map();
    for (const r of raw) {
      if (r.part) continue;
      if (PAN_TILT.has(firstAttr(r.ch)) || geo.get(r.geom)?.tag === 'Axis') continue;
      count.set(r.geom, (count.get(r.geom) || 0) + 1);
      if (!attrsOf.has(r.geom)) attrsOf.set(r.geom, new Set());
      attrsOf.get(r.geom).add(firstAttr(r.ch));
    }
    // Une zone dont aucune fonction ne se retrouve dans une autre zone peut rester sur le principal
    const overlaps = (n, list) => list.some(o => o !== n && [...attrsOf.get(n)].some(a => attrsOf.get(o).has(a)));
    const names = [...count.keys()];
    const leaves = names.filter(n => !names.some(o => o !== n && isAncestor(n, o)));
    let main;
    if (leaves.length <= 1) {
      main = new Set(names);
    } else {
      const max = Math.max(...leaves.map(n => count.get(n)));
      const top = leaves.filter(n => count.get(n) === max);
      const mainLeaf = top.length === 1 ? top[0] : null;
      main = new Set(names.filter(n => !leaves.includes(n) || n === mainLeaf || !overlaps(n, leaves)));
    }
    for (const r of raw) if (!r.part && count.has(r.geom) && !main.has(r.geom)) r.part = r.geom;

    // Conversion des canaux, dans l'ordre des adresses (les trous deviennent des canaux inutilisés)
    raw.sort((a, b) => a.offs[0] - b.offs[0]);

    // Une même fonction qui revient sur une autre zone du projecteur : cette zone devient un sous-élément
    const occupant = new Map();
    for (const r of raw) {
      if (r.part) continue;
      const a = firstAttr(r.ch);
      if (!a || PAN_TILT.has(a)) continue;
      if (occupant.has(a) && occupant.get(a) !== r.geom) r.part = r.geom;
      else occupant.set(a, r.geom);
    }
    const channels = [];
    let next = 1;
    for (const r of raw) {
      const start = r.offs[0];
      if (start < next) { notes.push(`Mode « ${modeName} » : deux canaux se chevauchent à l'adresse ${start}, le second a été ignoré.`); continue; }
      while (next < start) { channels.push(newChannel(UNUSED)); next++; }

      const lcs = [...r.ch.querySelectorAll(':scope > LogicalChannel')];
      const chAttr = attr(lcs[0], 'Attribute') || UNUSED;
      if (PAN_TILT.has(chAttr)) anyPanTilt = true;
      const functions = [];
      const byName = new Map();
      for (const lc of lcs) {
        for (const cf of lc.querySelectorAll(':scope > ChannelFunction')) {
          // Plage conditionnelle : on note le canal maître (résolu une fois tous les canaux du mode lus)
          const mm = attr(cf, 'ModeMaster');
          const cond = mm ? {
            path: mm.split('.')[0],
            from: (parseDmx(attr(cf, 'ModeFrom', '0/1')) || { value: 0 }).value,
            to: (parseDmx(attr(cf, 'ModeTo', '255/1')) || { value: 255 }).value,
          } : null;
          const from = parseDmx(attr(cf, 'DMXFrom', '0/1')) || { value: 0, exact: true, precise: 0 };
          if (!from.exact) inexact = true;
          const wheelName = attr(cf, 'Wheel');
          const fn = {
            id: uid(),
            name: attr(cf, 'Name'),
            attribute: attr(cf, 'Attribute') || attr(lc, 'Attribute'),
            from: from.value,
            physFrom: numOr(attr(cf, 'PhysicalFrom'), 0),
            physTo: numOr(attr(cf, 'PhysicalTo'), 1),
            wheel: wheelName ? (wheelIds.get(wheelName) || '') : '',
            sets: [],
            cond: null,
            _cond: cond,
            _precise: from.precise,
          };
          for (const cs of cf.querySelectorAll(':scope > ChannelSet')) {
            const d = parseDmx(attr(cs, 'DMXFrom', '0/1'));
            if (!d) continue;
            if (!d.exact) inexact = true;
            fn.sets.push({ id: uid(), name: attr(cs, 'Name'), from: d.value, slot: numOr(attr(cs, 'WheelSlotIndex'), 0) });
          }
          functions.push(fn);
          byName.set(fn.name, cf);
        }
      }
      if (!functions.length) functions.push({ id: uid(), name: '', attribute: chAttr, from: 0, physFrom: 0, physTo: 1, wheel: '', sets: [], cond: null, _precise: 0 });

      // Valeur par défaut : celle de la fonction initiale
      const initName = attr(r.ch, 'InitialFunction').split('.').pop();
      const initCf = byName.get(initName) || lcs[0]?.querySelector('ChannelFunction');
      const def = parseDmx(attr(initCf, 'Default', '0/1'));

      const fine = r.offs.length >= 2 && r.offs[1] === start + 1;
      if (r.offs.length > 2) wideCount++;
      if (r.offs.length >= 2 && !fine) notes.push(`Mode « ${modeName} » : le canal fin de « ${chAttr} » n'est pas juste après le canal principal, il a été ignoré.`);

      channels.push({
        id: uid(),
        attribute: chAttr,
        part: r.part ? partId(r.part) : '',
        fine,
        defaultValue: def ? def.value : 0,
        functions,
        _geom: r.geom,
      });
      next = start + (fine ? 2 : 1);
    }

    // Résolution des plages conditionnelles : le maître est désigné par « Géométrie_Attribut »
    const byKey = new Map();
    for (const ch of channels) {
      if (!ch._geom) continue;
      const k = `${ch._geom}_${ch.attribute}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(ch);
    }
    for (const ch of channels) {
      let unresolvedKey = null;
      ch.functions = ch.functions.filter(fn => {
        const c = fn._cond;
        delete fn._cond;
        if (!c) return true;
        const cands = byKey.get(c.path) || [];
        const master = cands.find(x => x.part === ch.part && x !== ch) || cands.find(x => x !== ch);
        if (master) { fn.cond = { master: master.id, from: c.from, to: c.to }; resolvedVariants++; return true; }
        // Maître introuvable : on garde la première variante, sans condition
        const k = `${c.path}|${c.from}|${c.to}`;
        if (unresolvedKey === null) unresolvedKey = k;
        if (k !== unresolvedKey) { conditional++; return false; }
        return true;
      });
      if (tidyFunctions(ch.functions)) shiftedRanges++;
      delete ch._geom;
    }
    fx.modes.push({ id: uid(), name: modeName, channels });
  }

  if (!fx.modes.length) throw new Error('aucun mode DMX dans le fichier');
  fx.kind = hasAxis || anyPanTilt ? 'moving' : 'fixed';

  if (inexact) notes.push('Certaines valeurs 16 ou 24 bits ont été arrondies à l\'échelle 0-255 de l\'appli. Vérifie les plages très serrées.');
  if (shiftedRanges) notes.push(`Dans ${shiftedRanges} canal(aux), des plages très serrées tombaient sur la même valeur après arrondi : elles ont été décalées d'un cran.`);
  if (resolvedVariants) notes.push(`${resolvedVariants} plage(s) conditionnelle(s) reprises (comportement qui dépend d'un autre canal, ex. index ou rotation du gobo selon la roue). Tu les trouves dans les « Plages » des canaux concernés.`);
  if (conditional) notes.push(`${conditional} plage(s) conditionnelle(s) dont le canal maître est introuvable n'ont pas été reprises : l'appli garde la première variante.`);
  if (wideCount) notes.push(`${wideCount} canal(aux) en 24 bits ou plus ont été réduits à 16 bits.`);
  if (virtualCount) notes.push(`${virtualCount} canal(aux) virtuel(s) (sans adresse DMX, ex. dimmer virtuel) n'ont pas été repris.`);
  if (skippedBreaks) notes.push(`${skippedBreaks} canal(aux) sur un 2e univers DMX (DMX Break) ne sont pas gérés et ont été ignorés.`);
  if (fx.parts.length) notes.push(`${fx.parts.length} sous-élément(s) reconnu(s) : vérifie leur répartition à l'étape « Canaux DMX ».`);
  notes.push('La forme 3D d\'origine (modèles, positions des éléments) n\'est pas reprise : à l\'export, l\'appli recrée une structure simple.');
  return { fixture: fx, notes };
}
