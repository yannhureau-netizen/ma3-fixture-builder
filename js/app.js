import { ATTRIBUTES, getAttribute, attributeLabel, registerAttributes, extraAttributes, isKnownAttribute, UNUSED } from './attributes.js';
import { newFixture, newChannel, newFunction, newWheel, newSlot, uid, TEMPLATES, CELL_TEMPLATES, makeCellChannels, footprint, validate } from './model.js';
import { buildGdtf, buildDescriptionXml, gdtfFileName, makeUuid } from './gdtf.js';
import { importGdtf } from './gdtf-import.js';
import { toPngDataUrl, isHex } from './color.js';
import { loadAll, saveAll, loadPrefs, savePrefs } from './storage.js';

const app = document.getElementById('app');

const state = {
  fixtures: loadAll(),
  view: 'home',          // 'home' | 'edit'
  currentId: null,
  step: 1,               // 1 Projecteur, 2 Roues, 3 Canaux, 4 Export
  importNotes: [],       // remarques affichées après l'ouverture d'un .gdtf
  modeIdx: 0,
  open: new Set(),       // canaux dont les plages sont dépliées
  prefs: loadPrefs(),
  saveFailed: false,
  cellsCount: 4,         // assistant « cellules identiques »
  cellsTpl: 'rgb',
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

function sortedFunctions(c) {
  return [...c.functions].sort((a, b) => a.from - b.from);
}
function rangeEnd(c, f) {
  const s = sortedFunctions(c);
  const i = s.indexOf(f);
  return i < s.length - 1 ? s[i + 1].from - 1 : 255;
}
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
function renderHome() {
  const list = [...state.fixtures].sort((a, b) => b.updatedAt - a.updatedAt);
  return `
  <section class="home">
    <div class="home-head">
      <div>
        <h1>Mes projecteurs</h1>
        <p class="muted">Crée la fiche d'un projecteur absent de la bibliothèque grandMA3, puis exporte-la en fichier .gdtf.</p>
      </div>
      <div class="row">
        <button class="btn primary big" data-action="new">+ Nouveau projecteur</button>
        <label class="btn" title="Ouvrir un fichier GDTF (par exemple venu de GDTF Share) pour le corriger">Ouvrir un fichier .gdtf<input type="file" accept=".gdtf,application/zip" data-file="gdtf" hidden></label>
        <label class="btn">Importer une sauvegarde<input type="file" accept=".json,application/json" data-file="import" hidden></label>
        ${list.length ? '<button class="btn" data-action="backup-all">Tout sauvegarder</button>' : ''}
      </div>
    </div>
    ${list.length ? `<div class="cards">${list.map(f => `
      <article class="card">
        <div class="card-body" data-action="open" data-id="${f.id}" role="button" tabindex="0">
          <div class="card-maker">${esc(f.manufacturer) || '<i>Fabricant ?</i>'}</div>
          <div class="card-name">${esc(f.name) || '<i>Sans nom</i>'}</div>
          <div class="muted small">${f.kind === 'moving' ? 'Lyre' : 'Fixe'} · ${f.modes.length} mode${f.modes.length > 1 ? 's' : ''} · ${f.modes.map(m => footprint(m) + ' adr.').join(', ')}${f.parts && f.parts.length ? ` · ${f.parts.length} sous-élément${f.parts.length > 1 ? 's' : ''}` : ''}</div>
        </div>
        <div class="card-tools">
          <button class="btn small" data-action="open" data-id="${f.id}">Ouvrir</button>
          <button class="btn small" data-action="dup-fixture" data-id="${f.id}">Dupliquer</button>
          <button class="btn small danger" data-action="del-fixture" data-id="${f.id}">Supprimer</button>
        </div>
      </article>`).join('')}</div>` : `
      <div class="empty">
        <h2>Comment ça marche ?</h2>
        <ol class="steps-help">
          <li><b>Projecteur</b> : fabricant, nom, lyre ou fixe.</li>
          <li><b>Roues</b> (facultatif) : couleurs et images des gobos.</li>
          <li><b>Canaux DMX</b> : ajoute les canaux dans l'ordre de la doc du fabricant, avec les boutons tout prêts.</li>
          <li><b>Exporter</b> : télécharge le fichier .gdtf et importe-le dans grandMA3.</li>
        </ol>
        <p class="muted small">Tu as déjà un fichier .gdtf à corriger ? Utilise « Ouvrir un fichier .gdtf » en haut.</p>
        <button class="btn primary big" data-action="new">Créer mon premier projecteur</button>
      </div>`}
  </section>`;
}

// ---------- éditeur ----------
function renderEditor() {
  const f = fx();
  const issues = validate(f);
  const errors = issues.filter(i => i.level === 'error').length;
  const steps = ['Projecteur', 'Roues', 'Canaux DMX', 'Exporter'];
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
    ${state.step === 1 ? renderStep1(f) : state.step === 2 ? renderWheels(f) : state.step === 3 ? renderStep2(f) : renderStep3(f, issues)}
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
      <input type="text" data-bind="parts.${i}.name" data-kind="text" value="${esc(p.name)}" placeholder="ex. Anneau" aria-label="Nom du sous-élément">
      <span class="muted small">${n} canal${n > 1 ? 'aux' : ''}</span>
      <button class="icon danger" title="Supprimer ce sous-élément" data-action="del-part" data-id="${p.id}">✕</button>
    </div>`;
  }).join('')}</div>` : ''}
  <button class="btn small" data-action="add-part">+ Ajouter un sous-élément</button>
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
      ${f.modes.length > 1 ? '<button class="btn small danger" data-action="del-mode">Supprimer ce mode</button>' : ''}
    </div>
  </div>

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
  // On affiche les plages triées, mais on garde l'index réel pour l'édition.
  const order = c.functions.map((f, i) => ({ f, i })).sort((a, b) => a.f.from - b.f.from);
  return `
  <div class="ranges">
    <p class="muted small">Découpe le canal comme dans la doc : chaque plage commence à une valeur DMX et va jusqu'à la suivante.</p>
    ${order.map(({ f, i }) => {
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
    <button class="btn small" data-action="fn-add" data-path="${base}">+ Ajouter une plage</button>
  </div>`;
}

