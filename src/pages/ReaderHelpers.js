/**
 * Reader Helpers — furigana injection, lookup, style application
 */
import { Capacitor } from '@capacitor/core';
import settingsService from '../services/SettingsService.js';
import furiganaEngine from '../services/FuriganaEngine.js';
import { containsJapanese } from '../utils/helpers.js';
import { showDictionaryPopup } from '../components/DictionaryPopup.js';

let isLookupMode = false;
const isAndroidRuntime = Capacitor.getPlatform?.() === 'android';
let lookupSuppressUntil = 0;
const hookedLookupDocs = new Set();
export function getLookupMode() { return isLookupMode; }
export function setLookupMode(v) { isLookupMode = v; }

export function injectContentHooks(doc, foliateView) {
  if (!doc?.body) return;
  const furiganaOn = settingsService.get('furiganaEnabled');
  const furiganaColor = settingsService.get('furiganaColor') || '#4ec9b0';
  const style = doc.createElement('style');
  style.textContent = `
    ruby { ruby-align: center; break-inside: avoid !important; -webkit-column-break-inside: avoid !important; }
    ruby rt { font-size: 0.55em; color: ${furiganaColor}; font-weight: 400; -webkit-user-select: none !important; user-select: none !important; pointer-events: none !important; line-height: 1 !important; }
    ruby rp { display: none; -webkit-user-select: none !important; user-select: none !important; pointer-events: none !important; }
    body.furigana-hidden ruby rt { visibility: hidden !important; font-size: 0 !important; line-height: 0 !important; }
    body.furigana-hidden ruby rp { display: none !important; }
    body.lookup-mode ruby rt,
    body.lookup-mode ruby rp { -webkit-user-select: none !important; user-select: none !important; pointer-events: none !important; }
    body.lookup-mode { cursor: text !important; -webkit-user-select: text !important; user-select: text !important; }
    body.lookup-mode ::selection { background: rgba(78,201,176,0.32) !important; }
    body.lookup-mode :is(ruby, .furigana-injected > ruby, .lookup-token) {
      text-decoration-line: underline !important;
      text-decoration-style: dotted !important;
      text-decoration-color: rgba(125,125,125,0.45) !important;
      text-decoration-thickness: 1px !important;
      text-underline-offset: 0.16em !important;
      text-decoration-skip-ink: none !important;
    }
  `;
  doc.head.appendChild(style);
  if (!furiganaOn) doc.body.classList.add('furigana-hidden');
  if (isLookupMode) doc.body.classList.add('lookup-mode');

  hookedLookupDocs.add(doc);
  let lookupTimer = null;
  const clearLookupTimer = () => {
    clearTimeout(lookupTimer);
    lookupTimer = null;
  };
  doc.defaultView.__readerClearLookupTimer = clearLookupTimer;
  const scheduleSelectionLookup = (e, delay = 420) => {
    if (Date.now() < lookupSuppressUntil) return;
    clearLookupTimer();
    lookupTimer = setTimeout(() => selectionLookup(doc, e), delay);
  };

  if (isAndroidRuntime) {
    // Android WebView fires selection/touch events as soon as the first kanji
    // is selected. Show a manual CTA instead, so users can expand selection
    // handles before opening the dictionary.
    doc.addEventListener('selectionchange', () => {
      clearLookupTimer();
      notifyLookupSelectionChange(doc);
    });
  } else {
    // Web/desktop keeps the convenient automatic popup after selection.
    doc.addEventListener('selectionchange', () => scheduleSelectionLookup(null, 260));
    doc.addEventListener('touchend', (e) => scheduleSelectionLookup(e, 360), { passive: true });
  }
  doc.addEventListener('mouseup', (e) => scheduleSelectionLookup(e, 260));
  doc.addEventListener('keyup', (e) => scheduleSelectionLookup(e, 260));
}

