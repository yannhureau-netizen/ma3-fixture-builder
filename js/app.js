import { ATTRIBUTES, getAttribute, attributeLabel, registerAttributes, extraAttributes, isKnownAttribute, UNUSED } from './attributes.js';
import { newFixture, newChannel, newFunction, newWheel, newSlot, uid, TEMPLATES, CELL_TEMPLATES, makeCellChannels, footprint, validate, advise, linkWheels, deriveMode, cloneMode, functionGroups, functionEnd, condKey, fillSetsFromWheel } from './model.js';
import { evaluate, describe, preview } from './tester.js';
import { renderPrintSheet } from './print.js';
import { STARTERS, STARTER_ICONS, buildStarter } from './starters.js';
import { buildGdtf, buildDescriptionXml, gdtfFileName, makeUuid } from './gdtf.js';
import { importGdtf } from './gdtf-import.js';
import { toPngDataUrl, isHex } from './color.js';
import { loadAll, saveAll, loadPrefs, savePrefs } from './storage.js';
import { SHAPES, ORDERS, arrangeParts, clearLayout, hasLayout, layoutSvg, fitGroups, isGroup } from './layout.js';
import { dmxState, detectDmx, buildFrame, scheduleDmx, startDmx, stopDmx } from './dmx-out.js';
import { loadCatalog, searchCatalog, parseOflUrl, fetchOflFixture, convertOfl, prettyKey } from './ofl.js';

const app = document.getElementById('app');

const state = {
  fixtures: loadAll(),
  view: 'home',          // 'home' | 'starter' (choix du modèle) | 'edit' | 'print' (fiche imprimable)
  search: '',            // recherche sur l'accueil
  testValues: {},        // testeur DMX : valeur de chaque canal (par id)
  derive: null,          // panneau « mode dérivé » : { name, to8bit, keep: Set(id) }
  currentId: null,
  step: 1,               // 1 Projecteur, 2 Roues, 3 Canaux, 4 Tester, 5 Export
  importNotes: [],       // remarques affichées après l'ouverture d'un .gdtf
  modeIdx: 0,
  open: new Set(),       // canaux dont les plages sont dépliées
  prefs: loadPrefs(),
  saveFailed: false,
  cellsCount: 4,         // assistant « cellules identiques »
  cellsTpl: 'rgb',
  layoutShape: 'line',   // disposition des sous-éléments
  layoutCols: 4,
  layoutOrder: 'normal',
  layoutReverse: false,
  ofl: { status: 'idle', items: [], mans: {}, time: 0, error: '', query: '', busy: false },   // bibliothèque OFL
  targetPart: '',        // sous-élément où les boutons « + … » ajoutent les canaux
};

const GROUP_LABELS = {
  Dimmer: 'Intensité', Position: 'Position', Color: 'Couleur', Gobo: 'Gobos',
  Beam: 'Faisceau', Focus: 'Zoom / Focus', Control: 'Contrôle',
};
const LAMP_TYPES = [['LED', 'LED'], ['Discharge', 'Lampe à décharge'], ['Halogen', 'Halogène'], ['Tungsten', 'Tungstène']];
const BEAM_TYPES = [['Spot', 'Spot'], ['Wash', 'Wash'], ['PC', 'PC'], ['Fresnel', 'Fresnel'], ['Glow', 'Effet / Glow']];

// ---------- utilitaires ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fx = () => state.fixtures.find(f => f.id === state.currentId);
const mode = () => fx().modes[state.modeIdx];
const clone = o => JSON.parse(JSON.stringify(o));

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

let saveTimer;
function scheduleSave() {
  const f = fx();
  if (f) f.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.saveFailed = !saveAll(state.fixtures);
    const s = document.querySelector('[data-save-status]');
    if (s) s.textContent = state.saveFailed ? 'Sauvegarde impossible dans ce navigateur' : 'Enregistré';
  }, 300);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Fin d'une plage (dans sa variante, si le canal a des plages conditionnelles)
const rangeEnd = functionEnd;
function addressLabel(m, ci) {
  let a = 1;
  for (let i = 0; i < ci; i++) a += m.channels[i].fine ? 2 : 1;
  return m.channels[ci].fine ? `${a}-${a + 1}` : `${a}`;
}

// ---------- composants ----------
function attrSelect(bind, value) {
  const known = isKnownAttribute(value);
  let h = `<select data-bind="${bind}" data-kind="attr" aria-label="Fonction">`;
  for (const [g, label] of Object.entries(GROUP_LABELS)) {
    h += `<optgroup label="${label}">`;
    for (const a of ATTRIBUTES.filter(x => x.feature.startsWith(g + '.'))) {
      h += `<option value="${a.name}"${a.name === value ? ' selected' : ''}>${esc(a.label)}</option>`;
    }
    h += '</optgroup>';
  }
  const extras = extraAttributes();
  if (extras.length) {
    h += '<optgroup label="Venus d\'un fichier importé">';
    for (const a of extras) h += `<option value="${esc(a.name)}"${a.name === value ? ' selected' : ''}>${esc(a.label)} (${esc(a.name)})</option>`;
    h += '</optgroup>';
  }
  h += `<option value="__custom"${known ? '' : ' selected'}>Autre (nom GDTF)…</option></select>`;
  if (!known) h += `<input class="custom-attr" data-bind="${bind}" data-kind="text" value="${esc(value)}" placeholder="ex. Effects1" aria-label="Nom GDTF">`;
  return h;
}

