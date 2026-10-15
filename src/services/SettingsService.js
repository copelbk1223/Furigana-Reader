/**
 * Settings Service — persists user preferences to localStorage
 */
const STORAGE_KEY = 'reader-settings';

const DEFAULTS = {
  // Reading
  fontSize: 18,
  fontFamily: 'Noto Sans JP',
  fontWeight: 400,
  lineHeight: 1.8,
  textAlign: 'original',
  textDirection: 'auto',
  pageTurnAnimation: true,

  // Furigana
  furiganaEnabled: true,
  furiganaMode: 'hiragana',
  furiganaFilter: 'all',
  furiganaColor: '#4ec9b0',

  // Theme
  theme: 'dark',

  // Dictionary / Lookup
  jmdictEnabled: false,
  kanjidicEnabled: false,
  lookupEnabled: false,

  // General
  lastRoute: '/home',
};

class SettingsService {
  constructor() {
    this._settings = { ...DEFAULTS };
    this._listeners = [];
    this._load();
  }

  _load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) this._settings = { ...DEFAULTS, ...JSON.parse(stored) };
    } catch (e) { console.warn('Failed to load settings:', e); }
    this._applyTheme();
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings)); }
    catch (e) { console.warn('Failed to save settings:', e); }
  }

  _applyTheme() {
    const theme = this._settings.theme || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = theme === 'light' ? '#f4f4f8' : (theme === 'sepia' ? '#f4ecd8' : '#08080c');
    }
  }

  get(key) { return this._settings[key]; }
  getAll() { return { ...this._settings }; }

  set(key, value) {
    const old = this._settings[key];
    this._settings[key] = value;
    this._save();
    if (key === 'theme') this._applyTheme();
    this._listeners.forEach(fn => fn(key, value, old));
  }

  setMany(obj) {
    Object.entries(obj).forEach(([k, v]) => { this._settings[k] = v; });
    this._save();
    if ('theme' in obj) this._applyTheme();
    this._listeners.forEach(fn => fn('*', obj, null));
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  }

  reset() {
    this._settings = { ...DEFAULTS };
    this._save();
    this._applyTheme();
    this._listeners.forEach(fn => fn('*', this._settings, null));
  }
}

export const settingsService = new SettingsService();
export default settingsService;
