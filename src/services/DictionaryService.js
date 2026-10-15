/**
 * Dictionary Service — Fast in-memory lookup mapped over bundled JSON data.
 * Uses @capacitor/preferences to track enabled/download status without Dexie DB overhead.
 */
import { Preferences } from '@capacitor/preferences';

const BUNDLED_PATHS = {
  jmdict: '/dict/jmdict-eng-common.json',
  kanjidic: '/dict/kanjidic2-en.json',
  wordnet: '/dict/wordnet-ja.json',
  tanaka: '/dict/tanaka-corpus.json',
  wiktionary: '/dict/wiktionary-ja.json',
};

const EXTERNAL_SOURCES = {
  wordnet: { label: 'WordNet (JPN/ENG)', url: 'https://bond-lab.github.io/wnja/data/wnjpn.db.gz', path: BUNDLED_PATHS.wordnet },
  tanaka: { label: 'Tanaka Corpus', url: 'https://www.edrdg.org/wiki/index.php/Tanaka_Corpus', path: BUNDLED_PATHS.tanaka },
  wiktionary: { label: 'Wiktionary / Wikidata', url: 'https://en.wiktionary.org/wiki/Wiktionary:Database_download', path: BUNDLED_PATHS.wiktionary },
};

const MAX_ANALYZE_LOOKAROUND = 18;