function field(label, bind, value, { type = 'text', hint = '', required = false, attrs = '' } = {}) {
  return `<label class="field"><span>${label}${required ? ' <b class="req">*</b>' : ''}</span>
    <input type="${type}" data-bind="${bind}" data-kind="${type === 'number' ? 'num' : 'text'}" value="${esc(value)}" ${attrs}>
    ${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function selectField(label, bind, value, options) {
  return `<label class="field"><span>${label}</span><select data-bind="${bind}" data-kind="text">
    ${options.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}
  </select></label>`;
}

// ---------- écran d'accueil ----------
const SORTS = [['recent', 'Modifiés récemment'], ['maker', 'Fabricant (A → Z)'], ['name', 'Nom (A → Z)']];

function sortedFixtures() {
  const by = state.prefs.sort || 'recent';
  const txt = s => String(s || '').toLocaleLowerCase('fr');
  const list = [...state.fixtures];
  if (by === 'maker') list.sort((a, b) => txt(a.manufacturer).localeCompare(txt(b.manufacturer), 'fr') || txt(a.name).localeCompare(txt(b.name), 'fr'));
  else if (by === 'name') list.sort((a, b) => txt(a.name).localeCompare(txt(b.name), 'fr'));
  else list.sort((a, b) => b.updatedAt - a.updatedAt);
  return list;
}

// Recherche sans tenir compte des accents ni des majuscules, sur fabricant, nom, nom court et notes
function matches(f, q) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hay = norm(`${f.manufacturer} ${f.name} ${f.shortName} ${f.description}`);
  return norm(q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function cardHtml(f) {
  return `
      <article class="card">
        <div class="card-body" data-action="open" data-id="${f.id}" role="button" tabindex="0">
          ${f.thumbnail ? `<img class="card-thumb" src="${f.thumbnail}" alt="">` : ''}
          <div class="card-maker">${esc(f.manufacturer) || '<i>Fabricant ?</i>'}</div>
          <div class="card-name">${esc(f.name) || '<i>Sans nom</i>'}</div>
          <div class="muted small">${f.kind === 'moving' ? 'Lyre' : 'Fixe'} · ${f.modes.length} mode${f.modes.length > 1 ? 's' : ''} · ${f.modes.slice(0, 6).map(m => footprint(m) + ' adr.').join(', ')}${f.modes.length > 6 ? '…' : ''}${f.parts && f.parts.length ? ` · ${f.parts.length} sous-élément${f.parts.length > 1 ? 's' : ''}` : ''}</div>
        </div>
        <div class="card-tools">
          <button class="btn small" data-action="open" data-id="${f.id}">Ouvrir</button>
          <button class="btn small" data-action="dup-fixture" data-id="${f.id}">Dupliquer</button>
          <button class="btn small danger" data-action="del-fixture" data-id="${f.id}">Supprimer</button>
        </div>
      </article>`;
}

function renderCards() {
  const list = sortedFixtures().filter(f => matches(f, state.search));
  if (!list.length) return '<div id="cards" class="empty small-empty">Aucun projecteur ne correspond à cette recherche.</div>';
  return `<div id="cards" class="cards">${list.map(cardHtml).join('')}</div>`;
}

function renderHome() {
  const list = state.fixtures;
  return `
  <section class="home">
    <div class="home-head">
      <div>
        <h1>Mes projecteurs</h1>
        <p class="muted">Crée la fiche d'un projecteur absent de la bibliothèque grandMA3, puis exporte-la en fichier .gdtf.</p>
      </div>
      <div class="row">
        <button class="btn primary big" data-action="new">+ Nouveau projecteur</button>
        <button class="btn" data-action="ofl" title="Chercher une fiche toute faite dans l'Open Fixture Library et la convertir">Bibliothèque OFL</button>
        <label class="btn" title="Ouvrir un fichier GDTF (par exemple venu de GDTF Share) pour le corriger">Ouvrir un fichier .gdtf<input type="file" accept=".gdtf,application/zip" data-file="gdtf" hidden></label>
        <label class="btn">Importer une sauvegarde<input type="file" accept=".json,application/json" data-file="import" hidden></label>
        ${list.length ? '<button class="btn" data-action="backup-all">Tout sauvegarder</button>' : ''}
      </div>
    </div>
    ${list.length ? `
    <div class="home-tools">
      <input type="search" class="search" data-ui="search" value="${esc(state.search)}" placeholder="Rechercher (fabricant, nom…)" aria-label="Rechercher un projecteur">
      <label class="mini">Trier
        <select data-sort>${SORTS.map(([v, l]) => `<option value="${v}"${(state.prefs.sort || 'recent') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <span class="muted small">${list.length} projecteur${list.length > 1 ? 's' : ''}</span>
    </div>
    ${renderCards()}` : `
      <div class="empty">
        <h2>Comment ça marche ?</h2>
        <ol class="steps-help">
          <li><b>Projecteur</b> : fabricant, nom, lyre ou fixe.</li>
          <li><b>Roues</b> (facultatif) : couleurs et images des gobos.</li>
          <li><b>Canaux DMX</b> : ajoute les canaux dans l'ordre de la doc du fabricant, avec les boutons tout prêts.</li>
          <li><b>Tester</b> : bouge les faders et vérifie que chaque valeur fait ce que dit la doc.</li>
          <li><b>Exporter</b> : télécharge le fichier .gdtf et importe-le dans grandMA3, ou imprime la fiche DMX.</li>
        </ol>
        <p class="muted small">Tu as déjà un fichier .gdtf à corriger ? Utilise « Ouvrir un fichier .gdtf » en haut.</p>
        <button class="btn primary big" data-action="new">Créer mon premier projecteur</button>
      </div>`}
  </section>`;
}

// ---------- choix du modèle de départ ----------
function starterSummary(s) {
  if (s.key === 'blank') return '';
  const f = s.build();
  return `${f.modes.length} mode${f.modes.length > 1 ? 's' : ''} : ${f.modes.map(m => footprint(m)).join(', ')} adr.`;
}

function renderStarter() {
  return `
  <section class="home">
    <div class="home-head">
      <div>
        <h1>Nouveau projecteur</h1>
        <p class="muted">Choisis un point de départ. Tu pourras tout modifier ensuite : noms, canaux, plages, modes…</p>
      </div>
      <button class="btn" data-action="home">Annuler</button>
    </div>
    <button class="ofl-banner" data-action="ofl">
      <b>Le projecteur existe peut-être déjà dans l'Open Fixture Library</b>
      <span class="muted small">Des centaines de fiches libres à convertir en un clic : c'est souvent plus rapide que de partir de zéro.</span>
    </button>
    <div class="cards starters">
      ${STARTERS.map(s => `
      <button class="starter${s.key === 'blank' ? ' blank' : ''}" data-action="start" data-key="${s.key}">
        <svg viewBox="0 0 48 48" aria-hidden="true">${STARTER_ICONS[s.icon]}</svg>
        <b>${esc(s.label)}</b>
        <small>${esc(s.desc)}</small>
        <span class="muted small">${starterSummary(s)}</span>
      </button>`).join('')}
    </div>
  </section>`;
}

// ---------- éditeur ----------
function renderEditor() {
  const f = fx();
  const issues = validate(f);
  const errors = issues.filter(i => i.level === 'error').length;
  const steps = ['Projecteur', 'Roues', 'Canaux DMX', 'Tester', 'Exporter'];
  const last = steps.length;
  return `
  <div class="topbar">
    <button class="btn ghost" data-action="home">← Mes projecteurs</button>
    <div class="title" data-title>${esc(f.manufacturer || 'Fabricant')} · ${esc(f.name || 'Nouveau projecteur')}</div>
    <span class="muted small" data-save-status>${state.saveFailed ? 'Sauvegarde impossible dans ce navigateur' : 'Enregistré'}</span>
  </div>
  <nav class="stepper">
    ${steps.map((s, i) => `<button class="step${state.step === i + 1 ? ' active' : ''}" data-action="step" data-step="${i + 1}">
      <span class="num">${i + 1}</span>${s}${i === last - 1 && errors ? ` <span class="badge" data-errcount>${errors}</span>` : ''}</button>`).join('')}
  </nav>
  ${state.importNotes.length ? `
  <div class="alert warn notes">
    <b>Fichier ouvert. À savoir :</b>
    <ul>${state.importNotes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    <button class="btn small" data-action="dismiss-notes">J'ai compris</button>
  </div>` : ''}
  <section class="panel">
    ${state.step === 1 ? renderStep1(f) : state.step === 2 ? renderWheels(f) : state.step === 3 ? renderStep2(f) : state.step === 4 ? renderTester(f) : renderStep3(f, issues)}
  </section>
  <div class="footer-nav">
    ${state.step > 1 ? `<button class="btn" data-action="step" data-step="${state.step - 1}">← Étape précédente</button>` : '<span></span>'}
    ${state.step < last ? `<button class="btn primary" data-action="step" data-step="${state.step + 1}">Étape suivante →</button>` : ''}
  </div>`;
}

// ---------- étape 2 : roues ----------
const WHEEL_KINDS = [['color', 'Couleurs'], ['gobo', 'Gobos'], ['other', 'Autre (prisme, animation…)']];

function swatch(slot, kind) {
  if (kind === 'gobo' && slot.image) return `<img class="gobo-thumb" src="${slot.image}" alt="">`;
  const c = isHex(slot.color) ? slot.color : '#ffffff';
  return `<span class="swatch" style="background:${c}"></span>`;
}

function wheelUsage(f, id) {
  return f.modes.reduce((n, m) => n + m.channels.reduce((k, c) => k + c.functions.filter(fn => fn.wheel === id).length, 0), 0);
}

function renderWheels(f) {
  return `
  <h2>2. Roues de couleurs et de gobos <span class="muted small">(facultatif)</span></h2>
  <p class="muted">Si le projecteur a des roues, décris-les ici : grandMA3 affichera les vraies couleurs et les images des gobos. Sinon, passe à l'étape suivante.</p>
  <div class="row wheel-add">
    <button class="btn" data-action="add-wheel" data-wkind="color">+ Roue de couleurs</button>
    <button class="btn" data-action="add-wheel" data-wkind="gobo">+ Roue de gobos</button>
    <button class="btn" data-action="add-wheel" data-wkind="other">+ Autre roue</button>
  </div>
  ${f.wheels.length ? f.wheels.map((w, wi) => {
    const used = wheelUsage(f, w.id);
    return `
    <div class="wheel">
      <div class="wheel-head">
        <label class="mini grow">Nom <input type="text" data-bind="wheels.${wi}.name" data-kind="text" value="${esc(w.name)}"></label>
        <label class="mini">Type <select data-bind="wheels.${wi}.kind" data-kind="text">${WHEEL_KINDS.map(([v, l]) => `<option value="${v}"${v === w.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <span class="muted small">${w.slots.length} fente${w.slots.length > 1 ? 's' : ''} · ${used ? `utilisée par ${used} plage${used > 1 ? 's' : ''}` : 'pas encore reliée à un canal'}</span>
        <button class="icon danger" title="Supprimer cette roue" data-action="del-wheel" data-id="${w.id}">✕</button>
      </div>
      <ol class="slots">
        ${w.slots.map((s, si) => {
          const sp = `wheels.${wi}.slots.${si}`;
          return `
          <li class="slot">
            <span class="slot-num">${si + 1}</span>
            ${w.kind === 'gobo' ? `
              <span class="gobo-box">${s.image ? `<img class="gobo-thumb" src="${s.image}" alt="Gobo ${si + 1}">` : '<span class="gobo-empty" title="Pas d\'image">?</span>'}</span>
              <label class="btn small">${s.image ? 'Changer' : 'Image…'}<input type="file" accept="image/*" data-file="slot-image" data-path="${sp}" hidden></label>
              ${s.image ? `<button class="icon" title="Retirer l'image" data-action="slot-img-clear" data-path="${sp}">⌫</button>` : ''}`
            : `<input type="color" class="color-in" data-bind="${sp}.color" data-kind="text" value="${isHex(s.color) ? s.color : '#ffffff'}" title="Couleur de la fente">`}
            <input type="text" class="slot-name" data-bind="${sp}.name" data-kind="text" value="${esc(s.name)}" placeholder="Nom de la fente" aria-label="Nom de la fente ${si + 1}">
            <span class="slot-tools">
              <button class="icon" title="Monter" data-action="slot-up" data-wi="${wi}" data-si="${si}"${si === 0 ? ' disabled' : ''}>↑</button>
              <button class="icon" title="Descendre" data-action="slot-down" data-wi="${wi}" data-si="${si}"${si === w.slots.length - 1 ? ' disabled' : ''}>↓</button>
              <button class="icon danger" title="Supprimer la fente" data-action="slot-del" data-wi="${wi}" data-si="${si}">✕</button>
            </span>
          </li>`;
        }).join('')}
      </ol>
      <button class="btn small" data-action="slot-add" data-wi="${wi}">+ Ajouter une fente</button>
    </div>`;
  }).join('') : '<div class="empty small-empty">Aucune roue. Si ton projecteur n\'en a pas, passe simplement à l\'étape suivante.</div>'}
  <p class="muted small">Ensuite, à l'étape « Canaux DMX », ouvre les plages du canal de la roue et choisis la roue : un bouton remplit alors les réglages avec les fentes.</p>`;
}

function renderStep1(f) {
  return `
  <h2>1. Le projecteur</h2>
  <div class="grid2">
    ${field('Fabricant', 'manufacturer', f.manufacturer, { required: true, attrs: 'placeholder="ex. Chauvet" autocomplete="off"' })}
    ${field('Nom du modèle', 'name', f.name, { required: true, attrs: 'placeholder="ex. Rogue R2 Spot" autocomplete="off"' })}
    ${field('Nom court', 'shortName', f.shortName, { hint: 'Affiché dans les petites cases de MA3. Laisse vide pour reprendre le nom.', attrs: 'maxlength="16"' })}
    ${field('Révision', 'revision', f.revision, { type: 'number', hint: 'Augmente ce numéro à chaque nouvelle version du fichier.', attrs: 'min="1" step="1"' })}
  </div>
  ${field('Notes', 'description', f.description, { attrs: 'placeholder="ex. créé d\'après la doc v1.2"' })}

  <h3>Type de projecteur</h3>
  <div class="choice">
    <button class="choice-card${f.kind === 'moving' ? ' active' : ''}" data-action="kind" data-kind="moving">
      <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="12" y="38" width="24" height="6" rx="2"/><path d="M14 38V18h4v20M30 38V18h4v20" /><rect x="16" y="12" width="16" height="18" rx="4"/></svg>
      <b>Lyre</b><small>Tête motorisée (Pan / Tilt)</small></button>
    <button class="choice-card${f.kind === 'fixed' ? ' active' : ''}" data-action="kind" data-kind="fixed">
      <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="14" width="28" height="20" rx="4"/><path d="M38 20l6-3v14l-6-3"/><path d="M24 34v8M16 42h16"/></svg>
      <b>Fixe</b><small>PAR, barre LED, découpe…</small></button>
  </div>

  <h3>Source lumineuse</h3>
  <div class="grid3">
    ${selectField('Type de source', 'lampType', f.lampType, LAMP_TYPES)}
    ${selectField('Type de faisceau', 'beamType', f.beamType, BEAM_TYPES)}
    ${field('Puissance (W)', 'power', f.power, { type: 'number', attrs: 'min="0"' })}
    ${field('Angle du faisceau (°)', 'beamAngle', f.beamAngle, { type: 'number', attrs: 'min="0" max="180"' })}
  </div>

  <h3>Photo et caractéristiques <span class="muted small">(facultatif)</span></h3>
  <div class="phys">
    <div class="thumb-box">
      ${f.thumbnail ? `<img class="thumb-big" src="${f.thumbnail}" alt="Photo du projecteur">` : '<div class="thumb-empty">Pas de photo</div>'}
      <div class="row">
        <label class="btn small">${f.thumbnail ? 'Changer la photo' : 'Ajouter une photo…'}<input type="file" accept="image/*" data-file="thumbnail" hidden></label>
        ${f.thumbnail ? '<button class="btn small danger" data-action="thumb-clear">Retirer</button>' : ''}
      </div>
    </div>
    <div class="phys-fields">
      <div class="grid4">
        ${field('Longueur (mm)', 'length', f.length || '', { type: 'number', attrs: 'min="0" placeholder="—"' })}
        ${field('Largeur (mm)', 'width', f.width || '', { type: 'number', attrs: 'min="0" placeholder="—"' })}
        ${field('Hauteur (mm)', 'height', f.height || '', { type: 'number', attrs: 'min="0" placeholder="—"' })}
        ${field('Poids (kg)', 'weight', f.weight || '', { type: 'number', attrs: 'min="0" step="0.1" placeholder="—"' })}
      </div>
      <p class="muted small">La photo s'affiche dans le Patch de grandMA3 pour reconnaître le projecteur. Les dimensions donnent sa taille dans la vue 3D.</p>
    </div>
  </div>
  ${renderParts(f)}`;
}

function partUsage(f, id) {
  return f.modes.reduce((n, m) => n + m.channels.filter(c => c.part === id).length, 0);
}

function renderParts(f) {
  const parts = f.parts;
  return `
  <h3>Sous-éléments <span class="muted small">(optionnel)</span></h3>
  <p class="muted small">Pour les projecteurs qui ont plusieurs zones pilotées séparément : pixels d'une barre LED, anneau ou calque d'effet, couleur de fond… Dans grandMA3, chaque sous-élément devient une sous-partie du projecteur, avec sa propre intensité et ses propres couleurs.</p>
  ${parts.length ? `<div class="parts">${parts.map((p, i) => {
    const n = partUsage(f, p.id);
    return `
    <div class="part-row">
      <span class="part-num">${i + 1}</span>
      <input type="text" data-bind="parts.${i}.name" data-kind="text" value="${esc(p.name)}" placeholder="ex. Anneau" aria-label="Nom du sous-élément">
      ${isGroup(f, p) ? `<span class="muted small xy-group" title="Un groupe se place au centre de ses pixels">suit ses pixels</span>` : `<label class="xy" title="Position le long de la longueur, en mm depuis le centre">X <input type="number" step="any" data-bind="parts.${i}.x" data-kind="num" value="${Number(p.x) || 0}" aria-label="Position X (mm)"></label>
      <label class="xy" title="Position le long de la largeur, en mm depuis le centre">Y <input type="number" step="any" data-bind="parts.${i}.y" data-kind="num" value="${Number(p.y) || 0}" aria-label="Position Y (mm)"></label>`}
      <span class="muted small">${n} ${n > 1 ? 'canaux' : 'canal'}</span>
      <button class="icon danger" title="Supprimer ce sous-élément" data-action="del-part" data-id="${p.id}">✕</button>
    </div>`;
  }).join('')}</div>` : ''}
  <button class="btn small" data-action="add-part">+ Ajouter un sous-élément</button>
  ${parts.length ? renderLayoutBox(f) : ''}
  <div class="cells-box">
    <b>Barre LED / projecteur à pixels</b>
    <p class="muted small">Crée d'un coup plusieurs cellules identiques avec leurs canaux, ajoutés à la suite dans le mode « ${esc(mode().name)} ».</p>
    <div class="row">
      <label class="mini">Nombre <input type="number" min="1" max="128" data-ui="cellsCount" value="${state.cellsCount}"></label>
      <label class="mini">Chaque cellule
        <select data-ui="cellsTpl">${CELL_TEMPLATES.map(t => `<option value="${t.key}"${t.key === state.cellsTpl ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      </label>
      <button class="btn small primary" data-action="make-cells">Créer les cellules</button>
    </div>
  </div>`;
}

// Disposition des sous-éléments (pixels) dans le projecteur, vue de face
function renderLayoutBox(f) {
  const grid = state.layoutShape === 'grid';
  const laid = hasLayout(f);
  // les groupes de pixels suivent leurs pixels : ils ne sont pas disposés eux-mêmes
  const groups = f.parts.filter(p => isGroup(f, p)).length;
  const cells = f.parts.length - groups;
  return `
  <div class="cells-box layout-box">
    <b>Disposition</b>
    <p class="muted small">Place les sous-éléments dans le projecteur, vu de face : grandMA3 les affiche à cet endroit dans la vue 3D. L'appli utilise la longueur et la largeur indiquées plus haut, et l'ordre de la liste (le n° 1 en premier). Tu peux ensuite corriger X et Y à la main.${groups ? ` Les ${groups} groupes de pixels (en pointillés) suivent leurs pixels.` : ''}</p>
    <div class="row">
      <label class="mini">Forme
        <select data-ui="layoutShape" data-rerender>${SHAPES.map(([v, l]) => `<option value="${v}"${v === state.layoutShape ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      ${grid ? `
      <label class="mini">Colonnes <input type="number" min="1" max="128" data-ui="layoutCols" value="${state.layoutCols}"></label>
      <label class="mini">Ordre
        <select data-ui="layoutOrder">${ORDERS.map(([v, l]) => `<option value="${v}"${v === state.layoutOrder ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </label>` : ''}
      ${state.layoutShape !== 'ring' ? `<label class="mini check"><input type="checkbox" data-ui="layoutReverse"${state.layoutReverse ? ' checked' : ''}> De droite à gauche</label>` : ''}
      <button class="btn small primary" data-action="layout-apply">Disposer les ${cells} élément${cells > 1 ? 's' : ''}</button>
      ${laid ? '<button class="btn small" data-action="layout-clear">Tout remettre au centre</button>' : ''}
    </div>
    <div class="layout-view" data-layout>${laid ? layoutSvg(f) : '<p class="muted small">Pas encore de disposition : tous les éléments sont au centre du projecteur.</p>'}</div>
  </div>`;
}

function partOptions(f, selected, mainLabel = 'Projecteur principal') {
  return `<option value="">${mainLabel}</option>` +
    f.parts.map(p => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.name || 'Sans nom')}</option>`).join('');
}

function renderStep2(f) {
  if (state.modeIdx >= f.modes.length) state.modeIdx = 0;
  const m = mode();
  const mi = state.modeIdx;
  return `
  <div class="step2-head">
    <h2>3. Les canaux DMX</h2>
    <label class="switch"><input type="checkbox" data-pref="advanced"${state.prefs.advanced ? ' checked' : ''}> Réglages avancés</label>
  </div>
  <div class="tabs">
    ${f.modes.map((md, i) => `<button class="tab${i === mi ? ' active' : ''}" data-action="mode" data-idx="${i}">${esc(md.name || 'Mode')} <span class="muted small">${footprint(md)} adr.</span></button>`).join('')}
    <button class="tab add" data-action="add-mode">+ Mode</button>
  </div>
  <div class="mode-bar">
    ${field('Nom du mode', `modes.${mi}.name`, m.name, { attrs: 'placeholder="ex. 16 canaux"' })}
    <div class="row">
      <span class="pill" data-footprint>${footprint(m)} adresses DMX</span>
      <button class="btn small" data-action="dup-mode">Dupliquer ce mode</button>
      ${m.channels.length ? '<button class="btn small" data-action="derive-open">Créer un mode dérivé…</button>' : ''}
      ${f.modes.length > 1 ? '<button class="btn small danger" data-action="del-mode">Supprimer ce mode</button>' : ''}
    </div>
  </div>

  ${state.derive ? renderDerive(f, m) : ''}

  <div class="templates">
    <div class="tpl-head">
      <div class="muted small">Ajoute les canaux <b>dans l'ordre</b> de la doc du fabricant :</div>
      ${f.parts.length ? `<label class="mini">Ajouter sur <select data-ui="targetPart">${partOptions(f, state.targetPart)}</select></label>` : ''}
    </div>
    <div class="tpl-list">
      ${TEMPLATES.map(t => `<button class="btn tpl" data-action="tpl" data-key="${t.key}">+ ${esc(t.label)}</button>`).join('')}
    </div>
  </div>

  ${m.channels.length ? `<ol class="channels">${m.channels.map((c, ci) => renderChannel(f, m, mi, c, ci)).join('')}</ol>` :
    '<div class="empty small-empty">Aucun canal pour l\'instant. Clique sur un bouton ci-dessus, par exemple « + Intensité ».</div>'}`;
}

function channelCaption(f, c) {
  const part = c.part ? f.parts.find(p => p.id === c.part) : null;
  return `${attributeLabel(c.attribute)}${part ? ` · ${part.name}` : ''}${c.fine ? ' · 16 bits' : ''}`;
}

function renderDerive(f, m) {
  const d = state.derive;
  let addr = 1;
  const rows = m.channels.map(c => {
    const a = addr;
    addr += c.fine ? 2 : 1;
    return `<label class="derive-row"><input type="checkbox" data-derive="keep" data-id="${c.id}"${d.keep.has(c.id) ? ' checked' : ''}>
      <span class="addr">${c.fine ? `${a}-${a + 1}` : a}</span> ${esc(channelCaption(f, c))}</label>`;
  }).join('');
  const kept = m.channels.filter(c => d.keep.has(c.id));
  const size = kept.reduce((n, c) => n + (c.fine && !d.to8bit ? 2 : 1), 0);
  return `
  <div class="derive">
    <b>Nouveau mode à partir de « ${esc(m.name)} »</b>
    <p class="muted small">Pratique quand la doc propose plusieurs modes proches : version 8 bits, mode réduit… Le mode d'origine n'est pas modifié.</p>
    <div class="derive-top">
      <label class="field"><span>Nom du nouveau mode</span><input type="text" data-derive="name" value="${esc(d.name)}"></label>
      <label class="chk"><input type="checkbox" data-derive="to8bit"${d.to8bit ? ' checked' : ''}> Passer tous les canaux 16 bits en 8 bits</label>
    </div>
    <div class="row small-gap">
      <span class="muted small">Canaux à garder :</span>
      <button class="btn small ghost" data-action="derive-all">Tout cocher</button>
      <button class="btn small ghost" data-action="derive-none">Tout décocher</button>
    </div>
    <div class="derive-list">${rows}</div>
    <div class="row">
      <span class="pill">${kept.length} ${kept.length > 1 ? 'canaux' : 'canal'} · ${size} adresses DMX</span>
      <button class="btn primary" data-action="derive-create"${kept.length ? '' : ' disabled'}>Créer le mode</button>
      <button class="btn" data-action="derive-cancel">Annuler</button>
    </div>
  </div>`;
}

function renderChannel(f, m, mi, c, ci) {
  const base = `modes.${mi}.channels.${ci}`;
  const open = state.open.has(c.id);
  const nf = c.functions.length;
  return `
  <li class="ch${open ? ' open' : ''}${c.part ? ' on-part' : ''}">
    <div class="ch-main">
      <span class="addr" title="Adresse DMX">${addressLabel(m, ci)}</span>
      <div class="ch-attr">${attrSelect(`${base}.attribute`, c.attribute)}</div>
      ${f.parts.length ? `<select class="part-sel" data-bind="${base}.part" data-kind="text" title="Sous-élément" aria-label="Sous-élément">${partOptions(f, c.part || '', 'Principal')}</select>` : ''}
      <label class="chk" title="Canal fin (16 bits) : utilise 2 adresses"><input type="checkbox" data-bind="${base}.fine" data-kind="bool"${c.fine ? ' checked' : ''}> 16 bits</label>
      <label class="def" title="Valeur au démarrage (0-255)">Défaut <input type="number" min="0" max="255" data-bind="${base}.defaultValue" data-kind="num" value="${c.defaultValue}"></label>
      <button class="btn small${nf > 1 ? ' has' : ''}" data-action="toggle" data-id="${c.id}" aria-expanded="${open}">Plages${nf > 1 ? ` (${nf})` : ''} ${open ? '▴' : '▾'}</button>
      <div class="ch-tools">
        <button class="icon" title="Monter" data-action="ch-up" data-ci="${ci}"${ci === 0 ? ' disabled' : ''}>↑</button>
        <button class="icon" title="Descendre" data-action="ch-down" data-ci="${ci}"${ci === m.channels.length - 1 ? ' disabled' : ''}>↓</button>
        <button class="icon" title="Dupliquer" data-action="ch-dup" data-ci="${ci}">⧉</button>
        <button class="icon danger" title="Supprimer" data-action="ch-del" data-ci="${ci}">✕</button>
      </div>
    </div>
    ${open ? renderRanges(f, c, base) : ''}
  </li>`;
}

function renderRanges(fxObj, c, base) {
  if (c.attribute === UNUSED) {
    return '<div class="ranges"><p class="muted small">Canal inutilisé : il réserve juste son adresse DMX, rien n\'est envoyé à MA3 pour lui.</p></div>';
  }
  const adv = state.prefs.advanced;
  const modeObj = getPath(fxObj, base.split('.').slice(0, 2).join('.'));
  const others = modeObj.channels.filter(x => x.id !== c.id && x.attribute !== UNUSED);
  // Plages groupées par variante (sans condition d'abord), triées ; on garde l'index réel pour l'édition.
  const groups = [...functionGroups(c).entries()];
  const multi = groups.length > 1;
  const variantHead = (key, list) => {
    if (!key) return multi ? '<div class="variant-head"><b>Cas général</b> <span class="muted small">(quand aucune variante ci-dessous ne s\'applique)</span></div>' : '';
    const cond = list[0].cond;
    return `
    <div class="variant-head cond">
      <b>Variante</b> active quand
      <select data-cond="master" data-path="${base}" data-gkey="${key}" aria-label="Canal maître">
        ${others.map((o, k) => `<option value="${o.id}"${o.id === cond.master ? ' selected' : ''}>${esc(addressLabel(modeObj, modeObj.channels.indexOf(o)))} · ${esc(attributeLabel(o.attribute))}</option>`).join('')}
      </select>
      est entre <input type="number" min="0" max="255" data-cond="from" data-path="${base}" data-gkey="${key}" value="${cond.from}" aria-label="De">
      et <input type="number" min="0" max="255" data-cond="to" data-path="${base}" data-gkey="${key}" value="${cond.to}" aria-label="À">
      <button class="icon danger" title="Supprimer cette variante" data-action="variant-del" data-path="${base}" data-gkey="${key}">✕</button>
    </div>`;
  };
  return `
  <div class="ranges">
    <p class="muted small">Découpe le canal comme dans la doc : chaque plage commence à une valeur DMX et va jusqu'à la suivante.</p>
    ${groups.map(([key, list]) => `<div class="variant${key ? ' is-cond' : ''}">${variantHead(key, list)}${list.map(f => {
      const i = c.functions.indexOf(f);
      const fb = `${base}.functions.${i}`;
      const wheel = f.wheel ? fxObj.wheels.find(w => w.id === f.wheel) : null;
      return `
      <div class="range">
        <div class="range-main">
          <label class="mini">De <input type="number" min="0" max="255" data-bind="${fb}.from" data-kind="num" value="${f.from}"></label>
          <span class="mini">à <b data-to="${fb}">${rangeEnd(c, f)}</b></span>
          <label class="mini grow">Nom <input type="text" data-bind="${fb}.name" data-kind="text" value="${esc(f.name)}" placeholder="${esc(attributeLabel(f.attribute))}"></label>
          <label class="mini grow">Fonction ${attrSelect(`${fb}.attribute`, f.attribute)}</label>
          ${adv ? `
          <label class="mini" title="Valeur physique au début de la plage (ex. degrés, Hz)">Phys. de <input type="number" step="any" data-bind="${fb}.physFrom" data-kind="num" value="${f.physFrom}"></label>
          <label class="mini" title="Valeur physique à la fin de la plage">à <input type="number" step="any" data-bind="${fb}.physTo" data-kind="num" value="${f.physTo}"></label>` : ''}
          ${c.functions.length > 1 ? `<button class="icon danger" title="Supprimer la plage" data-action="fn-del" data-path="${fb}">✕</button>` : ''}
        </div>
        ${fxObj.wheels.length ? `
        <div class="range-wheel">
          <label class="mini">Roue
            <select data-bind="${fb}.wheel" data-kind="text">
              <option value="">Aucune</option>
              ${fxObj.wheels.map(w => `<option value="${w.id}"${w.id === f.wheel ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}
            </select>
          </label>
          ${wheel ? `<button class="btn small" data-action="fill-sets" data-path="${fb}">Créer un réglage par fente (${wheel.slots.length})</button>` : ''}
        </div>` : ''}
        <div class="sets">
          ${f.sets.map((s, si) => {
            const slot = wheel && s.slot > 0 ? wheel.slots[s.slot - 1] : null;
            return `
            <div class="set">
              <label class="mini">DMX <input type="number" min="0" max="255" data-bind="${fb}.sets.${si}.from" data-kind="num" value="${s.from}"></label>
              <label class="mini grow">Nom <input type="text" data-bind="${fb}.sets.${si}.name" data-kind="text" value="${esc(s.name)}" placeholder="ex. Gobo 1"></label>
              ${wheel ? `
              <label class="mini">Fente
                ${slot ? swatch(slot, wheel.kind) : ''}
                <select data-bind="${fb}.sets.${si}.slot" data-kind="num">
                  <option value="0">—</option>
                  ${wheel.slots.map((ws, k) => `<option value="${k + 1}"${s.slot === k + 1 ? ' selected' : ''}>${k + 1} · ${esc(ws.name || 'Fente')}</option>`).join('')}
                </select>
              </label>` : ''}
              <button class="icon danger" title="Supprimer" data-action="set-del" data-path="${fb}" data-si="${si}">✕</button>
            </div>`;
          }).join('')}
          <button class="btn small ghost" data-action="set-add" data-path="${fb}">+ Réglage nommé (ex. un gobo, une couleur)</button>
        </div>
      </div>`;
    }).join('')}
    <button class="btn small" data-action="fn-add" data-path="${base}" data-gkey="${key}">+ Ajouter une plage${key ? ' à cette variante' : ''}</button>
    </div>`).join('')}
    ${(adv || multi) && others.length ? `
    <div class="variant-add">
      <button class="btn small ghost" data-action="variant-add" data-path="${base}">+ Variante conditionnelle</button>
      <span class="muted small">Pour un canal dont le comportement change selon un autre canal (ex. index ou rotation du gobo selon la position de la roue).</span>
    </div>` : ''}
  </div>`;
}

function renderStep3(f, issues) {
  const errors = issues.filter(i => i.level === 'error');
  const warns = issues.filter(i => i.level === 'warn');
  return `
  <h2>5. Exporter</h2>
  ${errors.length ? `<div class="alert error"><b>À corriger avant d'exporter :</b><ul>${errors.map(e => `<li>${esc(e.text)}</li>`).join('')}</ul></div>` :
    '<div class="alert ok"><b>Tout est bon !</b> Le fichier peut être exporté.</div>'}
  ${warns.length ? `<div class="alert warn"><ul>${warns.map(e => `<li>${esc(e.text)}</li>`).join('')}</ul></div>` : ''}
  ${(() => {
    const tips = advise(f);
    if (!tips.length) return '';
    const shown = tips.slice(0, 40);
    return `
  <details class="alert tip"${tips.length <= 8 ? ' open' : ''}>
    <summary><b>Conseils (${tips.length})</b> <span class="muted small">— rien de bloquant, mais ça vaut un coup d'œil</span></summary>
    <ul>${shown.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${tips.length > shown.length ? `<p class="muted small">… et ${tips.length - shown.length} autre(s).</p>` : ''}
  </details>`;
  })()}

  <div class="summary">
    <div><span class="muted small">Projecteur</span><b>${esc(f.manufacturer)} ${esc(f.name)}</b></div>
    ${f.modes.map(m => `<div><span class="muted small">${esc(m.name)}</span><b>${footprint(m)} adresses</b></div>`).join('')}
  </div>

  <div class="row">
    <button class="btn primary big" data-action="export"${errors.length ? ' disabled' : ''}>⬇ Télécharger ${esc(gdtfFileName(f))}</button>
    <button class="btn" data-action="print">🖨 Fiche DMX imprimable</button>
    <button class="btn" data-action="backup-one">Sauvegarder le projet (.json)</button>
  </div>

  <h3>Importer dans grandMA3</h3>
  <ol class="howto">
    <li>Copie le fichier <b>.gdtf</b> sur une clé USB, dans le dossier <code>grandMA3/gma3_library/fixturetypes</code> (crée les dossiers s'ils n'existent pas).</li>
    <li>Branche la clé sur la console, ouvre le <b>Patch</b>, puis l'onglet <b>Fixture Types</b>.</li>
    <li>Appuie sur <b>Import</b>, choisis la clé USB puis ton fichier.</li>
    <li>Ton projecteur est maintenant disponible pour le patcher.</li>
  </ol>
  <p class="muted small">Conseil : fais un premier essai sur grandMA3 onPC (gratuit) avant d'aller sur la console du spectacle.</p>

  <details class="xml">
    <summary>Voir le contenu technique (description.xml)</summary>
    <pre>${esc(buildDescriptionXml(f))}</pre>
  </details>`;
}

// ---------- étape 4 : testeur DMX ----------
function testValue(c) {
  const v = state.testValues[c.id];
  return v == null ? (Number(c.defaultValue) || 0) : v;
}

function valueOfFor(m) {
  const byId = new Map(m.channels.map(c => [c.id, c]));
  return id => (byId.has(id) ? testValue(byId.get(id)) : null);
}

const fr = (x, d = 1) => Number(x).toLocaleString('fr-FR', { maximumFractionDigits: d });

function previewHtml(f, m) {
  const p = preview(f, m, valueOfFor(m));
  const main = p.zones[0];
  const parts = p.zones.slice(1);
  const blink = z => (z.strobe ? ` strobe" style="background:${z.css};animation-duration:${Math.max(0.04, 1 / z.strobe).toFixed(3)}s` : `" style="background:${z.css}`);
  const state1 = main.closed ? 'Shutter fermé' : main.strobe ? `Strobe ${fr(main.strobe)} Hz` : `Intensité ${Math.round(main.level * 100)} %`;
  return `
    <div class="t-stage">
      <div class="t-beam${blink(main)}">${main.gobo ? `<img src="${main.gobo}" alt="Gobo actif">` : ''}</div>
      <div class="t-info">
        <b>${state1}</b>
        ${p.pan != null ? `<div>Pan ${fr(p.pan)}°</div>` : ''}
        ${p.tilt != null ? `<div>Tilt ${fr(p.tilt)}°</div>` : ''}
      </div>
    </div>
    ${parts.length && hasLayout(f) ? `<div class="t-layout">${layoutSvg(f, { dots: partDots(f, parts), numbers: f.parts.length <= 48 })}</div>`
    : parts.length ? `<div class="t-parts">${parts.map(z => `<div class="t-part" title="${esc(z.name)}"><span class="t-dot${blink(z)}"></span><small>${esc(z.name)}</small></div>`).join('')}</div>` : ''}`;
}

// Couleur de chaque sous-élément pour le schéma de disposition (masqué s'il n'a pas de canal dans ce mode)
function partDots(f, zones) {
  const byKey = new Map(zones.map(z => [z.key, z]));
  return f.parts.map(p => {
    const z = byKey.get(p.id);
    if (!z) return { hide: true };   // pas de canal dans ce mode
    return z.strobe
      ? { fill: z.css, cls: 'strobe', style: `animation-duration:${Math.max(0.04, 1 / z.strobe).toFixed(3)}s` }
      : { fill: z.css };
  });
}

function renderTester(f) {
  if (state.modeIdx >= f.modes.length) state.modeIdx = 0;
  const m = mode();
  const mi = state.modeIdx;
  const valueOf = valueOfFor(m);
  return `
  <h2>4. Tester</h2>
  <p class="muted">Bouge les faders comme sur la console : l'appli affiche la plage et le réglage actifs, avec un aperçu du résultat. Vérifie que ça correspond à la doc du fabricant.</p>
  <div class="tabs">
    ${f.modes.map((md, i) => `<button class="tab${i === mi ? ' active' : ''}" data-action="mode" data-idx="${i}">${esc(md.name || 'Mode')} <span class="muted small">${footprint(md)} adr.</span></button>`).join('')}
  </div>
  ${m.channels.length ? renderDmxBox(m) : ''}
  ${m.channels.length ? `
  <div class="tester">
    <div class="t-preview" id="t-preview">${previewHtml(f, m)}</div>
    <div class="t-list">
      <div class="row t-actions">
        <button class="btn small" data-action="test-defaults">Valeurs par défaut</button>
        <button class="btn small" data-action="test-full">Plein feu</button>
        <button class="btn small" data-action="test-zero">Tout à 0</button>
      </div>
      ${m.channels.map((c, ci) => {
        const v = testValue(c);
        if (c.attribute === UNUSED) return `<div class="t-row unused"><span class="addr">${addressLabel(m, ci)}</span><span class="t-name muted">Canal inutilisé</span></div>`;
        return `
        <div class="t-row">
          <span class="addr">${addressLabel(m, ci)}</span>
          <span class="t-name">${esc(channelCaption(f, c))}</span>
          <input type="range" min="0" max="255" value="${v}" data-tval="${c.id}" aria-label="Valeur de ${esc(attributeLabel(c.attribute))}">
          <input type="number" min="0" max="255" value="${v}" data-tval="${c.id}" class="t-num" aria-label="Valeur">
          <span class="t-out" data-tout="${c.id}">${esc(describe(c, evaluate(c, v, valueOf), f))}</span>
        </div>`;
      }).join('')}
    </div>
  </div>` : '<div class="empty small-empty">Ce mode n\'a pas encore de canal.</div>'}`;
}

// ---------- sortie Art-Net / sACN (avec le serveur local) ----------
function dmxCfg() {
  const d = state.prefs.dmx || {};
  return {
    proto: d.proto === 'sacn' ? 'sacn' : 'artnet',
    iface: d.iface || '',
    dest: d.dest || '',
    universeArt: Number.isFinite(Number(d.universeArt)) ? Number(d.universeArt) : 0,
    universeSacn: Number(d.universeSacn) >= 1 ? Number(d.universeSacn) : 1,
    address: Number(d.address) >= 1 ? Number(d.address) : 1,
  };
}

function setDmxCfg(patch) {
  state.prefs.dmx = { ...dmxCfg(), ...patch };
  savePrefs(state.prefs);
}

// Trame envoyée : le mode affiché, avec les valeurs des faders
function currentFrame() {
  const f = fx();
  if (!f || state.view !== 'edit') return null;
  const m = mode();
  const cfg = dmxCfg();
  return { cfg, data: buildFrame(m, testValue, cfg.address) };
}

function renderDmxBox(m) {
  const s = dmxState();
  if (!s.checked) {
    detectDmx().then(ok => {
      // première fois : on choisit une carte réseau probable (réseau 2.x ou 10.x d'abord) et sa diffusion
      if (ok && !dmxCfg().iface && s.interfaces.length) {
        const pick = s.interfaces.find(i => /^(2|10)\./.test(i.ip)) || s.interfaces[0];
        setDmxCfg({ iface: pick.ip, dest: pick.broadcast });
      }
      if (state.view === 'edit' && state.step === 4) render();
    });
    return '<div class="dmx-box"><span class="muted small">Recherche de la sortie réseau…</span></div>';
  }
  if (!s.available) {
    return `
    <details class="dmx-box">
      <summary>Piloter le vrai projecteur (Art-Net / sACN)</summary>
      <p class="muted small">Disponible seulement quand l'appli tourne sur ton PC, lancée avec <b>« Lancer l'appli.bat »</b> : c'est ce petit serveur qui envoie le DMX sur le réseau. Un navigateur seul (comme la version en ligne) ne peut pas le faire.</p>
    </details>`;
  }
  const cfg = dmxCfg();
  const fp = footprint(m);
  const end = cfg.address + fp - 1;
  const art = cfg.proto === 'artnet';
  const ifaceKnown = s.interfaces.some(i => i.ip === cfg.iface);
  const ifaceOpts = [['', 'Automatique']].concat(s.interfaces.map(i => [i.ip, `${i.name} — ${i.ip}`]));
  if (cfg.iface && !ifaceKnown) ifaceOpts.push([cfg.iface, `${cfg.iface} (absente)`]);
  const univ = art ? cfg.universeArt : cfg.universeSacn;
  return `
  <details class="dmx-box${s.on ? ' on' : ''}"${s.on || s.error ? ' open' : ''}>
    <summary>Piloter le vrai projecteur (Art-Net / sACN)${s.on ? ' <span class="dmx-live">● envoi en cours</span>' : ''}</summary>
    <p class="muted small">Les faders ci-dessous pilotent le projecteur branché sur le réseau, pour vérifier la fiche avant de passer à la console. Règle le projecteur sur la même adresse DMX et le même univers.</p>
    <div class="dmx-grid">
      <label class="mini">Protocole
        <select data-dmx="proto"><option value="artnet"${art ? ' selected' : ''}>Art-Net</option><option value="sacn"${art ? '' : ' selected'}>sACN (E1.31)</option></select>
      </label>
      <label class="mini">Carte réseau
        <select data-dmx="iface">${ifaceOpts.map(([v, l]) => `<option value="${esc(v)}"${v === cfg.iface ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </label>
      ${art ? `<label class="mini" title="Adresse de diffusion de la carte (tous les nodes), ou l'adresse IP d'un node précis">Envoyer vers
        <input type="text" data-dmx="dest" value="${esc(cfg.dest || '255.255.255.255')}" inputmode="decimal" autocomplete="off" spellcheck="false">
      </label>` : ''}
      <label class="mini" title="${art ? 'Numérotation Art-Net : 0 = premier univers' : 'Numérotation sACN : 1 = premier univers'}">Univers ${art ? 'Art-Net' : 'sACN'}
        <input type="number" data-dmx="${art ? 'universeArt' : 'universeSacn'}" min="${art ? 0 : 1}" max="${art ? 32767 : 63999}" value="${univ}">
      </label>
      <label class="mini">Adresse DMX
        <input type="number" data-dmx="address" min="1" max="512" value="${cfg.address}">
      </label>
      <button class="btn ${s.on ? 'danger' : 'primary'}" data-action="dmx-toggle"${end > 512 ? ' disabled' : ''}>${s.on ? '■ Arrêter l\'envoi' : '▶ Envoyer au projecteur'}</button>
    </div>
    <p class="small ${end > 512 ? 'dmx-err' : 'muted'}">${end > 512
      ? `Le mode occupe ${fp} adresses : à partir de l'adresse ${cfg.address}, il dépasse la fin de l'univers (512).`
      : `Adresses ${cfg.address} à ${end} (${fp} canaux)${art ? ` · Art-Net univers ${univ} (${Math.floor(univ / 256)}:${Math.floor(univ / 16) % 16}:${univ % 16})` : ` · sACN univers ${univ}, multidiffusion 239.255.${Math.floor(univ / 256)}.${univ % 256}`}.`}</p>
    ${s.error ? `<p class="small dmx-err">${esc(s.error)}</p>` : ''}
    <p class="muted small">À l'arrêt, l'appli envoie des zéros. Si grandMA3 envoie aussi sur cet univers, le projecteur reçoit les deux : coupe la sortie de la console ou prends un autre univers pendant le test.</p>
  </details>`;
}

// Mise à jour pendant qu'on bouge un fader (sans tout redessiner, pour ne pas lâcher le fader)
function updateTester() {
  scheduleDmx();
  const f = fx();
  const m = mode();
  const valueOf = valueOfFor(m);
  for (const c of m.channels) {
    const el = app.querySelector(`[data-tout="${c.id}"]`);
    if (el) el.textContent = describe(c, evaluate(c, testValue(c), valueOf), f);
  }
  const pv = document.getElementById('t-preview');
  if (pv) pv.innerHTML = previewHtml(f, m);
}

// Plein feu : intensités à fond, shutters sur leur première plage ouverte
function fullOnValues(m) {
  const vals = {};
  for (const c of m.channels) {
    if (c.attribute === UNUSED) continue;
    if (c.attribute === 'Dimmer') { vals[c.id] = 255; continue; }
    const shut = c.functions.filter(fn => !fn.cond && fn.attribute === 'Shutter1').sort((a, b) => a.from - b.from);
    const open = shut.find(fn => Number(fn.physFrom) >= 0.5 && Number(fn.physTo) >= 0.5);   // plage franchement ouverte
    const ramp = shut.find(fn => Number(fn.physTo) >= 0.5);                                  // sinon : fin d'une plage qui s'ouvre
    if (open) vals[c.id] = open.from;
    else if (ramp) vals[c.id] = functionEnd(c, ramp);
  }
  return vals;
}

// ---------- fiche imprimable ----------
function renderPrint(f) {
  return `
  <div class="print-toolbar">
    <button class="btn" data-action="print-back">← Retour</button>
    <button class="btn primary" data-action="print-go">🖨 Imprimer / Enregistrer en PDF</button>
    <span class="muted small">Pour un fichier PDF, choisis « Enregistrer au format PDF » comme imprimante.</span>
  </div>
  ${renderPrintSheet(f)}`;
}

// ---------- rendu ----------
function render() {
  // la sortie réseau ne continue que dans l'éditeur ; sinon on suit les changements (mode, boutons…)
  if (dmxState().on) {
    if (state.view !== 'edit') stopDmx();
    else scheduleDmx();
  }
  const a = document.activeElement;
  const focusBind = a && a.dataset && a.dataset.bind ? { bind: a.dataset.bind, tag: a.tagName } : null;
  app.innerHTML = state.view === 'home' ? renderHome()
    : state.view === 'starter' ? renderStarter()
    : state.view === 'ofl' ? renderOfl()
    : state.view === 'print' ? renderPrint(fx())
    : renderEditor();
  document.body.classList.toggle('printing', state.view === 'print');
  if (focusBind) {
    const el = [...app.querySelectorAll(`[data-bind="${CSS.escape(focusBind.bind)}"]`)].find(e => e.tagName === focusBind.tag);
    if (el) el.focus({ preventScroll: true });
  }
}

// Mises à jour légères pendant la frappe (sans tout redessiner, pour ne pas perdre le curseur)
function refreshDerived() {
  const f = fx();
  if (!f) return;
  const t = app.querySelector('[data-title]');
  if (t) t.textContent = `${f.manufacturer || 'Fabricant'} · ${f.name || 'Nouveau projecteur'}`;
  app.querySelectorAll('[data-to]').forEach(el => {
    const path = el.dataset.to;
    const fnObj = getPath(f, path);
    const chObj = getPath(f, path.split('.').slice(0, -2).join('.'));
    if (fnObj && chObj) el.textContent = rangeEnd(chObj, fnObj);
  });
  const lay = app.querySelector('[data-layout]');
  if (lay && hasLayout(f)) { fitGroups(f); lay.innerHTML = layoutSvg(f); }
  const badge = app.querySelector('[data-errcount]');
  if (badge) badge.textContent = validate(f).filter(i => i.level === 'error').length;
}

function valueFrom(el) {
  const kind = el.dataset.kind;
  if (kind === 'bool') return el.checked;
  if (kind === 'num') return el.value === '' ? 0 : Number(el.value);
  return el.value;
}

// Quand on change la fonction d'un canal, on met à jour sa plage unique en conséquence.
function onAttributeChange(path, oldVal, newVal) {
  const f = fx();
  const isChannel = /^modes\.\d+\.channels\.\d+\.attribute$/.test(path);
  const isFunction = /\.functions\.\d+\.attribute$/.test(path);
  const def = getAttribute(newVal).phys;
  if (isChannel) {
    const ch = getPath(f, path.replace(/\.attribute$/, ''));
    ch.functions.forEach(fn => {
      if (fn.attribute === oldVal) {
        fn.attribute = newVal;
        fn.physFrom = def[0];
        fn.physTo = def[1];
      }
    });
  } else if (isFunction) {
    const fn = getPath(f, path.replace(/\.attribute$/, ''));
    fn.physFrom = def[0];
    fn.physTo = def[1];
  }
}

// ---------- événements ----------
app.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.tval) {
    const v = Math.max(0, Math.min(255, Math.round(Number(el.value) || 0)));
    state.testValues[el.dataset.tval] = v;
    app.querySelectorAll(`[data-tval="${el.dataset.tval}"]`).forEach(x => { if (x !== el) x.value = v; });
    updateTester();
    return;
  }
  if (el.dataset.dmx) {
    // réglages de la sortie réseau : appliqués tout de suite, redessin au « change »
    const k = el.dataset.dmx;
    if (k === 'dest') setDmxCfg({ dest: el.value.trim() });
    else if (el.type === 'number') setDmxCfg({ [k]: Math.round(Number(el.value)) || 0 });
    scheduleDmx();
    return;
  }
  if (el.dataset.ui === 'oflQuery') {
    state.ofl.query = el.value;
    const box = document.getElementById('ofl-results');
    if (box) box.outerHTML = oflResultsHtml();
    return;
  }
  if (el.dataset.ui === 'search') {
    state.search = el.value;
    const cards = document.getElementById('cards');
    if (cards) cards.outerHTML = renderCards();
    return;
  }
  if (el.dataset.derive === 'name' && state.derive) {
    state.derive.name = el.value;
    return;
  }
  if (el.dataset.ui && el.tagName !== 'SELECT') {
    state[el.dataset.ui] = el.type === 'number' ? Number(el.value) : el.type === 'checkbox' ? el.checked : el.value;
    return;
  }
  if (!el.dataset.bind || el.tagName === 'SELECT' || el.type === 'checkbox') return;
  setPath(fx(), el.dataset.bind, valueFrom(el));
  scheduleSave();
  refreshDerived();
});

app.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.pref) {
    state.prefs[el.dataset.pref] = el.checked;
    savePrefs(state.prefs);
    render();
    return;
  }
  if (el.dataset.tval || el.dataset.ui === 'search' || el.dataset.ui === 'oflQuery') return;
  if (el.dataset.file === 'ofl') {
    const file = el.files[0];
    el.value = '';
    if (file) {
      openOfl(async () => {
        let json;
        try { json = JSON.parse(await file.text()); } catch { throw new Error('fichier JSON illisible'); }
        return { json, man: '', key: file.name.replace(/\.json$/i, '') };
      });
    }
    return;
  }
  if (el.dataset.dmx) {
    const k = el.dataset.dmx;
    if (k === 'proto') setDmxCfg({ proto: el.value });
    if (k === 'iface') {
      const i = dmxState().interfaces.find(x => x.ip === el.value);
      setDmxCfg({ iface: el.value, dest: i ? i.broadcast : '255.255.255.255' });
    }
    scheduleDmx();
    render();
    return;
  }
  if (el.hasAttribute('data-sort')) {
    state.prefs.sort = el.value;
    savePrefs(state.prefs);
    render();
    return;
  }
  if (el.dataset.cond) {
    // condition d'une variante : on l'applique à toutes les plages de la variante
    const ch = getPath(fx(), el.dataset.path);
    const list = ch.functions.filter(f => condKey(f) === el.dataset.gkey);
    const v = el.dataset.cond === 'master' ? el.value : Math.max(0, Math.min(255, Math.round(Number(el.value) || 0)));
    list.forEach(f => { f.cond[el.dataset.cond] = v; });
    scheduleSave();
    render();
    return;
  }
  if (el.dataset.ui) {
    if (el.tagName === 'SELECT') state[el.dataset.ui] = el.value;
    if (el.hasAttribute('data-rerender')) render();
    return;
  }
  if (el.dataset.derive && state.derive) {
    if (el.dataset.derive === 'to8bit') state.derive.to8bit = el.checked;
    if (el.dataset.derive === 'keep') el.checked ? state.derive.keep.add(el.dataset.id) : state.derive.keep.delete(el.dataset.id);
    if (el.dataset.derive !== 'name') render();
    return;
  }
  if (el.dataset.file === 'thumbnail') {
    setThumbnail(el.files[0]);
    el.value = '';
    return;
  }
  if (el.dataset.file === 'import') {
    importFile(el.files[0]);
    el.value = '';
    return;
  }
  if (el.dataset.file === 'gdtf') {
    openGdtf(el.files[0]);
    el.value = '';
    return;
  }
  if (el.dataset.file === 'slot-image') {
    setSlotImage(el.dataset.path, el.files[0]);
    el.value = '';
    return;
  }
  if (!el.dataset.bind) return;
  if (el.tagName === 'SELECT' || el.type === 'checkbox') {
    const path = el.dataset.bind;
    let v = valueFrom(el);
    if (el.dataset.kind === 'attr') {
      if (v === '__custom') v = '';
      const old = getPath(fx(), path);
      setPath(fx(), path, v);
      onAttributeChange(path, old, v);
    } else {
      setPath(fx(), path, v);
    }
    scheduleSave();
    render();
  } else if (el.type === 'number') {
    // une fois la saisie terminée, on retrie l'affichage si besoin
    scheduleSave();
    refreshDerived();
  }
});

app.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card-body')) {
    e.preventDefault();
    e.target.click();
  }
});

