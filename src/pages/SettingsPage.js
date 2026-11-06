/**
 * Settings Page v3 — includes all dictionary data sources
 */
import settingsService from '../services/SettingsService.js';
import dictionaryService from '../services/DictionaryService.js';

export async function renderSettingsPage(container) {
  container.innerHTML = '';
  const s = settingsService.getAll();
  const jm = await dictionaryService.isLoaded('jmdict');
  const kd = await dictionaryService.isLoaded('kanjidic');
  const extra = await dictionaryService.getSourceStatus();
  const page = document.createElement('div');
  page.className = 'page';
  page.innerHTML = `<header class="page-header"><h1>Settings</h1></header><div class="settings-body">
    <div class="s-card"><div class="s-card-title">Appearance</div>
      <div class="s-row"><label>Theme</label>
        <div class="s-theme-row">
          <button class="s-theme-btn ${s.theme==='dark'?'on':''}" data-t="dark">Dark</button>
          <button class="s-theme-btn ${s.theme==='light'?'on':''}" data-t="light">Light</button>
          <button class="s-theme-btn ${s.theme==='sepia'?'on':''}" data-t="sepia">Sepia</button>
        </div>
      </div>
      <div class="s-row"><label>Reader Font</label><select class="sel" id="font-family">
        ${['Noto Sans JP','Yu Gothic','Meiryo','Hiragino Sans','serif','sans-serif'].map(f => `<option value="${f}" ${s.fontFamily===f?'selected':''}>${f}</option>`).join('')}
      </select></div>
    </div>
    <div class="s-card"><div class="s-card-title">Furigana</div>
      <div class="s-row"><label>Enable</label><label class="toggle"><input type="checkbox" id="fg-tog" ${s.furiganaEnabled?'checked':''}><span class="toggle-track"></span></label></div>
      <div class="s-row"><label>Mode</label><select class="sel" id="fg-mode"><option value="hiragana" ${s.furiganaMode==='hiragana'?'selected':''}>Hiragana</option><option value="romaji" ${s.furiganaMode==='romaji'?'selected':''}>Romaji</option></select></div>
      <div class="s-row"><label>Color</label><div class="s-color-control"><input type="color" id="fg-color" value="${s.furiganaColor || '#4ec9b0'}"><input class="s-color-text" id="fg-color-text" value="${s.furiganaColor || '#4ec9b0'}" maxlength="9"></div></div>
    </div>
    <div class="s-card"><div class="s-card-title">Dictionaries</div>
      <p class="s-hint">Core libraries are pre-bundled offline. Enable them for in-memory fast lookup.</p>
      <div class="s-row s-dict-row">
        <div>
          <label>JMdict (Japanese-Multilingual Dictionary)</label>
          <p class="s-sub">Definitions and translations: English, French, German, Russian, and more</p>
          <span class="s-dict-status ${jm?'ok':''}" id="jmdict-status">${jm?'Enabled':'Disabled'}</span>
        </div>
        <button class="btn btn-sm ${jm?'btn-danger':'btn-primary'}" id="jm-btn">${jm?'Disable':'Enable'}</button>
      </div>
      <div id="jm-prog" class="s-prog-wrap" style="display:none"><div class="s-prog-bar"><div class="s-prog-fill" id="jm-fill"></div></div></div>
      <div class="s-row s-dict-row">
        <div>
          <label>KANJIDIC</label>
          <p class="s-sub">Kanji readings, meanings, grade, JLPT, stroke count, and frequency</p>
          <span class="s-dict-status ${kd?'ok':''}" id="kanjidic-status">${kd?'Enabled':'Disabled'}</span>
        </div>
        <button class="btn btn-sm ${kd?'btn-danger':'btn-primary'}" id="kd-btn">${kd?'Disable':'Enable'}</button>
      </div>
      <div id="kd-prog" class="s-prog-wrap" style="display:none"><div class="s-prog-bar"><div class="s-prog-fill" id="kd-fill"></div></div></div>
    </div>
    <div class="s-card"><div class="s-card-title">Additional Data Sources</div>
      <p class="s-hint">These bundled offline libraries enhance lookup with synonyms, example sentences, and additional source definitions.</p>
      <div class="s-row s-dict-row s-dict-external">
        <div>
          <label>WordNet (JPN/ENG)</label>
          <p class="s-sub">Synonyms, semantic links, word relationships</p>
          <span class="s-dict-status ${extra.wordnet?'ok':''}" id="wordnet-status">${extra.wordnet?'Enabled':'Disabled'}</span>
        </div>
        <button class="btn btn-sm ${extra.wordnet?'btn-danger':'btn-primary'}" id="wn-btn">${extra.wordnet?'Disable':'Enable'}</button>
      </div>
      <div id="wn-prog" class="s-prog-wrap" style="display:none"><div class="s-prog-bar"><div class="s-prog-fill" id="wn-fill"></div></div></div>
      <div class="s-row s-dict-row s-dict-external">
        <div>
          <label>Tanaka Corpus</label>
          <p class="s-sub">250,000+ example sentences with translations</p>
          <span class="s-dict-status ${extra.tanaka?'ok':''}" id="tanaka-status">${extra.tanaka?'Enabled':'Disabled'}</span>
        </div>
        <button class="btn btn-sm ${extra.tanaka?'btn-danger':'btn-primary'}" id="tk-btn">${extra.tanaka?'Disable':'Enable'}</button>
      </div>
      <div id="tk-prog" class="s-prog-wrap" style="display:none"><div class="s-prog-bar"><div class="s-prog-fill" id="tk-fill"></div></div></div>
      <div class="s-row s-dict-row s-dict-external">
        <div>
          <label>Wiktionary / Wikidata</label>
          <p class="s-sub">Additional definitions, proper names, places</p>
          <span class="s-dict-status ${extra.wiktionary?'ok':''}" id="wiktionary-status">${extra.wiktionary?'Enabled':'Disabled'}</span>
        </div>
        <button class="btn btn-sm ${extra.wiktionary?'btn-danger':'btn-primary'}" id="wk-btn">${extra.wiktionary?'Disable':'Enable'}</button>
      </div>
      <div id="wk-prog" class="s-prog-wrap" style="display:none"><div class="s-prog-bar"><div class="s-prog-fill" id="wk-fill"></div></div></div>
    </div>
    <div class="s-card"><div class="s-card-title">About</div><p class="s-about">Reader v1.0 — Japanese EPUB reader.<br>foliate-js · JMdict · KANJIDIC · WordNet · Tanaka Corpus · Wiktionary/Wikidata · kuroshiro</p></div>
  </div>`;
  container.appendChild(page);

  page.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { settingsService.set('theme', b.dataset.t); page.querySelectorAll('[data-t]').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  page.querySelector('#font-family').onchange = e => settingsService.set('fontFamily', e.target.value);
  page.querySelector('#fg-tog').onchange = e => settingsService.set('furiganaEnabled', e.target.checked);
  page.querySelector('#fg-mode').onchange = e => settingsService.set('furiganaMode', e.target.value);
  page.querySelector('#fg-color').oninput = e => { settingsService.set('furiganaColor', e.target.value); page.querySelector('#fg-color-text').value = e.target.value; };
  page.querySelector('#fg-color-text').onchange = e => {
    const color = normalizeColor(e.target.value, s.furiganaColor || '#4ec9b0');
    e.target.value = color;
    page.querySelector('#fg-color').value = color;
    settingsService.set('furiganaColor', color);
  };

  const updateRowState = (name, isEnabled) => {
    const btnIdMap = {
      jmdict: '#jm-btn',
      kanjidic: '#kd-btn',
      wordnet: '#wn-btn',
      tanaka: '#tk-btn',
      wiktionary: '#wk-btn',
    };
    const btn = page.querySelector(btnIdMap[name]);
    const status = page.querySelector(`#${name}-status`);

    if (btn) {
      btn.textContent = isEnabled ? 'Disable' : 'Enable';
      btn.classList.toggle('btn-danger', isEnabled);
      btn.classList.toggle('btn-primary', !isEnabled);
    }
    if (status) {
      status.textContent = isEnabled ? 'Enabled' : 'Disabled';
      status.classList.toggle('ok', isEnabled);
    }
  };

  const setupToggle = (name, btnId, progId, fillId, label) => {
    const btn = page.querySelector(btnId);
    const prog = page.querySelector(progId);
    const fill = page.querySelector(fillId);
    if (!btn) return;

    btn.onclick = async () => {
      const loaded = await dictionaryService.isLoaded(name);
      if (loaded) {
        await dictionaryService.disable(name);
        updateRowState(name, false);
      } else {
        if (prog) prog.style.display = 'block';
        if (fill) fill.style.width = '0%';
        btn.disabled = true;
        try {
          await dictionaryService.enable(name, p => {
            if (fill) fill.style.width = p + '%';
          });
          updateRowState(name, true);
        } catch (e) {
          alert(`Could not enable ${label}: ${e.message}`);
        } finally {
          if (prog) prog.style.display = 'none';
          btn.disabled = false;
        }
      }
    };
  };

  setupToggle('jmdict', '#jm-btn', '#jm-prog', '#jm-fill', 'JMdict');
  setupToggle('kanjidic', '#kd-btn', '#kd-prog', '#kd-fill', 'KANJIDIC');
  setupToggle('wordnet', '#wn-btn', '#wn-prog', '#wn-fill', 'WordNet');
  setupToggle('tanaka', '#tk-btn', '#tk-prog', '#tk-fill', 'Tanaka Corpus');
  setupToggle('wiktionary', '#wk-btn', '#wk-prog', '#wk-fill', 'Wiktionary / Wikidata');
}

function normalizeColor(value, fallback) {
  const raw = String(value || '').trim();
  const color = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}