function extractWordFromClick(doc, e) {
  let target = e.target;
  let reading = '';

  // If we clicked on furigana reading text, redirect to the ruby base
  if (target.closest?.('rt,rp')) target = target.closest('ruby') || target;
  if (target.tagName === 'RT' || target.tagName === 'RP') {
    target = target.closest('ruby') || target;
  }
  if (target.tagName === 'RUBY') reading = target.querySelector('rt')?.textContent || '';

  // Try to get the caret position
  const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY) || doc.caretPositionFromPoint?.(e.clientX, e.clientY);
  let caretNode = range?.startContainer || range?.offsetNode;
  let caretOffset = range?.startOffset ?? range?.offset ?? 0;

  // If caret landed inside an rt/rp, redirect to the ruby parent
  if (caretNode?.nodeType === 3 && caretNode.parentElement?.closest?.('rt,rp')) {
    const ruby = caretNode.parentElement.closest('ruby');
    if (ruby) {
      reading = ruby.querySelector('rt')?.textContent || reading;
      caretNode = ruby;
      caretOffset = 0;
    }
  }

  // Find the furigana-injected wrapper that holds original text
  const injectedWrapper = (caretNode?.nodeType === 1 ? caretNode : caretNode?.parentElement)
    ?.closest?.('.furigana-injected');

  if (injectedWrapper?.dataset?.lookupText) {
    // We have the original EPUB text — use it directly
    const originalText = injectedWrapper.dataset.lookupText;
    // Find which character index the click corresponds to
    const clickIndex = mapClickToOriginalIndex(injectedWrapper, caretNode, caretOffset);
    const token = extractJapaneseToken(originalText, clickIndex);
    if (token.text) {
      return { text: token.text.trim(), reading, context: { text: originalText, index: clickIndex } };
    }
  }

  // No furigana wrapper — plain EPUB text node
  if (caretNode?.nodeType === 3) {
    // Verify click is actually on text, not empty space
    const nodeText = caretNode.textContent || '';
    if (!nodeText.trim()) return { text: '', reading };

    // Build context from parent block element using only base text
    const blockParent = caretNode.parentElement?.closest?.('p,li,blockquote,dd,dt,h1,h2,h3,h4,h5,h6,div,span')
      || caretNode.parentElement;
    const plainText = getPlainText(blockParent);
    // Map offset into the plain text
    const plainIndex = mapNodeOffsetToPlainIndex(blockParent, caretNode, caretOffset);
    const token = extractJapaneseToken(plainText, plainIndex);
    if (token.text) {
      return { text: token.text.trim(), reading, context: { text: plainText, index: plainIndex } };
    }
  }

  // Fallback: ruby element clicked directly
  if (target.tagName === 'RUBY') {
    const base = getPlainText(target);
    return { text: base.trim(), reading };
  }

  return { text: '', reading };
}

/** Get visible base text from a DOM subtree, skipping rt/rp/script/style */
function getPlainText(node) {
  if (!node) return '';
  if (node.nodeType === 3) {
    if (node.parentElement?.closest?.('rt,rp')) return '';
    return node.textContent || '';
  }
  if (node.nodeType !== 1) return '';
  const tag = node.tagName;
  if (tag === 'RT' || tag === 'RP' || tag === 'SCRIPT' || tag === 'STYLE') return '';
  // If this element has saved original text, use that directly
  if (node.dataset?.lookupText) return node.dataset.lookupText;
  let out = '';
  for (const child of node.childNodes) out += getPlainText(child);
  return out;
}