app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const act = el.dataset.action;
  const f = fx();
  switch (act) {
    case 'new':
      state.view = 'starter';
      window.scrollTo(0, 0);
      break;
    case 'ofl':
      state.view = 'ofl';
      window.scrollTo(0, 0);
      break;
    case 'ofl-reload':
      loadOflCatalog(true);
      return;
    case 'ofl-open': {
      if (state.ofl.busy) return;
      const { man, key } = el.dataset;
      openOfl(() => fetchOflFixture(man, key));
      return;
    }
    case 'start': {
      const nf = buildStarter(el.dataset.key);
      state.fixtures.push(nf);
      openFixture(nf.id);
      scheduleSave();
      return;
    }
    case 'thumb-clear':
      f.thumbnail = '';
      scheduleSave();
      break;
    case 'derive-open': {
      const m = mode();
      state.derive = { name: `${m.name} (8 bits)`, to8bit: true, keep: new Set(m.channels.map(c => c.id)) };
      break;
    }
    case 'derive-all':
      state.derive.keep = new Set(mode().channels.map(c => c.id));
      break;
    case 'derive-none':
      state.derive.keep = new Set();
      break;
    case 'derive-cancel':
      state.derive = null;
      break;
    case 'derive-create': {
      const d = state.derive;
      const name = d.name.trim() || `${mode().name} (copie)`;
      f.modes.push(deriveMode(mode(), { name, to8bit: d.to8bit, keepIds: d.keep }));
      state.modeIdx = f.modes.length - 1;
      state.derive = null;
      scheduleSave();
      window.scrollTo(0, 0);
      break;
    }
    case 'open': openFixture(el.dataset.id); return;
    case 'home': state.view = 'home'; state.currentId = null; break;
    case 'dup-fixture': {
      const src = state.fixtures.find(x => x.id === el.dataset.id);
      const copy = clone(src);
      copy.id = uid();
      copy.uuid = makeUuid();
      copy.name = (copy.name || 'Projecteur') + ' (copie)';
      copy.updatedAt = Date.now();
      state.fixtures.push(copy);
      scheduleSave();
      break;
    }
    case 'del-fixture': {
      const src = state.fixtures.find(x => x.id === el.dataset.id);
      if (!confirm(`Supprimer « ${src.manufacturer} ${src.name} » ? Cette action est définitive.`)) return;
      state.fixtures = state.fixtures.filter(x => x.id !== el.dataset.id);
      saveAll(state.fixtures);
      break;
    }
    case 'backup-all':
      download(new Blob([JSON.stringify(state.fixtures, null, 2)], { type: 'application/json' }), `ma3-fixture-builder-sauvegarde.json`);
      return;
    case 'backup-one':
      download(new Blob([JSON.stringify([f], null, 2)], { type: 'application/json' }), gdtfFileName(f).replace(/\.gdtf$/, '.json'));
      return;
    case 'step': state.step = Number(el.dataset.step); window.scrollTo(0, 0); break;
    case 'kind': f.kind = el.dataset.kind; scheduleSave(); break;
    case 'mode': state.modeIdx = Number(el.dataset.idx); state.derive = null; break;
    case 'add-mode':
      f.modes.push({ id: uid(), name: `Mode ${f.modes.length + 1}`, channels: [] });
      state.modeIdx = f.modes.length - 1;
      scheduleSave();
      break;
    case 'dup-mode': {
      const copy = cloneMode(mode(), `${mode().name} (copie)`);
      f.modes.splice(state.modeIdx + 1, 0, copy);
      state.modeIdx++;
      scheduleSave();
      break;
    }
    case 'del-mode':
      if (!confirm(`Supprimer le mode « ${mode().name} » ?`)) return;
      f.modes.splice(state.modeIdx, 1);
      state.modeIdx = Math.max(0, state.modeIdx - 1);
      scheduleSave();
      break;
    case 'tpl': {
      const t = TEMPLATES.find(x => x.key === el.dataset.key);
      const chans = t.make();
      if (state.targetPart && f.parts.some(p => p.id === state.targetPart)) chans.forEach(c => { c.part = state.targetPart; });
      // Roue de couleurs / gobos : on la relie tout seul à la roue correspondante si elle existe
      linkWheels(f, chans);
      mode().channels.push(...chans);
      if (t.key === 'other') state.open.add(chans[0].id);
      scheduleSave();
      break;
    }
    case 'toggle':
      state.open.has(el.dataset.id) ? state.open.delete(el.dataset.id) : state.open.add(el.dataset.id);
      break;
    case 'ch-up': case 'ch-down': {
      const ci = Number(el.dataset.ci);
      const to = act === 'ch-up' ? ci - 1 : ci + 1;
      const chs = mode().channels;
      [chs[ci], chs[to]] = [chs[to], chs[ci]];
      scheduleSave();
      break;
    }
    case 'ch-dup': {
      const ci = Number(el.dataset.ci);
      const copy = clone(mode().channels[ci]);
      copy.id = uid();
      mode().channels.splice(ci + 1, 0, copy);
      scheduleSave();
      break;
    }
    case 'ch-del':
      mode().channels.splice(Number(el.dataset.ci), 1);
      scheduleSave();
      break;
    case 'fn-add': {
      const ch = getPath(f, el.dataset.path);
      const key = el.dataset.gkey || '';
      const group = ch.functions.filter(x => condKey(x) === key);
      const last = group.length ? Math.max(...group.map(x => x.from)) : -10;
      const nf = newFunction(ch.attribute || 'Control1', Math.min(255, last + 10));
      if (key && group[0]) nf.cond = { ...group[0].cond };
      ch.functions.push(nf);
      scheduleSave();
      break;
    }
    case 'variant-add': {
      const ch = getPath(f, el.dataset.path);
      const m = mode();
      const master = m.channels.find(x => x.id !== ch.id && x.attribute !== UNUSED);
      if (!master) return;
      // une plage de 0 à 255, active quand le maître est dans une zone pas encore utilisée
      const used = new Set(ch.functions.filter(x => x.cond).map(x => `${x.cond.master}|${x.cond.from}`));
      let from = 0;
      while (used.has(`${master.id}|${from}`) && from < 255) from += 64;
      const nf = newFunction(ch.attribute || 'Control1', 0, 'Variante');
      nf.cond = { master: master.id, from, to: Math.min(255, from + 63) };
      ch.functions.push(nf);
      state.open.add(ch.id);
      scheduleSave();
      break;
    }
    case 'variant-del': {
      const ch = getPath(f, el.dataset.path);
      const key = el.dataset.gkey;
      const n = ch.functions.filter(x => condKey(x) === key).length;
      if (n >= ch.functions.length) { alert('Il faut garder au moins une variante dans le canal.'); return; }
      if (!confirm(`Supprimer cette variante et ses ${n} plage(s) ?`)) return;
      ch.functions = ch.functions.filter(x => condKey(x) !== key);
      scheduleSave();
      break;
    }
    case 'dmx-toggle':
      if (dmxState().on) stopDmx();
      else startDmx(currentFrame);
      break;
    case 'test-defaults':
      state.testValues = {};
      break;
    case 'test-zero':
      state.testValues = Object.fromEntries(mode().channels.map(c => [c.id, 0]));
      break;
    case 'test-full':
      state.testValues = fullOnValues(mode());
      break;
    case 'print':
      state.view = 'print';
      window.scrollTo(0, 0);
      break;
    case 'print-go':
      window.print();
      return;
    case 'print-back':
      state.view = 'edit';
      break;
    case 'fn-del': {
      const parts = el.dataset.path.split('.');
      const idx = Number(parts.pop());
      parts.pop();
      getPath(f, parts.join('.')).functions.splice(idx, 1);
      scheduleSave();
      break;
    }
    case 'set-add': {
      const fn = getPath(f, el.dataset.path);
      const last = fn.sets.length ? Math.max(...fn.sets.map(s => s.from)) + 1 : fn.from;
      fn.sets.push({ id: uid(), name: '', from: Math.min(255, last), slot: 0 });
      scheduleSave();
      break;
    }
    case 'set-del':
      getPath(f, el.dataset.path).sets.splice(Number(el.dataset.si), 1);
      scheduleSave();
      break;
    case 'add-part':
      f.parts.push({ id: uid(), name: `Élément ${f.parts.length + 1}` });
      scheduleSave();
      break;
    case 'del-part': {
      const p = f.parts.find(x => x.id === el.dataset.id);
      const n = partUsage(f, p.id);
      if (n && !confirm(`Supprimer « ${p.name} » ? Ses ${n} canal(aux) seront rattachés au projecteur principal.`)) return;
      f.modes.forEach(m => m.channels.forEach(c => { if (c.part === p.id) c.part = ''; }));
      f.parts = f.parts.filter(x => x.id !== p.id);
      if (state.targetPart === p.id) state.targetPart = '';
      scheduleSave();
      break;
    }
    case 'make-cells': {
      const count = Math.max(1, Math.min(128, Math.round(state.cellsCount) || 1));
      const start = f.parts.filter(p => /^Pixel \d+$/.test(p.name)).length;
      const onlyPixels = f.parts.every(p => /^Pixel \d+$/.test(p.name));
      for (let i = 1; i <= count; i++) {
        const p = { id: uid(), name: `Pixel ${start + i}` };
        f.parts.push(p);
        mode().channels.push(...makeCellChannels(state.cellsTpl, p.id));
      }
      // des pixels seuls : on les aligne tout de suite (corrigeable dans « Disposition »)
      if (onlyPixels) arrangeParts(f, { shape: state.layoutShape, cols: state.layoutCols, order: state.layoutOrder, reverse: state.layoutReverse });
      scheduleSave();
      break;
    }
    case 'layout-apply':
      arrangeParts(f, { shape: state.layoutShape, cols: state.layoutCols, order: state.layoutOrder, reverse: state.layoutReverse });
      scheduleSave();
      break;
    case 'layout-clear':
      clearLayout(f);
      scheduleSave();
      break;
    case 'add-wheel':
      f.wheels.push(newWheel(el.dataset.wkind, f));
      scheduleSave();
      break;
    case 'del-wheel': {
      const w = f.wheels.find(x => x.id === el.dataset.id);
      const n = wheelUsage(f, w.id);
      if (!confirm(`Supprimer la roue « ${w.name} »${n ? ` ? Elle est utilisée par ${n} plage(s), qui ne seront plus reliées à une roue` : ''} ?`)) return;
      f.modes.forEach(m => m.channels.forEach(c => c.functions.forEach(fn => { if (fn.wheel === w.id) fn.wheel = ''; })));
      f.wheels = f.wheels.filter(x => x.id !== w.id);
      scheduleSave();
      break;
    }
    case 'slot-add': {
      const w = f.wheels[Number(el.dataset.wi)];
      w.slots.push(newSlot(w.kind === 'gobo' ? `Gobo ${w.slots.length}` : `Fente ${w.slots.length + 1}`));
      scheduleSave();
      break;
    }
    case 'slot-del': {
      const w = f.wheels[Number(el.dataset.wi)];
      const si = Number(el.dataset.si);
      w.slots.splice(si, 1);
      // les réglages qui visaient les fentes suivantes se décalent avec elles
      f.modes.forEach(m => m.channels.forEach(c => c.functions.forEach(fn => {
        if (fn.wheel !== w.id) return;
        fn.sets.forEach(s => { if (s.slot === si + 1) s.slot = 0; else if (s.slot > si + 1) s.slot--; });
      })));
      scheduleSave();
      break;
    }
    case 'slot-up': case 'slot-down': {
      const w = f.wheels[Number(el.dataset.wi)];
      const si = Number(el.dataset.si);
      const to = act === 'slot-up' ? si - 1 : si + 1;
      [w.slots[si], w.slots[to]] = [w.slots[to], w.slots[si]];
      f.modes.forEach(m => m.channels.forEach(c => c.functions.forEach(fn => {
        if (fn.wheel !== w.id) return;
        fn.sets.forEach(s => { if (s.slot === si + 1) s.slot = to + 1; else if (s.slot === to + 1) s.slot = si + 1; });
      })));
      scheduleSave();
      break;
    }
    case 'slot-img-clear':
      getPath(f, el.dataset.path).image = '';
      scheduleSave();
      break;
    case 'fill-sets': {
      const fn = getPath(f, el.dataset.path);
      const ch = getPath(f, el.dataset.path.split('.').slice(0, -2).join('.'));
      const w = f.wheels.find(x => x.id === fn.wheel);
      if (!w || !w.slots.length) return;
      if (fn.sets.length && !confirm('Remplacer les réglages déjà présents dans cette plage ?')) return;
      fillSetsFromWheel(ch, fn, w);
      scheduleSave();
      break;
    }
    case 'dismiss-notes':
      state.importNotes = [];
      break;
    case 'export':
      download(buildGdtf(f), gdtfFileName(f));
      return;
    default: return;
  }
  render();
});

