// Sortie DMX du testeur : le navigateur ne peut pas envoyer de paquets réseau lui-même,
// c'est le serveur local (serveur.ps1) qui envoie les trames en Art-Net ou sACN.
// Sur la version en ligne (GitHub Pages), ce serveur n'existe pas : la sortie est indisponible.

const out = {
  checked: false,        // détection faite ?
  available: false,      // serveur local présent ?
  interfaces: [],        // [{ name, ip, broadcast }]
  on: false,             // envoi en cours
  error: '',
  frameFn: null,         // () => { cfg, data: Uint8Array(512) } | null
  timer: null,
  keep: null,
  last: 0,
  busy: false,
  again: false,
  onChange: null,        // appelé quand l'état change (pour redessiner)
};

export const dmxState = () => out;

export async function detectDmx() {
  if (out.checked) return out.available;
  try {
    const r = await fetch('api/dmx/info', { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    out.available = !!(j && j.ok);
    out.interfaces = out.available ? (Array.isArray(j.interfaces) ? j.interfaces : [j.interfaces]).filter(Boolean) : [];
  } catch {
    out.available = false;
  }
  out.checked = true;
  return out.available;
}

// Trame de 512 octets : les canaux du mode, à partir de l'adresse de départ
export function buildFrame(mode, valueOf, address) {
  const data = new Uint8Array(512);
  let a = Math.max(1, Math.min(512, Math.round(address) || 1)) - 1;
  for (const c of mode.channels) {
    const v = Math.max(0, Math.min(255, Math.round(valueOf(c) || 0)));
    if (a < 512) data[a] = c.attribute === 'NoFeature' ? 0 : v;
    if (c.fine) {
      // le fader est en 8 bits : l'octet fin suit (0, ou 255 tout en haut)
      if (a + 1 < 512) data[a + 1] = c.attribute === 'NoFeature' ? 0 : (v === 255 ? 255 : 0);
      a += 2;
    } else {
      a += 1;
    }
  }
  return data;
}

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function post(cfg, data) {
  const body = JSON.stringify({
    proto: cfg.proto === 'sacn' ? 'sacn' : 'artnet',
    dest: cfg.dest || '255.255.255.255',
    iface: cfg.iface || '',
    universe: Number(cfg.proto === 'sacn' ? cfg.universeSacn : cfg.universeArt) || 0,
    data: toBase64(data),
  });
  const r = await fetch('api/dmx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!r.ok) {
    let msg = `erreur ${r.status}`;
    try { const j = await r.json(); if (j.error) msg = j.error; } catch { /* réponse vide */ }
    throw new Error(msg);
  }
}

async function flush() {
  if (!out.on || !out.frameFn) return;
  if (out.busy) { out.again = true; return; }
  const f = out.frameFn();
  if (!f) return;
  out.busy = true;
  try {
    await post(f.cfg, f.data);
    out.last = Date.now();
    if (out.error) { out.error = ''; out.onChange && out.onChange(); }
  } catch (e) {
    out.error = e instanceof TypeError ? 'Le serveur local ne répond plus (fenêtre « Lancer l\'appli » fermée ?).' : `Envoi refusé : ${e.message}`;
    stopDmx(false);
    out.onChange && out.onChange();
  } finally {
    out.busy = false;
    if (out.again) { out.again = false; scheduleDmx(); }
  }
}

// À appeler à chaque changement de valeur : envoi limité à ~30 trames par seconde
export function scheduleDmx() {
  if (!out.on || out.timer) return;
  const wait = Math.max(0, 33 - (Date.now() - out.last));
  out.timer = setTimeout(() => { out.timer = null; flush(); }, wait);
}

export function startDmx(frameFn) {
  out.frameFn = frameFn;
  out.on = true;
  out.error = '';
  // renvoi régulier : certains récepteurs (sACN surtout) coupent s'ils ne reçoivent plus rien
  clearInterval(out.keep);
  out.keep = setInterval(() => { if (Date.now() - out.last > 800) scheduleDmx(); }, 400);
  scheduleDmx();
}

// À l'arrêt, on envoie une trame à zéro pour ne pas laisser le projecteur allumé
export async function stopDmx(blackout = true) {
  const f = out.on && blackout && out.frameFn ? out.frameFn() : null;
  out.on = false;
  clearInterval(out.keep);
  clearTimeout(out.timer);
  out.keep = null;
  out.timer = null;
  if (f) { try { await post(f.cfg, new Uint8Array(512)); } catch { /* serveur arrêté */ } }
}