function normalizeLookupKey(value = '') {
  return [...String(value).trim()]
    .join('')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function keyMatchesLookup(rowKey, lookupKeys) {
  const key = normalizeLookupKey(rowKey);
  if (!key) return false;
  return lookupKeys.some(lookup => {
    const v = normalizeLookupKey(lookup);
    if (!v) return false;
    return key === v || key.includes(v) || v.includes(key);
  });
}

function getEntrySearchText(row = '') {
  return [
    row.word, row.term, row.headword, row.japanese, row.text,
    row.definition, row.meaning, row.gloss, row.description,
    row.translation, row.english,
    ...(row.synonyms || []), ...(row.keys || []),
  ].filter(Boolean).join(' ');
}

function getLookupVariants(word = '') {
  const clean = [...String(word).trim()].join('');
  if (!clean) return [];
  const variants = new Set([clean]);

  const add = v => { if (v && v !== clean) variants.add(v); };
  const rules = [
    ['かった', 'い'], ['くない', 'い'], ['くて', 'い'], ['ければ', 'い'],
    ['でした', 'だ'], ['ではない', 'だ'], ['じゃない', 'だ'],
    ['ました', 'る'], ['ません', 'る'], ['ない', 'る'], ['ます', 'る'],
    ['ませんでした', 'る'], ['なかった', 'る'], ['たかった', 'たい'],
    ['って', 'う'], ['った', 'う'], ['わない', 'う'],
    ['いて', 'く'], ['いた', 'く'], ['かない', 'く'],
    ['いで', 'ぐ'], ['いだ', 'ぐ'], ['がない', 'ぐ'],
    ['して', 'す'], ['した', 'す'], ['さない', 'す'],
    ['んで', 'む'], ['んだ', 'む'], ['まない', 'む'],
    ['んで', 'ぶ'], ['んだ', 'ぶ'], ['ばない', 'ぶ'],
    ['んで', 'ぬ'], ['んだ', 'ぬ'], ['なない', 'ぬ'],
    ['って', 'る'], ['った', 'る'], ['らない', 'る'],
    ['て', 'る'], ['た', 'る'], ['ない', 'る'],
  ];

  for (const [ending, base] of rules) {
    if (clean.endsWith(ending) && clean.length > ending.length) {
      add(clean.slice(0, -ending.length) + base);
    }
  }
  return [...variants];
}

class DictionaryService {
  constructor() {
    this._jmdictCache = null;
    this._jmdictIndex = null;
    this._kanjidicCache = null;
    this._externalCaches = { wordnet: null, tanaka: null, wiktionary: null };
    this._externalIndexes = { wordnet: null, tanaka: null, wiktionary: null };
    this._statusCache = null;
  }

  async _getStatus() {
    if (this._statusCache) return this._statusCache;
    try {
      const res = await Preferences.get({ key: 'dict_status' });
      this._statusCache = res.value ? JSON.parse(res.value) : {};
    } catch {
      this._statusCache = {};
    }
    return this._statusCache;
  }

  async _saveStatus() {
    await Preferences.set({ key: 'dict_status', value: JSON.stringify(this._statusCache || {}) });
  }

  async isLoaded(name) {
    const status = await this._getStatus();
    return !!status[name]?.loaded;
  }

  async getMetadata(name) {
    const status = await this._getStatus();
    return status[name] || null;
  }

  async enable(name, onProgress = () => {}) {
    onProgress(10);
    // When a user enables a dictionary, we mark it as loaded in Preferences.
    const status = await this._getStatus();
    status[name] = { 
      name, 
      loaded: true, 
      loadedAt: new Date().toISOString(),
      parserReady: true
    };
    await this._saveStatus();
    
    // Pre-warm the cache and index for this dictionary in memory to make lookups fast
    onProgress(40);
    if (name === 'jmdict') await this._loadBundledJmdict();
    else if (name === 'kanjidic') await this._loadBundledKanjidic();
    else if (EXTERNAL_SOURCES[name]) await this._loadExternal(name);
    
    onProgress(100);
  }

  async disable(name) {
    const status = await this._getStatus();
    if (status[name]) {
      delete status[name];
      await this._saveStatus();
    }
    // Free up RAM
    if (name === 'jmdict') { this._jmdictCache = null; this._jmdictIndex = null; }
    else if (name === 'kanjidic') this._kanjidicCache = null;
    else if (this._externalCaches[name]) {
      this._externalCaches[name] = null;
      if (this._externalIndexes) this._externalIndexes[name] = null;
    }
  }

  async lookupExternal(name, word, relatedKeys = []) {
    if (!word || !(await this.isLoaded(name))) return [];
    
    await this._loadExternal(name);
    const data = this._externalCaches[name];
    const index = this._externalIndexes?.[name];
    if (!data || !data.length || !index) return [];

    // Prioritized search keys:
    // 1. Target word itself (exact match)
    // 2. Inflection base form variants (e.g. 食べた -> 食べる)
    // 3. Related kanji/kana spellings from JMdict
    const cleanWord = normalizeLookupKey(word);
    const variants = getLookupVariants(word).map(normalizeLookupKey).filter(k => k && k !== cleanWord);
    const otherKeys = (relatedKeys || []).map(normalizeLookupKey).filter(k => k && k !== cleanWord && !variants.includes(k));
    
    // Ordered priority list of exact keys to query
    const searchKeys = [cleanWord, ...variants, ...otherKeys];
    
    const seen = new Set();
    const results = [];
    
    // Exact O(1) matching via inverted index
    for (const k of searchKeys) {
      const hits = index.get(k) || [];
      for (const idx of hits) {
        if (!seen.has(idx)) {
          seen.add(idx);
          results.push(data[idx]);
          if (results.length >= 16) break;
        }
      }
      if (results.length >= 16) break;
    }
    
    // For Tanaka sentence corpus: if exact keyword index found fewer than 5 sentences,
    // look for sentences where the Japanese text directly contains the exact searched word
    if (name === 'tanaka' && results.length < 5 && cleanWord.length >= 1) {
      for (let i = 0; i < data.length; i++) {
        if (seen.has(i)) continue;
        const ja = data[i].japanese;
        if (ja && normalizeLookupKey(ja).includes(cleanWord)) {
          seen.add(i);
          results.push(data[i]);
          if (results.length >= 10) break;
        }
      }
    }
    
    return results;
  }

  async _loadExternal(name) {
    if (this._externalCaches[name]) return this._externalCaches[name];
    const path = BUNDLED_PATHS[name];
    if (!path) return [];
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) return [];
      const data = await response.json();
      const entries = data.entries || data.items || data.sentences || data.words || [];
      
      const index = new Map();
      this._externalCaches[name] = entries.map((entry, idx) => {
        const rawKeys = entry.keys || entry.headwords || entry.words || entry.terms || [entry.word, entry.term, entry.japanese, entry.text].filter(Boolean);
        const uniqueKeys = [...new Set((rawKeys || []).filter(Boolean))];
        
        // Populate inverted index with exact words, terms, and synonyms
        const indexKeys = new Set([
          entry.word,
          entry.term,
          ...(entry.keys || []),
          ...(entry.synonyms || [])
        ]);
        for (const k of indexKeys) {
          if (!k) continue;
          const norm = normalizeLookupKey(k);
          if (!norm) continue;
          if (!index.has(norm)) index.set(norm, []);
          index.get(norm).push(idx);
        }
        
        return { 
          ...entry, 
          id: entry.id ?? `bundled-${name}-${idx}`, 
          keys: uniqueKeys
        };
      });

      if (!this._externalIndexes) this._externalIndexes = {};
      this._externalIndexes[name] = index;
      return this._externalCaches[name];
    } catch { return []; }
  }

  async markExternalDownloaded(name) {
    const source = EXTERNAL_SOURCES[name];
    if (!source) throw new Error(`Unknown external source: ${name}`);
    const status = await this._getStatus();
    status[name] = {
      name,
      label: source.label,
      url: source.url,
      external: true,
      parserReady: false,
      loaded: true,
      loadedAt: new Date().toISOString()
    };
    await this._saveStatus();
  }

  async getSourceStatus() {
    const status = await this._getStatus();
    return {
      wordnet: !!status['wordnet']?.loaded, wordnetReady: !!status['wordnet']?.parserReady,
      tanaka: !!status['tanaka']?.loaded, tanakaReady: !!status['tanaka']?.parserReady,
      wiktionary: !!status['wiktionary']?.loaded, wiktionaryReady: !!status['wiktionary']?.parserReady,
    };
  }

  async lookupWord(word) {
    if (!word) return [];
    const variants = getLookupVariants(word);
    
    // Fall back to bundled dictionary automatically if disabled (for analysis tool to still work)
    const words = await this._loadBundledJmdict();
    
    const results = [];
    const seen = new Set();
    
    // O(1) instantaneous lookup using in-memory Map Index
    for (const variant of variants) {
      const entryIndexes = this._jmdictIndex.get(variant);
      if (entryIndexes) {
        for (const idx of entryIndexes) {
          if (!seen.has(idx)) {
            seen.add(idx);
            results.push(words[idx]);
            if (results.length >= 10) return results;
          }
        }
      }
    }
    
    return results;
  }

  async lookupCompounds(kanji, limit = 24) {
    if (!kanji || !/[\u4E00-\u9FAF\u3400-\u4DBF]/.test(kanji)) return [];
    
    const words = await this._loadBundledJmdict();
    const rows = [];
    for (let i = 0; i < words.length; i++) {
       const entry = words[i];
       if ((entry.kanji || []).some(k => k.includes(kanji) && [...k].length > 1)) {
          rows.push(entry);
          if (rows.length >= 300) break;
       }
    }

    const seen = new Set();
    return rows
      .sort((a, b) => (b.isCommon === true) - (a.isCommon === true))
      .filter(entry => {
        const word = (entry.kanji || []).find(k => k.includes(kanji) && [...k].length > 1) || entry.kanji?.[0];
        if (!word || seen.has(word)) return false;
        seen.add(word);
        return true;
      })
      .slice(0, limit);
  }

  async _loadBundledJmdict() {
    if (this._jmdictCache) return this._jmdictCache;
    const response = await fetch(BUNDLED_PATHS.jmdict);
    if (!response.ok) return [];
    const data = await response.json();
    
    this._jmdictCache = (data.words || []).map(entry => ({
      kanji: (entry.kanji || []).map(k => k.text),
      kana: (entry.kana || []).map(k => k.text),
      isCommon: (entry.kanji || []).some(k => k.common) || (entry.kana || []).some(k => k.common),
      sense: (entry.sense || []).map(s => ({
        pos: s.partOfSpeech || [],
        gloss: (s.gloss || []).map(g => g.text),
      })),
    }));

    // Build the inverted index for O(1) lookups
    this._jmdictIndex = new Map();
    for (let i = 0; i < this._jmdictCache.length; i++) {
       const entry = this._jmdictCache[i];
       const keys = [...(entry.kanji || []), ...(entry.kana || [])];
       for (const key of keys) {
         if (!this._jmdictIndex.has(key)) this._jmdictIndex.set(key, []);
         this._jmdictIndex.get(key).push(i);
       }
    }
    
    return this._jmdictCache;
  }

  async analyzeAt(text, charIndex = 0) {
    const chars = [...(text || '')];
    if (!chars.length) return null;

    const index = Math.max(0, Math.min(chars.length - 1, charIndex));
    const isJp = ch => /[\u4E00-\u9FAF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF々ヶー]/.test(ch);
    if (!isJp(chars[index])) return null;

    let runStart = index;
    let runEnd = index + 1;
    while (runStart > 0 && isJp(chars[runStart - 1]) && index - runStart < MAX_ANALYZE_LOOKAROUND) runStart--;
    while (runEnd < chars.length && isJp(chars[runEnd]) && runEnd - index < MAX_ANALYZE_LOOKAROUND) runEnd++;

    const candidates = [];
    const seen = new Set();
    for (let start = runStart; start <= index; start++) {
      for (let end = index + 1; end <= runEnd; end++) {
        const surface = chars.slice(start, end).join('');
        if (surface.length > 18 || seen.has(surface)) continue;
        seen.add(surface);
        const results = await this.lookupWord(surface);
        if (!results.length) continue;
        const bestEntry = results[0];
        candidates.push({
          surface,
          start,
          end,
          results,
          entry: bestEntry,
          length: [...surface].length,
          isCommon: !!bestEntry.isCommon,
          exactStart: start === index,
        });
      }
    }

    candidates.sort((a, b) => {
      if (a.isCommon !== b.isCommon) return a.isCommon ? -1 : 1;
      if (a.length !== b.length) return b.length - a.length;
      const aCenter = (a.start + a.end - 1) / 2;
      const bCenter = (b.start + b.end - 1) / 2;
      const aDistance = Math.abs(index - aCenter);
      const bDistance = Math.abs(index - bCenter);
      if (aDistance !== bDistance) return aDistance - bDistance;
      return a.start - b.start;
    });

    return candidates[0] || null;
  }

  async lookupKanji(char) {
    if (!char) return null;
    const chars = await this._loadBundledKanjidic();
    return chars.get(char) || null;
  }

  async _loadBundledKanjidic() {
    if (this._kanjidicCache) return this._kanjidicCache;
    const response = await fetch(BUNDLED_PATHS.kanjidic);
    if (!response.ok) return new Map();
    const data = await response.json();
    this._kanjidicCache = new Map((data.characters || []).map(entry => [entry.literal, this._normalizeKanjidicEntry(entry)]));
    return this._kanjidicCache;
  }

  _normalizeKanjidicEntry(entry) {
    const groups = entry.readingMeaning?.groups || [];
    const readings = groups.flatMap(g => g.readings || []);
    const meanings = groups.flatMap(g => g.meanings || [])
      .filter(m => !m.lang || m.lang === 'en')
      .map(m => typeof m === 'string' ? m : m.value)
      .filter(Boolean);
    const existingMeanings = Array.isArray(entry.meanings) && entry.meanings.length ? entry.meanings : null;
    const existingOnyomi = Array.isArray(entry.readingsOnYomi) && entry.readingsOnYomi.length
      ? entry.readingsOnYomi
      : Array.isArray(entry.readingJa?.onyomi) && entry.readingJa.onyomi.length
        ? entry.readingJa.onyomi
        : Array.isArray(entry.onyomi) && entry.onyomi.length
          ? entry.onyomi
          : null;
    const existingKunyomi = Array.isArray(entry.readingsKunYomi) && entry.readingsKunYomi.length
      ? entry.readingsKunYomi
      : Array.isArray(entry.readingJa?.kunyomi) && entry.readingJa.kunyomi.length
        ? entry.readingJa.kunyomi
        : Array.isArray(entry.kunyomi) && entry.kunyomi.length
          ? entry.kunyomi
          : null;
    return {
      literal: entry.literal,
      meanings: existingMeanings || meanings,
      onyomi: existingOnyomi || readings.filter(r => r.type === 'ja_on').map(r => r.value),
      kunyomi: existingKunyomi || readings.filter(r => r.type === 'ja_kun').map(r => r.value),
      grade: entry.grade || entry.misc?.grade || null,
      strokeCount: entry.strokeCount || entry.misc?.strokeCounts?.[0] || null,
      jlpt: entry.jlptLevel || entry.misc?.jlptLevel || null,
      freq: entry.frequency || entry.misc?.frequency || null,
    };
  }
}

export const dictionaryService = new DictionaryService();
export default dictionaryService;