function openFixture(id) {
  if (dmxState().on) stopDmx();
  const f = state.fixtures.find(x => x.id === id);
  if (f && !Array.isArray(f.parts)) f.parts = [];   // fiches créées avant les sous-éléments
  if (f && !Array.isArray(f.wheels)) f.wheels = []; // … ou avant les roues
  if (f) registerAttributes(f.attrDefs);
  state.importNotes = [];
  state.derive = null;
  state.testValues = {};
  state.targetPart = '';
  state.currentId = id;
  state.view = 'edit';
  state.step = 1;
  state.modeIdx = 0;
  state.open.clear();
  render();
  window.scrollTo(0, 0);
}

async function importFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (isOflJson(data)) { await openOfl(() => Promise.resolve({ json: data, man: '', key: file.name.replace(/\.json$/i, '') })); return; }
    const list = Array.isArray(data) ? data : [data];
    let n = 0;
    for (const item of list) {
      if (!item || !Array.isArray(item.modes)) continue;
      const fresh = { ...newFixture(), ...item };
      if (state.fixtures.some(x => x.id === fresh.id)) fresh.id = uid();
      state.fixtures.push(fresh);
      n++;
    }
    saveAll(state.fixtures);
    render();
    alert(n ? `${n} projecteur(s) importé(s).` : 'Aucun projecteur trouvé dans ce fichier.');
  } catch {
    alert('Ce fichier n\'est pas une sauvegarde valide.');
  }
}

