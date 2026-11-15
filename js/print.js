// Fiche DMX imprimable (ou à enregistrer en PDF depuis la fenêtre d'impression du navigateur)
import { attributeLabel, UNUSED } from './attributes.js';
import { footprint, functionGroups, functionEnd } from './model.js';
import { isHex } from './color.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LAMP = { LED: 'LED', Discharge: 'Lampe à décharge', Halogen: 'Halogène', Tungsten: 'Tungstène' };

function slotMark(w, slot) {
  if (!slot) return '';
  if (w.kind === 'gobo' && slot.image) return `<img class="p-gobo" src="${slot.image}" alt="">`;
  const c = isHex(slot.color) ? slot.color : '#ffffff';
  return `<span class="p-swatch" style="background:${c}"></span>`;
}

function rangesCell(fx, m, c) {
  if (c.attribute === UNUSED) return '<span class="p-muted">Canal inutilisé</span>';
  const wheels = fx.wheels || [];
  let h = '';
  for (const list of functionGroups(c).values()) {
    const cond = list[0].cond;
    if (cond && cond.master) {
      const master = m.channels.find(x => x.id === cond.master);
      h += `<div class="p-cond">Quand ${esc(master ? attributeLabel(master.attribute) : '?')} est entre ${cond.from} et ${cond.to} :</div>`;
    }
    h += '<ul class="p-ranges">';
    for (const f of list) {
      const w = f.wheel ? wheels.find(x => x.id === f.wheel) : null;
      const sets = [...f.sets].sort((a, b) => a.from - b.from);
      h += `<li><b>${f.from}–${functionEnd(c, f)}</b> ${esc(f.name || attributeLabel(f.attribute))}`;
      if (list.length > 1 || f.name) h += ` <span class="p-muted">(${esc(attributeLabel(f.attribute))})</span>`;
      if (sets.length) {
        h += '<div class="p-sets">' + sets.map(s => {
          const slot = w && s.slot > 0 ? w.slots[s.slot - 1] : null;
          return `<span>${slotMark(w, slot)}${s.from} ${esc(s.name)}</span>`;
        }).join('') + '</div>';
      }
      h += '</li>';
    }
    h += '</ul>';
  }
  return h;
}

export function renderPrintSheet(fx) {
  const parts = fx.parts || [];
  const wheels = fx.wheels || [];
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const specs = [
    fx.kind === 'moving' ? 'Lyre' : 'Projecteur fixe',
    LAMP[fx.lampType] || fx.lampType,
    fx.power ? `${fx.power} W` : '',
    fx.beamAngle ? `faisceau ${fx.beamAngle}°` : '',
    fx.length && fx.width && fx.height ? `${fx.length} × ${fx.width} × ${fx.height} mm` : '',
    fx.weight ? `${String(fx.weight).replace('.', ',')} kg` : '',
  ].filter(Boolean).join(' · ');

  let h = `
  <article class="print-sheet">
    <header class="p-head">
      ${fx.thumbnail ? `<img class="p-photo" src="${fx.thumbnail}" alt="">` : ''}
      <div>
        <div class="p-maker">${esc(fx.manufacturer)}</div>
        <h1>${esc(fx.name)}</h1>
        <div class="p-muted">${esc(specs)}</div>
        <div class="p-muted">Révision ${esc(fx.revision)} · fiche du ${date}${fx.description ? ` · ${esc(fx.description)}` : ''}</div>
      </div>
    </header>
    <section class="p-summary">
      <b>Modes DMX :</b> ${fx.modes.map(m => `${esc(m.name)} (${footprint(m)} adresses)`).join(' · ')}
    </section>`;

  if (wheels.length) {
    h += '<section><h2>Roues</h2>';
    for (const w of wheels) {
      h += `<div class="p-wheel"><b>${esc(w.name)}</b><div class="p-slots">${w.slots.map((s, i) =>
        `<span>${slotMark(w, s)}<small>${i + 1}</small> ${esc(s.name)}</span>`).join('')}</div></div>`;
    }
    h += '</section>';
  }

  for (const m of fx.modes) {
    let addr = 1;
    h += `<section class="p-mode"><h2>Mode « ${esc(m.name)} » — ${footprint(m)} adresses</h2>
      <table class="p-table">
        <thead><tr><th>Adr.</th><th>Fonction</th>${parts.length ? '<th>Élément</th>' : ''}<th>Défaut</th><th>Plages et réglages</th></tr></thead>
        <tbody>`;
    for (const c of m.channels) {
      const a = addr;
      addr += c.fine ? 2 : 1;
      const part = c.part ? parts.find(p => p.id === c.part) : null;
      h += `<tr>
        <td class="p-addr">${c.fine ? `${a}<br><span class="p-muted">${a + 1} fin</span>` : a}</td>
        <td><b>${esc(attributeLabel(c.attribute))}</b>${c.fine ? '<br><span class="p-muted">16 bits</span>' : ''}</td>
        ${parts.length ? `<td>${part ? esc(part.name) : '<span class="p-muted">Principal</span>'}</td>` : ''}
        <td class="p-def">${c.attribute === UNUSED ? '' : c.defaultValue}</td>
        <td>${rangesCell(fx, m, c)}</td>
      </tr>`;
    }
    h += '</tbody></table></section>';
  }

  h += '<footer class="p-foot">Fiche générée par MA3 Fixture Builder</footer></article>';
  return h;
}