function renderStep3(f, issues) {
  const errors = issues.filter(i => i.level === 'error');
  const warns = issues.filter(i => i.level === 'warn');
  return `
  <h2>4. Exporter</h2>
  ${errors.length ? `<div class="alert error"><b>À corriger avant d'exporter :</b><ul>${errors.map(e => `<li>${esc(e.text)}</li>`).join('')}</ul></div>` :
    '<div class="alert ok"><b>Tout est bon !</b> Le fichier peut être exporté.</div>'}
  ${warns.length ? `<div class="alert warn"><ul>${warns.map(e => `<li>${esc(e.text)}</li>`).join('')}</ul></div>` : ''}

  <div class="summary">
    <div><span class="muted small">Projecteur</span><b>${esc(f.manufacturer)} ${esc(f.name)}</b></div>
    ${f.modes.map(m => `<div><span class="muted small">${esc(m.name)}</span><b>${footprint(m)} adresses</b></div>`).join('')}
  </div>

  <div class="row">
    <button class="btn primary big" data-action="export"${errors.length ? ' disabled' : ''}>⬇ Télécharger ${esc(gdtfFileName(f))}</button>
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

// ---------- rendu ----------
function render() {
  const a = document.activeElement;
  const focusBind = a && a.dataset && a.dataset.bind ? { bind: a.dataset.bind, tag: a.tagName } : null;
  app.innerHTML = state.view === 'home' ? renderHome() : renderEditor();
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
  if (el.dataset.ui && el.tagName !== 'SELECT') {
    state[el.dataset.ui] = el.type === 'number' ? Number(el.value) : el.value;
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
  if (el.dataset.ui) {
    if (el.tagName === 'SELECT') state[el.dataset.ui] = el.value;
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
    case 'new': {
      const nf = newFixture();
      state.fixtures.push(nf);
      openFixture(nf.id);
      scheduleSave();
      return;
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
    case 'mode': state.modeIdx = Number(el.dataset.idx); break;
    case 'add-mode':
      f.modes.push({ id: uid(), name: `Mode ${f.modes.length + 1}`, channels: [] });
      state.modeIdx = f.modes.length - 1;
      scheduleSave();
      break;
    case 'dup-mode': {
      const copy = clone(mode());
      copy.id = uid();
      copy.name += ' (copie)';
      copy.channels.forEach(c => { c.id = uid(); });
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
      chans.forEach(c => c.functions.forEach(fn => {
        const m = /^(Color|Gobo)([12])$/.exec(fn.attribute);
        if (!m || fn.wheel) return;
        const w = f.wheels.filter(x => x.kind === (m[1] === 'Color' ? 'color' : 'gobo'))[Number(m[2]) - 1];
        if (w) fn.wheel = w.id;
      }));
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
      const last = Math.max(...ch.functions.map(x => x.from));
      const from = Math.min(255, last + 10);
      ch.functions.push(newFunction(ch.attribute || 'Control1', from));
      scheduleSave();
      break;
    }
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
      for (let i = 1; i <= count; i++) {
        const p = { id: uid(), name: `Pixel ${start + i}` };
        f.parts.push(p);
        mode().channels.push(...makeCellChannels(state.cellsTpl, p.id));
      }
      scheduleSave();
      break;
    }
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
      const to = rangeEnd(ch, fn);
      const step = Math.max(1, Math.floor((to - fn.from + 1) / w.slots.length));
      fn.sets = w.slots.map((s, k) => ({ id: uid(), name: s.name, from: Math.min(to, fn.from + k * step), slot: k + 1 }));
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
  const f = state.fixtures.find(x => x.id === id);
  if (f && !Array.isArray(f.parts)) f.parts = [];   // fiches créées avant les sous-éléments
  if (f && !Array.isArray(f.wheels)) f.wheels = []; // … ou avant les roues
  if (f) registerAttributes(f.attrDefs);
  state.importNotes = [];
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