// ---------- Open Fixture Library ----------
const isOflJson = d => !!(d && !Array.isArray(d) && (d.availableChannels || d.templateChannels || /open-fixture-library/.test(String(d.$schema || ''))));

async function loadOflCatalog(force = false) {
  state.ofl.status = 'loading';
  render();
  try {
    const c = await loadCatalog(force);
    state.ofl.items = c.items;
    state.ofl.mans = c.manufacturers || {};
    state.ofl.time = c.time;
    state.ofl.status = 'ready';
  } catch (e) {
    state.ofl.status = 'error';
    state.ofl.error = e.message;
  }
  if (state.view === 'ofl') render();
}

// getter : () => Promise<{ json, man, key }>
async function openOfl(getter) {
  state.ofl.busy = true;
  if (state.view === 'ofl') render();
  try {
    const { json, man, key } = await getter();
    if (!isOflJson(json)) throw new Error('ce n\'est pas une fiche de l\'Open Fixture Library');
    const manName = (state.ofl.mans && state.ofl.mans[man]) || '';
    const { fixture, notes } = await convertOfl(json, { man, key, manName });
    state.fixtures.push(fixture);
    state.saveFailed = !saveAll(state.fixtures);
    state.ofl.busy = false;
    openFixture(fixture.id);
    state.importNotes = notes;
    render();
  } catch (e) {
    state.ofl.busy = false;
    render();
    alert(`Impossible de reprendre cette fiche : ${e.message}.`);
  }
}

