/**
 * Furigana Engine — Uses kuroshiro + @patdx/kuromoji for Japanese annotation & Yomiwa-style morphological tokenization
 * Dictionary files are pre-decompressed .dat files served from /dict/
 */
import settingsService from './SettingsService.js';
import { containsJapanese, escapeHtml } from '../utils/helpers.js';

let _kuroshiro = null;
let _analyzer = null;
let _initPromise = null;
let _initFailed = false;

function katakanaToHiragana(str = '') {
  return str.replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

class KuromojiAnalyzerAdapter {
  constructor() { this._tokenizer = null; }

  async init() {
    const kuromoji = await import('@patdx/kuromoji');
    const builderFn = kuromoji.builder || kuromoji.default?.builder;
    if (!builderFn) throw new Error('Could not find kuromoji builder function');

    const loader = {
      async loadArrayBuffer(filename) {
        const datFilename = filename.replace('.gz', '');
        const url = '/dict/' + datFilename;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Dict load failed: ${url} (${response.status})`);
        return await response.arrayBuffer();
      }
    };

    this._tokenizer = await builderFn({ loader }).build();
  }

  parse(str = '') {
    if (!this._tokenizer || str.trim() === '') return Promise.resolve([]);
    const tokens = this._tokenizer.tokenize(str);
    return Promise.resolve(tokens.map(t => ({
      surface_form: t.surface_form,
      pos: t.pos || '*',
      pos_detail_1: t.pos_detail_1 || '*',
      pos_detail_2: t.pos_detail_2 || '*',
      pos_detail_3: t.pos_detail_3 || '*',
      conjugated_type: t.conjugated_type || '*',
      conjugated_form: t.conjugated_form || '*',
      basic_form: t.basic_form || t.surface_form,
      reading: t.reading || '',
      pronunciation: t.pronunciation || t.reading || '',
      verbose: { word_id: t.word_id, word_type: t.word_type, word_position: t.word_position },
    })));
  }
}

class FuriganaEngine {
  async _getKuroshiro() {
    if (_kuroshiro) return _kuroshiro;
    if (_initFailed) return null;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      try {
        const KuroshiroModule = await import('kuroshiro');
        const Kuroshiro = KuroshiroModule.default || KuroshiroModule;
        const instance = new Kuroshiro();
        const analyzer = new KuromojiAnalyzerAdapter();
        await instance.init(analyzer);
        _analyzer = analyzer;
        _kuroshiro = instance;
        console.log('✅ Kuroshiro + Kuromoji ready');
        return _kuroshiro;
      } catch (err) {
        _initPromise = null;
        _initFailed = true;
        console.error('Kuroshiro init error:', err);
        return null;
      }
    })();

    return _initPromise;
  }

  /**
   * Tokenize Japanese text into Yomiwa-style clean grouped words,
   * injecting <ruby> furigana inside the word token wrapper.
   */
  async tokenizeAndAnnotate(text) {
    if (!text || typeof text !== 'string' || !containsJapanese(text)) return null;
    const kuroshiro = await this._getKuroshiro();
    if (!kuroshiro || !_analyzer) return null;

    const settings = settingsService.getAll();
    const furiganaOn = !!settings.furiganaEnabled && settings.furiganaFilter !== 'none';
    const to = settings.furiganaMode === 'romaji' ? 'romaji' : 'hiragana';

    let rawTokens = [];
    try {
      rawTokens = await _analyzer.parse(text);
    } catch {
      return null;
    }
    if (!rawTokens.length) return null;

    // Group grammatical chunks (verbs + auxiliaries, adjectives + inflections, noun + suffixes, te-forms)
    const grouped = [];
    let current = null;

    for (const t of rawTokens) {
      const isAux = t.pos === '助動詞';
      const isConnectiveTe = t.pos === '助詞' && (t.surface_form === 'て' || t.surface_form === 'で');
      const isSuffix = t.pos_detail_1 === '接尾';
      const isVerbFollowup = (isAux || isConnectiveTe || isSuffix) && current && (current.pos === '動詞' || current.pos === '形容詞');
      const isNounSuffix = isSuffix && current && current.pos === '名詞';
      const isSubVerb = current && (current.surface.endsWith('て') || current.surface.endsWith('で')) && (t.surface_form === 'いる' || t.surface_form === 'いた' || t.surface_form === 'おく' || t.surface_form === 'ある' || t.surface_form === 'いらっしゃる');

      if (isVerbFollowup || isNounSuffix || isSubVerb) {
        current.surface += t.surface_form;
        current.reading += (t.reading || t.surface_form);
      } else {
        if (current) grouped.push(current);
        current = {
          surface: t.surface_form,
          base: t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form,
          pos: t.pos,
          pos_detail_1: t.pos_detail_1,
          reading: t.reading || t.surface_form,
        };
      }
    }
    if (current) grouped.push(current);

    let outputHtml = '';
    const isKanjiRegex = /[\u4E00-\u9FAF\u3400-\u4DBF々]/;

    for (const g of grouped) {
      // Punctuation, symbols, and pure whitespace output as plain text
      if (g.pos === '記号' || /^\s+$/.test(g.surface)) {
        outputHtml += escapeHtml(g.surface);
        continue;
      }

      let inner = escapeHtml(g.surface);
      if (furiganaOn && isKanjiRegex.test(g.surface)) {
        try {
          inner = await kuroshiro.convert(g.surface, { mode: 'furigana', to });
        } catch {
          inner = escapeHtml(g.surface);
        }
      }

      const reading = katakanaToHiragana(g.reading || '');
      outputHtml += `<span class="lookup-word" data-word="${escapeHtml(g.surface)}" data-base="${escapeHtml(g.base)}" data-reading="${escapeHtml(reading)}" data-pos="${escapeHtml(g.pos)}">${inner}</span>`;
    }

    return outputHtml;
  }

  async annotate(text) {
    if (!text || typeof text !== 'string' || !containsJapanese(text)) return text;
    const settings = settingsService.getAll();
    if (!settings.furiganaEnabled || settings.furiganaFilter === 'none') return text;

    const kuroshiro = await this._getKuroshiro();
    if (!kuroshiro) return text;

    const to = settings.furiganaMode === 'romaji' ? 'romaji' : 'hiragana';
    try {
      return await kuroshiro.convert(text, { mode: 'furigana', to });
    } catch (e) {
      console.warn('Kuroshiro convert error:', e.message);
      return text;
    }
  }

  async warmup() { await this._getKuroshiro(); }
}

export const furiganaEngine = new FuriganaEngine();
export default furiganaEngine;
