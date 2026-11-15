// Bibliothèque d'attributs GDTF (noms officiels reconnus par grandMA3).
// name    : nom GDTF exact (c'est lui que MA3 utilise pour classer le canal)
// label   : libellé en français affiché dans l'appli
// feature : FeatureGroup.Feature
// group   : ActivationGroup éventuel
// unit    : PhysicalUnit GDTF
// phys    : plage physique par défaut [de, à]

export const ATTRIBUTES = [
  // Intensité
  { name: 'Dimmer', label: 'Intensité (dimmer)', feature: 'Dimmer.Dimmer', unit: 'LuminousIntensity', phys: [0, 1] },

  // Position
  { name: 'Pan', label: 'Pan', feature: 'Position.PanTilt', group: 'PanTilt', unit: 'Angle', phys: [-270, 270] },
  { name: 'Tilt', label: 'Tilt', feature: 'Position.PanTilt', group: 'PanTilt', unit: 'Angle', phys: [-135, 135] },
  { name: 'PanRotate', label: 'Rotation Pan continue', feature: 'Position.PanTilt', unit: 'AngularSpeed', phys: [-360, 360] },
  { name: 'TiltRotate', label: 'Rotation Tilt continue', feature: 'Position.PanTilt', unit: 'AngularSpeed', phys: [-360, 360] },

  // Couleur – mélange
  { name: 'ColorAdd_R', label: 'Rouge', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorAdd_G', label: 'Vert', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorAdd_B', label: 'Bleu', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorAdd_W', label: 'Blanc', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorAdd_WW', label: 'Blanc chaud', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorAdd_CW', label: 'Blanc froid', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorAdd_A', label: 'Ambre', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorAdd_UV', label: 'UV', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorAdd_L', label: 'Lime', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorSub_C', label: 'Cyan (soustractif)', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorSub_M', label: 'Magenta (soustractif)', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },
  { name: 'ColorSub_Y', label: 'Jaune (soustractif)', feature: 'Color.RGB', group: 'ColorRGB', unit: 'ColorComponent', phys: [0, 1] },

  // Couleur – autres
  { name: 'Color1', label: 'Roue de couleurs 1', feature: 'Color.Color', unit: 'None', phys: [0, 1] },
  { name: 'Color2', label: 'Roue de couleurs 2', feature: 'Color.Color', unit: 'None', phys: [0, 1] },
  { name: 'Color1WheelSpin', label: 'Roue de couleurs 1 – rotation', feature: 'Color.Color', unit: 'AngularSpeed', phys: [-360, 360] },
  { name: 'CTO', label: 'CTO (correction orange)', feature: 'Color.Color', unit: 'None', phys: [0, 1] },
  { name: 'CTB', label: 'CTB (correction bleue)', feature: 'Color.Color', unit: 'None', phys: [0, 1] },
  { name: 'CTC', label: 'Température de couleur (CTC)', feature: 'Color.Color', unit: 'Temperature', phys: [8000, 2500] },
  { name: 'Tint', label: 'Tint (± vert)', feature: 'Color.Color', unit: 'None', phys: [-1, 1] },
  { name: 'ColorMacro1', label: 'Macros couleur', feature: 'Color.Color', unit: 'None', phys: [0, 1] },

  // Gobos
  { name: 'Gobo1', label: 'Roue de gobos 1', feature: 'Gobo.Gobo', group: 'Gobo1', unit: 'None', phys: [0, 1] },
  { name: 'Gobo1Pos', label: 'Gobo 1 – index', feature: 'Gobo.Gobo', group: 'Gobo1', unit: 'Angle', phys: [0, 360] },
  { name: 'Gobo1PosRotate', label: 'Gobo 1 – rotation', feature: 'Gobo.Gobo', group: 'Gobo1', unit: 'AngularSpeed', phys: [-360, 360] },
  { name: 'Gobo1WheelSpin', label: 'Roue de gobos 1 – rotation de la roue', feature: 'Gobo.Gobo', group: 'Gobo1', unit: 'AngularSpeed', phys: [-360, 360] },
  { name: 'Gobo2', label: 'Roue de gobos 2', feature: 'Gobo.Gobo', group: 'Gobo2', unit: 'None', phys: [0, 1] },
  { name: 'Gobo2Pos', label: 'Gobo 2 – index', feature: 'Gobo.Gobo', group: 'Gobo2', unit: 'Angle', phys: [0, 360] },
  { name: 'Gobo2PosRotate', label: 'Gobo 2 – rotation', feature: 'Gobo.Gobo', group: 'Gobo2', unit: 'AngularSpeed', phys: [-360, 360] },
  { name: 'Gobo2WheelSpin', label: 'Roue de gobos 2 – rotation de la roue', feature: 'Gobo.Gobo', group: 'Gobo2', unit: 'AngularSpeed', phys: [-360, 360] },

  // Faisceau
  { name: 'Shutter1', label: 'Shutter (ouvert/fermé)', feature: 'Beam.Beam', unit: 'None', phys: [0, 1] },
  { name: 'Shutter1Strobe', label: 'Strobe', feature: 'Beam.Beam', unit: 'Frequency', phys: [0, 25] },
  { name: 'Shutter1StrobeRandom', label: 'Strobe aléatoire', feature: 'Beam.Beam', unit: 'Frequency', phys: [0, 25] },
  { name: 'Shutter1StrobePulse', label: 'Pulse', feature: 'Beam.Beam', unit: 'Frequency', phys: [0, 25] },
  { name: 'Iris', label: 'Iris', feature: 'Beam.Beam', unit: 'None', phys: [0, 1] },
  { name: 'Frost1', label: 'Frost', feature: 'Beam.Beam', unit: 'None', phys: [0, 1] },
  { name: 'Prism1', label: 'Prisme', feature: 'Beam.Beam', group: 'Prism', unit: 'None', phys: [0, 1] },
  { name: 'Prism1PosRotate', label: 'Prisme – rotation', feature: 'Beam.Beam', group: 'Prism', unit: 'AngularSpeed', phys: [-360, 360] },

  // Effets (macros d'effets intégrés : choix, vitesse, réglages 1 à 9)
  { name: 'Effects1', label: 'Effet 1 – choix', feature: 'Beam.Beam', unit: 'None', phys: [0, 1] },
  { name: 'Effects1Rate', label: 'Effet 1 – vitesse', feature: 'Beam.Beam', unit: 'None', phys: [-1, 1] },
  ...Array.from({ length: 9 }, (_, i) => ({
    name: `Effects1Adjust${i + 1}`, label: `Effet 1 – réglage ${i + 1}`, feature: 'Beam.Beam', unit: 'None', phys: [0, 1],
  })),

  // Focus
  { name: 'Zoom', label: 'Zoom', feature: 'Focus.Focus', unit: 'Angle', phys: [5, 50] },
  { name: 'Focus1', label: 'Focus (net)', feature: 'Focus.Focus', unit: 'None', phys: [0, 1] },

  // Contrôle
  { name: 'Control1', label: 'Contrôle / fonctions', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
  { name: 'Control2', label: 'Contrôle 2', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
  { name: 'Control3', label: 'Contrôle 3', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
  { name: 'FixtureGlobalReset', label: 'Reset', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
  { name: 'LampControl', label: 'Lampe on/off', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
  { name: 'DimmerCurve', label: 'Courbe de gradation', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
  { name: 'PositionMSpeed', label: 'Vitesse des moteurs', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
  { name: 'Fans', label: 'Ventilateurs', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
  { name: 'NoFeature', label: 'Aucune fonction / canal inutilisé', feature: 'Control.Control', unit: 'None', phys: [0, 1] },
];

// Un canal entier « NoFeature » réserve juste une adresse : il n'est pas écrit dans le GDTF.
export const UNUSED = 'NoFeature';

const BY_NAME = new Map(ATTRIBUTES.map(a => [a.name, a]));

// Attributs GDTF venus d'un fichier importé, absents de la bibliothèque
const EXTRA = new Map();

export function registerAttributes(defs) {
  if (!defs) return;
  for (const [name, d] of Object.entries(defs)) {
    if (!BY_NAME.has(name)) EXTRA.set(name, { ...d, name });
  }
}

export function extraAttributes() {
  return [...EXTRA.values()];
}

// Attribut inconnu (saisi à la main) : on le range dans Contrôle.
export function getAttribute(name) {
  return BY_NAME.get(name) || EXTRA.get(name) ||
    { name, label: name, feature: 'Control.Control', unit: 'None', phys: [0, 1], custom: true };
}

export function attributeLabel(name) {
  const a = BY_NAME.get(name) || EXTRA.get(name);
  return a ? a.label : name;
}

export function isKnownAttribute(name) {
  return BY_NAME.has(name) || EXTRA.has(name);
}

// Géométrie GDTF qui porte le canal (pour une lyre : Pan sur la fourche, Tilt sur la tête).
export function geometryFor(attrName, kind) {
  if (kind === 'moving') {
    if (attrName === 'Pan' || attrName === 'PanRotate') return 'Yoke';
    if (attrName === 'Tilt' || attrName === 'TiltRotate') return 'Head';
  }
  return 'Beam';
}

// Noms déjà pris par la structure de base du projecteur
export const RESERVED_GEOMETRIES = ['Base', 'Yoke', 'Head', 'Beam'];

// Nom GDTF d'un sous-élément (pas de point : il sert dans les chemins GDTF)
export function partGeometryName(part) {
  return String(part.name ?? '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
}

// Géométrie d'un canal : Pan/Tilt restent sur la lyre, le reste va sur son sous-élément s'il en a un.
export function channelGeometry(c, fx) {
  const g = geometryFor(c.attribute, fx.kind);
  if (g !== 'Beam') return g;
  const p = c.part && (fx.parts || []).find(x => x.id === c.part);
  return p ? partGeometryName(p) : 'Beam';
}