function oflResultsHtml() {
  const o = state.ofl;
  const q = o.query.trim();
  const link = parseOflUrl(q);
  if (link && /[/.]/.test(q)) {
    return `<div class="ofl-results" id="ofl-results">
      <button class="ofl-item" data-action="ofl-open" data-man="${esc(link.man)}" data-key="${esc(link.key)}">
        <b>${esc((o.mans && o.mans[link.man]) || prettyKey(link.man))}</b> ${esc(prettyKey(link.key))}<span class="muted small">Ouvrir la fiche de ce lien</span>
      </button></div>`;
  }
  if (o.status !== 'ready') return '<div id="ofl-results"></div>';
  if (!q) return `<div class="ofl-results" id="ofl-results"><p class="muted small">${o.items.length} fiches disponibles. Tape un fabricant ou un modèle (ex. « chauvet rogue », « pixel bar »).</p></div>`;
  const res = searchCatalog(o.items, q, 80);
  return `<div class="ofl-results" id="ofl-results">
    ${res.length ? res.map(it => `
      <button class="ofl-item" data-action="ofl-open" data-man="${esc(it.man)}" data-key="${esc(it.key)}">
        <b>${esc(it.manName)}</b> ${esc(it.name)}
      </button>`).join('') : '<p class="muted small">Aucune fiche ne correspond. Essaie avec moins de mots, ou le nom du fabricant seul.</p>'}
    ${res.length >= 80 ? '<p class="muted small">Seuls les 80 premiers résultats sont affichés : précise ta recherche.</p>' : ''}
  </div>`;
}

