// Modèles de départ proposés quand on crée un nouveau projecteur.
// Chacun produit une fiche complète que l'on ajuste ensuite d'après la doc du fabricant.
import { newFixture, newWheel, newChannel, uid, TEMPLATES, makeCellChannels, linkWheels, fillSetsFromWheel } from './model.js';

// Canaux à partir des boutons « + … » de l'appli
function chans(...keys) {
  return keys.flatMap(k => TEMPLATES.find(t => t.key === k).make());
}

function base(props) {
  const fx = newFixture();
  Object.assign(fx, props);
  fx.modes = [];
  return fx;
}

function addMode(fx, name, channels) {
  linkWheels(fx, channels);
  // Roues : un réglage par fente, déjà relié (les valeurs DMX sont à ajuster d'après la doc)
  for (const c of channels) for (const fn of c.functions) {
    const w = fn.wheel && fx.wheels.find(x => x.id === fn.wheel);
    if (w && /^(Color|Gobo)\d+$/.test(fn.attribute)) fillSetsFromWheel(c, fn, w);
  }
  fx.modes.push({ id: uid(), name, channels });
}

export const STARTERS = [
  {
    key: 'blank', label: 'Fiche vide', icon: 'blank',
    desc: 'Tout part de zéro.',
    build: () => newFixture(),
  },
  {
    key: 'par-rgb', label: 'PAR LED RGB', icon: 'par',
    desc: 'Rouge, vert, bleu, avec ou sans intensité et strobe.',
    build: () => {
      const fx = base({ kind: 'fixed', beamType: 'Wash', beamAngle: 25, power: 60, description: 'Modèle de départ : PAR LED RGB' });
      addMode(fx, '3 canaux', chans('rgb'));
      addMode(fx, '5 canaux', chans('dim', 'rgb', 'strobe'));
      return fx;
    },
  },
  {
    key: 'par-rgbw', label: 'PAR LED RGBW', icon: 'par',
    desc: 'Rouge, vert, bleu, blanc.',
    build: () => {
      const fx = base({ kind: 'fixed', beamType: 'Wash', beamAngle: 25, power: 100, description: 'Modèle de départ : PAR LED RGBW' });
      addMode(fx, '4 canaux', chans('rgbw'));
      addMode(fx, '6 canaux', chans('dim', 'rgbw', 'strobe'));
      return fx;
    },
  },
  {
    key: 'par-rgbwauv', label: 'PAR LED RGBWA + UV', icon: 'par',
    desc: 'Six couleurs, avec intensité et strobe.',
    build: () => {
      const fx = base({ kind: 'fixed', beamType: 'Wash', beamAngle: 25, power: 120, description: 'Modèle de départ : PAR LED RGBWA+UV' });
      addMode(fx, '6 canaux', chans('rgbwauv'));
      addMode(fx, '8 canaux', chans('dim', 'rgbwauv', 'strobe'));
      return fx;
    },
  },
  {
    key: 'spot', label: 'Lyre spot', icon: 'moving',
    desc: 'Roue de couleurs, roue de gobos tournants, prisme, frost, zoom, focus.',
    build: () => {
      const fx = base({ kind: 'moving', beamType: 'Spot', beamAngle: 20, power: 300, description: 'Modèle de départ : lyre spot' });
      fx.wheels.push(newWheel('color', fx), newWheel('gobo', fx));
      addMode(fx, 'Standard', chans('pt16', 'speed', 'dim', 'shutter', 'color1', 'gobo1', 'gobo1rot', 'prism', 'frost', 'iris', 'zoom', 'focus', 'ctrl'));
      return fx;
    },
  },
  {
    key: 'wash', label: 'Lyre wash', icon: 'moving',
    desc: 'Mélange RGBW, CTO, zoom.',
    build: () => {
      const fx = base({ kind: 'moving', beamType: 'Wash', beamAngle: 30, power: 400, description: 'Modèle de départ : lyre wash' });
      addMode(fx, 'Standard', chans('pt16', 'speed', 'dim16', 'shutter', 'rgbw', 'cto', 'zoom', 'ctrl'));
      return fx;
    },
  },
  {
    key: 'beam', label: 'Lyre beam', icon: 'moving',
    desc: 'Faisceau serré : couleurs, gobos, prisme, frost, focus.',
    build: () => {
      const fx = base({ kind: 'moving', beamType: 'Spot', beamAngle: 3, power: 250, description: 'Modèle de départ : lyre beam' });
      fx.wheels.push(newWheel('color', fx), newWheel('gobo', fx));
      addMode(fx, 'Standard', chans('pt16', 'speed', 'dim', 'shutter', 'color1', 'gobo1', 'prism', 'frost', 'focus', 'ctrl'));
      return fx;
    },
  },
  {
    key: 'bar8', label: 'Barre LED 8 pixels', icon: 'bar',
    desc: '8 cellules RGB, avec intensité et strobe générales.',
    build: () => {
      const fx = base({ kind: 'fixed', beamType: 'Wash', beamAngle: 30, power: 150, length: 1000, width: 80, height: 100, description: 'Modèle de départ : barre LED 8 pixels' });
      for (let i = 1; i <= 8; i++) fx.parts.push({ id: uid(), name: `Pixel ${i}` });
      addMode(fx, '24 canaux (pixels)', fx.parts.flatMap(p => makeCellChannels('rgb', p.id)));
      addMode(fx, '26 canaux', [...chans('dim', 'strobe'), ...fx.parts.flatMap(p => makeCellChannels('rgb', p.id))]);
      addMode(fx, '3 canaux (tout ensemble)', chans('rgb'));
      return fx;
    },
  },
  {
    key: 'profile', label: 'Découpe LED', icon: 'profile',
    desc: 'Intensité 16 bits, strobe, température de couleur, zoom, focus, iris.',
    build: () => {
      const fx = base({ kind: 'fixed', beamType: 'Spot', beamAngle: 36, power: 200, description: 'Modèle de départ : découpe LED' });
      addMode(fx, 'Standard', [...chans('dim16', 'strobe'), newChannel('CTC'), ...chans('zoom', 'focus', 'iris')]);
      addMode(fx, '1 canal', chans('dim'));
      return fx;
    },
  },
  {
    key: 'strobe', label: 'Stroboscope LED', icon: 'strobe',
    desc: 'Intensité, vitesse du strobe, contrôle.',
    build: () => {
      const fx = base({ kind: 'fixed', beamType: 'Glow', beamAngle: 120, power: 500, description: 'Modèle de départ : stroboscope LED' });
      addMode(fx, '3 canaux', chans('dim', 'strobe', 'ctrl'));
      return fx;
    },
  },
];

