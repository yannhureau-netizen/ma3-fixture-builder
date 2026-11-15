// Sauvegarde automatique dans le navigateur (reste sur cet appareil).
const KEY = 'ma3fb.fixtures.v1';
const PREFS = 'ma3fb.prefs.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadAll = () => read(KEY, []);
export const saveAll = fixtures => write(KEY, fixtures);
export const loadPrefs = () => read(PREFS, { advanced: false });
export const savePrefs = prefs => write(PREFS, prefs);