function renderOfl() {
  const o = state.ofl;
  if (o.status === 'idle') setTimeout(() => loadOflCatalog(), 0);
  return `
  <section class="home ofl">
    <div class="home-head">
      <div>
        <h1>Bibliothèque Open Fixture Library</h1>
        <p class="muted">Des centaines de fiches libres, écrites par la communauté (<a href="https://open-fixture-library.org" target="_blank" rel="noopener">open-fixture-library.org</a>). L'appli convertit la fiche choisie : tu la vérifies, tu la corriges si besoin, puis tu l'exportes en .gdtf.</p>
      </div>
      <button class="btn" data-action="home">Retour</button>
    </div>
    <div class="ofl-tools">
      <input type="search" class="search" data-ui="oflQuery" value="${esc(o.query)}" placeholder="Rechercher, ou coller le lien d'une fiche OFL" aria-label="Rechercher une fiche OFL" autofocus>
      <label class="btn" title="Fichier .json téléchargé depuis open-fixture-library.org">Ouvrir un fichier OFL (.json)<input type="file" accept=".json,application/json" data-file="ofl" hidden></label>
    </div>
    ${o.busy ? '<p class="ofl-status">Conversion de la fiche…</p>' : ''}
    ${o.status === 'loading' ? '<p class="ofl-status">Chargement du catalogue…</p>' : ''}
    ${o.status === 'error' ? `<p class="ofl-status err">Catalogue indisponible : ${esc(o.error)}. <button class="btn small" data-action="ofl-reload">Réessayer</button></p>` : ''}
    ${oflResultsHtml()}
    ${o.status === 'ready' ? `<p class="muted small">Catalogue du ${new Date(o.time).toLocaleDateString('fr-FR')}. <button class="linkish" data-action="ofl-reload">Mettre à jour</button></p>` : ''}
  </section>`;
}