export function buildStarter(key) {
  const s = STARTERS.find(x => x.key === key) || STARTERS[0];
  const fx = s.build();
  if (!fx.modes.length) fx.modes.push({ id: uid(), name: 'Mode 1', channels: [] });
  fx.updatedAt = Date.now();
  return fx;
}

export const STARTER_ICONS = {
  blank: '<rect x="12" y="8" width="24" height="32" rx="3"/><path d="M24 18v12M18 24h12"/>',
  par: '<rect x="8" y="14" width="26" height="20" rx="4"/><path d="M34 19l6-3v16l-6-3"/><path d="M21 34v6M14 40h14"/>',
  moving: '<rect x="12" y="38" width="24" height="6" rx="2"/><path d="M14 38V18h4v20M30 38V18h4v20"/><rect x="16" y="12" width="16" height="18" rx="4"/>',
  bar: '<rect x="4" y="18" width="40" height="12" rx="3"/><path d="M10 24h0M17 24h0M24 24h0M31 24h0M38 24h0" stroke-width="4" stroke-linecap="round"/>',
  profile: '<path d="M6 18h22l10-6v24l-10-6H6z"/><path d="M14 30v10M8 40h12"/>',
  strobe: '<rect x="8" y="12" width="32" height="18" rx="3"/><path d="M26 15l-6 7h6l-6 7"/><path d="M24 30v10M16 40h16"/>',
};
