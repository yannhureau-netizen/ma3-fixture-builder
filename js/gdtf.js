// Génération d'un fichier GDTF 1.1 (description.xml + images des gobos, dans un zip), importable dans grandMA3.
import { getAttribute, channelGeometry, partGeometryName, UNUSED, registerAttributes } from './attributes.js';
import { hexToGdtfColor, dataUrlToBytes } from './color.js';
import { makeZip } from './zip.js';

const IDENTITY = '{1,0,0,0}{0,1,0,0}{0,0,1,0}{0,0,0,1}';

export function makeUuid() {
  if (crypto.randomUUID) return crypto.randomUUID().toUpperCase();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Les noms GDTF servent de chemins (ex. "Beam_Dimmer.Dimmer.Dimmer") : pas de point dedans.
function cleanName(s, fallback) {
  const n = String(s ?? '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  return n || fallback;
}

// Nom de fichier sûr (images de gobos) : lettres sans accent, chiffres, _ et -
function fileSafe(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_') || 'image';
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(fallback);
}

function dmx(v) {
  const n = Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
  return `${n}/1`;
}

function isoDate(d = new Date()) {
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function usedAttributes(fx) {
  const names = new Set();
  for (const m of fx.modes) for (const c of m.channels) {
    if (c.attribute === UNUSED) continue;
    names.add(c.attribute);
    for (const f of c.functions) names.add(f.attribute);
  }
  return [...names].filter(Boolean).map(getAttribute);
}

function attributeDefinitions(attrs) {
  const groups = new Set();
  const features = new Map(); // FeatureGroup -> Set(Feature)
  for (const a of attrs) {
    if (a.group) groups.add(a.group);
    const [fg, f = fg] = String(a.feature || 'Control.Control').split('.');
    if (!features.has(fg)) features.set(fg, new Set());
    features.get(fg).add(f);
  }
  let x = '    <AttributeDefinitions>\n';
  x += '      <ActivationGroups>\n';
  for (const g of groups) x += `        <ActivationGroup Name="${esc(g)}"/>\n`;
  x += '      </ActivationGroups>\n';
  x += '      <FeatureGroups>\n';
  for (const [fg, fs] of features) {
    x += `        <FeatureGroup Name="${esc(fg)}" Pretty="${esc(fg)}">\n`;
    for (const f of fs) x += `          <Feature Name="${esc(f)}"/>\n`;
    x += '        </FeatureGroup>\n';
  }
  x += '      </FeatureGroups>\n';
  x += '      <Attributes>\n';
  for (const a of attrs) {
    const ag = a.group ? ` ActivationGroup="${esc(a.group)}"` : '';
    const feature = String(a.feature || 'Control.Control').includes('.') ? a.feature : `${a.feature}.${a.feature}`;
    x += `        <Attribute Name="${esc(a.name)}" Pretty="${esc(a.pretty || a.name)}"${ag} Feature="${esc(feature)}" PhysicalUnit="${esc(a.unit || 'None')}"/>\n`;
  }
  x += '      </Attributes>\n';
  x += '    </AttributeDefinitions>\n';
  return x;
}

// Nom GDTF de chaque roue (id -> nom), identique dans <Wheels> et dans les plages qui la référencent
function wheelNameMap(fx) {
  const map = new Map();
  (fx.wheels || []).forEach((w, i) => map.set(w.id, cleanName(w.name, `Roue ${i + 1}`)));
  return map;
}

function wheelsXml(fx, names, media) {
  const wheels = fx.wheels || [];
  if (!wheels.length) return '    <Wheels/>\n';
  let x = '    <Wheels>\n';
  for (const w of wheels) {
    const wName = names.get(w.id);
    x += `      <Wheel Name="${esc(wName)}">\n`;
    w.slots.forEach((s, si) => {
      let mediaAttr = '';
      if (s.image) {
        const file = `${fileSafe(wName)}_${si + 1}`;
        media.push({ name: `wheels/${file}.png`, data: dataUrlToBytes(s.image) });
        mediaAttr = ` MediaFileName="${esc(file)}"`;
      }
      x += `        <Slot Name="${esc(cleanName(s.name, `Fente ${si + 1}`))}" Color="${hexToGdtfColor(s.color || '#ffffff')}"${mediaAttr}/>\n`;
    });
    x += '      </Wheel>\n';
  }
  x += '    </Wheels>\n';
  return x;
}

function modelsAndGeometries(fx) {
  const beamTag = name => `<Beam Name="${esc(name)}" Model="Beam" Position="${IDENTITY}" LampType="${esc(fx.lampType)}" PowerConsumption="${num(fx.power, 100)}" LuminousFlux="10000" ColorTemperature="6000" BeamAngle="${num(fx.beamAngle, 25)}" FieldAngle="${num(fx.beamAngle, 25)}" BeamRadius="0.05" BeamType="${esc(fx.beamType)}" ColorRenderingIndex="100"/>`;
  // Faisceau principal + un faisceau par sous-élément (MA3 en fait des sous-parties du projecteur)
  const indent = fx.kind === 'moving' ? '            ' : '        ';
  const beam = [beamTag('Beam'), ...(fx.parts || []).map(p => beamTag(partGeometryName(p)))].join('\n' + indent);
  // Dimensions réelles (mm -> m) si elles sont renseignées, sinon des valeurs plausibles
  const moving = fx.kind === 'moving';
  const L = Number(fx.length) > 0 ? fx.length / 1000 : (moving ? 0.35 : 0.3);
  const W = Number(fx.width) > 0 ? fx.width / 1000 : (moving ? 0.35 : 0.3);
  const H = Number(fx.height) > 0 ? fx.height / 1000 : (moving ? 0.65 : 0.3);
  const r = v => Number(v.toFixed(4));
  let models = '    <Models>\n';
  let geos = '    <Geometries>\n';
  if (moving) {
    // pied + fourche + tête = hauteur totale
    models += `      <Model Name="Base" Length="${r(L)}" Width="${r(W)}" Height="${r(H * 0.2)}" PrimitiveType="Base"/>\n`;
    models += `      <Model Name="Yoke" Length="${r(L)}" Width="${r(W * 0.3)}" Height="${r(H * 0.35)}" PrimitiveType="Yoke"/>\n`;
    models += `      <Model Name="Head" Length="${r(L * 0.7)}" Width="${r(W * 0.7)}" Height="${r(H * 0.45)}" PrimitiveType="Head"/>\n`;
    models += '      <Model Name="Beam" Length="0.1" Width="0.1" Height="0.02" PrimitiveType="Cylinder"/>\n';
    geos += `      <Geometry Name="Base" Model="Base" Position="${IDENTITY}">\n`;
    geos += `        <Axis Name="Yoke" Model="Yoke" Position="{1,0,0,0}{0,1,0,0}{0,0,1,${r(-H * 0.2)}}{0,0,0,1}">\n`;
    geos += `          <Axis Name="Head" Model="Head" Position="{1,0,0,0}{0,1,0,0}{0,0,1,${r(-H * 0.3)}}{0,0,0,1}">\n`;
    geos += `            ${beam}\n`;
    geos += '          </Axis>\n';
    geos += '        </Axis>\n';
    geos += '      </Geometry>\n';
  } else {
    models += `      <Model Name="Base" Length="${r(L)}" Width="${r(W)}" Height="${r(H)}" PrimitiveType="Cube"/>\n`;
    models += '      <Model Name="Beam" Length="0.1" Width="0.1" Height="0.02" PrimitiveType="Cylinder"/>\n';
    geos += `      <Geometry Name="Base" Model="Base" Position="${IDENTITY}">\n`;
    geos += `        ${beam}\n`;
    geos += '      </Geometry>\n';
  }
  models += '    </Models>\n';
  geos += '    </Geometries>\n';
  return models + geos;
}

function channelXml(c, startAddr, fx, wheelNames) {
  const geo = channelGeometry(c, fx);
  const chName = `${geo}_${c.attribute}`;
  const offset = c.fine ? `${startAddr},${startAddr + 1}` : `${startAddr}`;
  const fns = [...c.functions].sort((a, b) => a.from - b.from);

  // Noms uniques de plages
  const used = new Map();
  const names = fns.map(f => {
    const base = cleanName(f.name, f.attribute);
    const k = (used.get(base) || 0) + 1;
    used.set(base, k);
    return k === 1 ? base : `${base} ${k}`;
  });

  // La plage qui contient la valeur par défaut est la fonction initiale
  const def = Number(c.defaultValue) || 0;
  let initIdx = 0;
  fns.forEach((f, i) => { if (f.from <= def) initIdx = i; });

  let x = `          <DMXChannel DMXBreak="1" Offset="${offset}" InitialFunction="${esc(chName)}.${esc(c.attribute)}.${esc(names[initIdx])}" Highlight="None" Geometry="${esc(geo)}">\n`;
  x += `            <LogicalChannel Attribute="${esc(c.attribute)}" Snap="No" Master="None" MibFade="0" DMXChangeTimeLimit="0">\n`;
  fns.forEach((f, i) => {
    const defVal = i === initIdx ? def : f.from;
    const wName = f.wheel ? wheelNames.get(f.wheel) : null;
    const wheel = wName ? (fx.wheels || []).find(w => w.id === f.wheel) : null;
    const wheelAttr = wName ? ` Wheel="${esc(wName)}"` : '';
    x += `              <ChannelFunction Name="${esc(names[i])}" Attribute="${esc(f.attribute)}" OriginalAttribute="" DMXFrom="${dmx(f.from)}" Default="${dmx(defVal)}" PhysicalFrom="${num(f.physFrom)}" PhysicalTo="${num(f.physTo, 1)}" RealFade="0" RealAcceleration="0"${wheelAttr}`;
    const sets = [...f.sets].sort((a, b) => a.from - b.from);
    if (!sets.length) { x += '/>\n'; return; }
    x += '>\n';
    for (const s of sets) {
      const slot = wheel && s.slot > 0 && s.slot <= wheel.slots.length ? ` WheelSlotIndex="${s.slot}"` : '';
      x += `                <ChannelSet Name="${esc(cleanName(s.name, 'Réglage'))}" DMXFrom="${dmx(s.from)}"${slot}/>\n`;
    }
    x += '              </ChannelFunction>\n';
  });
  x += '            </LogicalChannel>\n';
  x += '          </DMXChannel>\n';
  return x;
}

function dmxModes(fx, wheelNames) {
  let x = '    <DMXModes>\n';
  for (const m of fx.modes) {
    x += `      <DMXMode Name="${esc(cleanName(m.name, 'Mode'))}" Geometry="Base">\n`;
    x += '        <DMXChannels>\n';
    let addr = 1;
    for (const c of m.channels) {
      // Un canal inutilisé ne fait que réserver son adresse
      if (c.attribute !== UNUSED) x += channelXml(c, addr, fx, wheelNames);
      addr += c.fine ? 2 : 1;
    }
    x += '        </DMXChannels>\n';
    x += '        <Relations/>\n';
    x += '        <FTMacros/>\n';
    x += '      </DMXMode>\n';
  }
  x += '    </DMXModes>\n';
  return x;
}

function build(fx) {
  registerAttributes(fx.attrDefs);
  const media = [];
  const wheelNames = wheelNameMap(fx);
  const name = cleanName(fx.name, 'Projecteur');
  const shortName = cleanName(fx.shortName, name);
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n';
  x += '<GDTF DataVersion="1.1">\n';
  // Photo : fichier thumbnail.png à la racine du .gdtf, référencé sans extension
  const thumb = fx.thumbnail ? 'thumbnail' : '';
  if (thumb) media.push({ name: 'thumbnail.png', data: dataUrlToBytes(fx.thumbnail) });
  x += `  <FixtureType Name="${esc(name)}" ShortName="${esc(shortName)}" LongName="${esc(name)}" Manufacturer="${esc(cleanName(fx.manufacturer, 'Generic'))}" Description="${esc(fx.description)}" FixtureTypeID="${esc(fx.uuid || makeUuid())}" Thumbnail="${thumb}">\n`;
  x += attributeDefinitions(usedAttributes(fx));
  x += wheelsXml(fx, wheelNames, media);
  x += Number(fx.weight) > 0
    ? `    <PhysicalDescriptions>\n      <Properties>\n        <Weight Value="${num(fx.weight)}"/>\n      </Properties>\n    </PhysicalDescriptions>\n`
    : '    <PhysicalDescriptions/>\n';
  x += modelsAndGeometries(fx);
  x += dmxModes(fx, wheelNames);
  x += '    <Revisions>\n';
  x += `      <Revision Text="Révision ${num(fx.revision, 1)} – créé avec MA3 Fixture Builder" Date="${isoDate()}" UserID="0"/>\n`;
  x += '    </Revisions>\n';
  x += '    <FTPresets/>\n';
  x += '    <Protocols/>\n';
  x += '  </FixtureType>\n';
  x += '</GDTF>\n';
  return { xml: x, media };
}

export function buildDescriptionXml(fx) {
  return build(fx).xml;
}

export function gdtfFileName(fx) {
  const safe = s => cleanName(s, 'x').replace(/[\\/:*?"<>|@]/g, '_');
  return `${safe(fx.manufacturer || 'Generic')}@${safe(fx.name || 'Projecteur')}@Rev${num(fx.revision, 1)}.gdtf`;
}

export function buildGdtf(fx) {
  const { xml, media } = build(fx);
  return makeZip([{ name: 'description.xml', data: xml }, ...media]);
}