async function openGdtf(file) {
  if (!file) return;
  try {
    const { fixture, notes } = await importGdtf(file);
    if (state.fixtures.some(x => x.uuid === fixture.uuid) &&
        !confirm(`Une fiche « ${fixture.manufacturer} ${fixture.name} » avec le même identifiant existe déjà. L'ouvrir quand même comme une nouvelle fiche ?`)) return;
    state.fixtures.push(fixture);
    state.saveFailed = !saveAll(state.fixtures);
    openFixture(fixture.id);
    state.importNotes = notes;
    render();
  } catch (e) {
    alert(`Impossible d'ouvrir ce fichier : ${e.message}.`);
  }
}

async function setThumbnail(file) {
  if (!file) return;
  try {
    fx().thumbnail = await toPngDataUrl(file, 256);
    scheduleSave();
    render();
  } catch {
    alert('Cette image n\'a pas pu être lue. Essaie un fichier PNG ou JPG.');
  }
}

async function setSlotImage(path, file) {
  if (!file) return;
  try {
    getPath(fx(), path).image = await toPngDataUrl(file);
    scheduleSave();
    render();
  } catch {
    alert('Cette image n\'a pas pu être lue. Essaie un fichier PNG ou JPG.');
  }
}

state.fixtures.forEach(f => registerAttributes(f.attrDefs));
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// La sortie réseau signale une erreur (serveur arrêté…) : on l'affiche dans le testeur
dmxState().onChange = () => { if (state.view === 'edit' && state.step === 4) render(); };