/** Map a click inside an injected wrapper back to a character index in the original text */
function mapClickToOriginalIndex(wrapper, clickedNode, offset) {
  const originalText = wrapper.dataset.lookupText || '';
  // Walk through base text nodes in DOM order, counting characters until we reach the clicked node
  let charCount = 0;
  let found = false;

  const walk = (node) => {
    if (found) return;
    if (node === clickedNode) {
      if (node.nodeType === 3 && !node.parentElement?.closest?.('rt,rp')) {
        charCount += Math.min(offset, (node.textContent || '').length);
      }
      found = true;
      return;
    }
    if (node.nodeType === 3) {
      if (!node.parentElement?.closest?.('rt,rp')) {
        charCount += (node.textContent || '').length;
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'RT' || tag === 'RP') return;
    if (node === clickedNode || node.contains?.(clickedNode)) {
      for (const child of node.childNodes) {
        if (found) return;
        walk(child);
      }
      if (!found) { found = true; } // clicked on the element itself
      return;
    }
    // Not the target — just count base text
    for (const child of node.childNodes) {
      if (found) return;
      if (child.nodeType === 3 && !child.parentElement?.closest?.('rt,rp')) {
        charCount += (child.textContent || '').length;
      } else if (child.nodeType === 1 && child.tagName !== 'RT' && child.tagName !== 'RP') {
        walk(child);
      }
    }
  };

  for (const child of wrapper.childNodes) {
    if (found) break;
    walk(child);
  }

  return Math.max(0, Math.min([...originalText].length - 1, charCount));
}

/** Map a node+offset to an index in the plain text of a parent block */
function mapNodeOffsetToPlainIndex(block, targetNode, offset) {
  let charCount = 0;
  let found = false;

  const walk = (node) => {
    if (found) return;
    if (node === targetNode) {
      if (node.nodeType === 3) charCount += Math.min(offset, (node.textContent || '').length);
      found = true;
      return;
    }
    if (node.nodeType === 3) {
      if (!node.parentElement?.closest?.('rt,rp')) charCount += (node.textContent || '').length;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === 'RT' || tag === 'RP' || tag === 'SCRIPT' || tag === 'STYLE') return;
    if (node.dataset?.lookupText) {
      charCount += node.dataset.lookupText.length;
      return;
    }
    for (const child of node.childNodes) {
      if (found) return;
      walk(child);
    }
  };

  for (const child of block.childNodes) {
    if (found) break;
    walk(child);
  }
  return charCount;
}

function extractJapaneseToken(source = '', offset = 0) {
  if (!source) return { text: '', index: 0 };
  const chars = [...source];
  const charIndex = Math.max(0, Math.min(chars.length - 1, offset));
  const isJp = ch => /[\u4E00-\u9FAF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF々ヶー]/.test(ch);
  if (!isJp(chars[charIndex])) return { text: '', index: charIndex };

  let start = charIndex;
  let end = charIndex + 1;
  while (start > 0 && isJp(chars[start - 1])) start--;
  while (end < chars.length && isJp(chars[end])) end++;
  const token = chars.slice(start, end).join('');
  return { text: token, index: charIndex };
}

export function lookupCurrentSelection(doc = null) {
  const targetDoc = doc || getActiveSelectionDoc();
  if (!targetDoc) return false;
  return selectionLookup(targetDoc, null, { clearSelection: true });
}

export function getActiveSelectionDoc() {
  for (const doc of [...hookedLookupDocs].reverse()) {
    const sel = doc?.getSelection?.();
    const text = normalizeSelectedLookupText(sel?.toString?.() || '');
    if (sel && !sel.isCollapsed && sel.rangeCount && text && containsJapanese(text)) return doc;
  }
  return null;
}

function notifyLookupSelectionChange(doc) {
  const sel = doc?.getSelection?.();
  const text = normalizeSelectedLookupText(sel?.toString?.() || '');
  const hasSelection = !!(isLookupMode && sel && !sel.isCollapsed && sel.rangeCount && text && containsJapanese(text));
  window.dispatchEvent(new CustomEvent('reader:lookup-selection', { detail: { hasSelection } }));
}

function selectionLookup(doc, event = null, options = {}) {
  if (!isLookupMode || Date.now() < lookupSuppressUntil) return false;
  const sel = doc.getSelection?.();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const raw = sel.toString?.() || '';
  const text = normalizeSelectedLookupText(raw);
  if (!text || text.length > 60 || !containsJapanese(text)) return false;

  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
  const rect = getSelectionRect(range);
  const frame = doc.defaultView?.frameElement;
  const frameRect = frame?.getBoundingClientRect?.();
  const touch = event?.changedTouches?.[0] || event?.touches?.[0];
  const position = rect && frameRect
    ? { x: frameRect.left + rect.left, y: frameRect.top + rect.bottom }
    : event && frameRect
      ? { x: frameRect.left + (touch?.clientX ?? event.clientX ?? window.innerWidth / 2), y: frameRect.top + (touch?.clientY ?? event.clientY ?? window.innerHeight / 2) }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  showDictionaryPopup(text, '', { text, index: 0 }, position);
  window.dispatchEvent(new CustomEvent('reader:lookup-selection', { detail: { hasSelection: false } }));
  if (options.clearSelection !== false) clearNativeSelectionSoon(sel, doc);
  return true;
}

function clearNativeSelectionSoon(selection, doc) {
  // Android WebView can leave the native text selection/action state active
  // after our custom popup opens. Clear it shortly after lookup so a later
  // accidental tap does not leave the reader feeling stuck.
  setTimeout(() => clearLookupSelection(doc, selection), 900);
}

function clearLookupSelection(doc, selection = null) {
  try { doc?.defaultView?.__readerClearLookupTimer?.(); }
  catch {}
  try { selection?.removeAllRanges?.(); }
  catch {}
  try { doc?.getSelection?.()?.removeAllRanges?.(); }
  catch {}
  try { doc?.defaultView?.getSelection?.()?.removeAllRanges?.(); }
  catch {}
  try { doc?.activeElement?.blur?.(); }
  catch {}
  try { window.getSelection?.()?.removeAllRanges?.(); }
  catch {}
  try { document.activeElement?.blur?.(); }
  catch {}
}

function cleanupLookupState() {
  lookupSuppressUntil = Date.now() + 900;
  for (const doc of [...hookedLookupDocs]) clearLookupSelection(doc);
}

window.addEventListener('reader:lookup-cleanup', cleanupLookupState);

function getSelectionRect(range) {
  if (!range) return null;
  const rects = [...(range.getClientRects?.() || [])].filter(r => r.width || r.height);
  return rects[rects.length - 1] || range.getBoundingClientRect?.() || null;
}

function normalizeSelectedLookupText(text = '') {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export async function injectFurigana(body) {
  if (!body) return;
  // If the chapter already contains native furigana, do not inject machine furigana
  // to avoid corrupting layout or triggering Chromium multi-column fragmentation crashes.
  if (body.querySelectorAll('ruby').length >= 8) return;

  const ownerDoc = body.ownerDocument;
  const processed = new Set();
  const els = body.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,td,th,span,a,em,strong,b,i,blockquote');
  let processedCount = 0;

  for (const el of [body, ...els]) {
    if (processed.has(el) || el.closest('ruby,rt,rp,script,style,code,pre')) continue;
    if (el.querySelector('p,div,h1,h2,h3,h4,h5,h6,li') && el !== body) continue;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== 3 || !child.textContent.trim() || !containsJapanese(child.textContent)) continue;
      try {
        const annotated = await furiganaEngine.annotate(child.textContent);
        if (annotated && annotated !== child.textContent && annotated.includes('<ruby>')) {
          const w = ownerDoc.createElement('span');
          w.className = 'furigana-injected';
          w.style.breakInside = 'avoid';
          w.dataset.lookupText = child.textContent;
          w.innerHTML = annotated;
          child.parentNode.replaceChild(w, child);
          processed.add(w);
        }
      } catch {}
      processedCount++;
      // Yield to the event loop every 8 nodes to avoid starving the layout thread
      if (processedCount % 8 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    processed.add(el);
  }
}

export function forEachIframeDoc(foliateView, fn) {
  for (const { doc } of (foliateView?.renderer?.getContents?.() || []))
    try { fn(doc); } catch {}
}

export function applyStyles(foliateView) {
  if (!foliateView?.renderer) return;
  const s = settingsService.getAll();
  const colors = {
    dark: { bg: '#0a0a0f', fg: '#d4d4d4', link: '#7dd3fc' },
    light: { bg: '#f8f9fb', fg: '#1a1f2e', link: '#2563eb' },
    sepia: { bg: '#f5eed6', fg: '#3c2d14', link: '#8b5a2b' },
  }[s.theme] || { bg: '#0a0a0f', fg: '#d4d4d4', link: '#7dd3fc' };
  const ta = s.textAlign === 'original' ? 'start' : s.textAlign;
  const dirCss = s.textDirection === 'rtl'
    ? 'writing-mode:vertical-rl!important; direction:ltr!important; text-orientation:mixed!important;'
    : s.textDirection === 'ltr'
      ? 'writing-mode:horizontal-tb!important; direction:ltr!important; text-orientation:mixed!important;'
      : '';
  foliateView.renderer.setStyles?.(`
    @namespace epub "http://www.idpf.org/2007/ops";
    html { background:${colors.bg}!important; }
    body { background:${colors.bg}!important; color:${colors.fg}!important;
      font-family:'${s.fontFamily}','Noto Sans JP',sans-serif!important;
      font-size:${s.fontSize}px!important; font-weight:${s.fontWeight || 400}!important;
      line-height:${s.lineHeight}!important; ${dirCss} }
    iframe, canvas, svg { background-color:${colors.bg}!important; }
    p,li,blockquote,dd { text-align:${ta}!important;
      hanging-punctuation: allow-end last; widows:2; }
    ruby { break-inside: avoid !important; -webkit-column-break-inside: avoid !important; }
    ruby rt { font-size:0.55em!important; color:${s.furiganaColor || '#4ec9b0'}!important; -webkit-user-select:none!important; user-select:none!important; pointer-events:none!important; line-height: 1 !important; }
    ruby rp { -webkit-user-select:none!important; user-select:none!important; pointer-events:none!important; }
    body.furigana-hidden ruby rt { visibility: hidden !important; font-size: 0 !important; line-height: 0 !important; }
    pre { white-space:pre-wrap!important; }
    aside[epub|type~="footnote"],aside[epub|type~="endnote"],
    aside[epub|type~="note"],aside[epub|type~="rearnote"] { display:none; }
  `);
}
