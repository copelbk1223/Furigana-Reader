/**
 * Reader — Main Entry Point
 */
import './styles/index.css';
import './styles/library.css';
import './styles/reader.css';
import './styles/dictionary.css';
import './styles/settings.css';

import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import router from './utils/router.js';
import settingsService from './services/SettingsService.js';
import { createBottomNav, updateBottomNav, setBottomNavVisible } from './components/BottomNav.js';
import { renderHomePage } from './pages/HomePage.js';
import { renderLibraryPage } from './pages/LibraryPage.js';
import { renderReaderPage } from './pages/ReaderPage.js';
import { renderSettingsPage } from './pages/SettingsPage.js';

const app = document.getElementById('app');
const pageContainer = document.createElement('main');
pageContainer.id = 'page-container';
app.appendChild(pageContainer);

const bottomNav = createBottomNav();
app.appendChild(bottomNav);

router.on('/home', async () => { await renderHomePage(pageContainer); });
router.on('/library', async () => { await renderLibraryPage(pageContainer); });
router.on('/read/:id', async (params) => { await renderReaderPage(pageContainer, params); });
router.on('/settings', async () => { await renderSettingsPage(pageContainer); });

router.after((path) => {
  const routeName = router.getRouteName();
  updateBottomNav(routeName);
  setBottomNavVisible(routeName !== 'read');
  if (routeName !== 'read') settingsService.set('lastRoute', path);
});

// Hardware Back Button handler for Android
if (Capacitor.isNativePlatform()) {
  CapacitorApp.addListener('backButton', () => {
    // If exit popup is already open, close it (acting like a cancel)
    const exitPopup = document.querySelector('.r-exit-popup');
    if (exitPopup) { exitPopup.querySelector('#ep-cancel').click(); return; }

    // Close overlays in reverse order of precedence
    const imgViewer = document.querySelector('.r-image-viewer');
    if (imgViewer) { imgViewer.remove(); return; }
    
    const toc = document.querySelector('.r-toc');
    if (toc) { toc.remove(); return; }

    const sheet = document.querySelector('.r-sheet');
    if (sheet) { sheet.remove(); return; }

    const search = document.querySelector('.r-search:not(.hide)');
    if (search) {
      search.classList.add('hide');
      document.getElementById('s-results')?.classList.add('hide');
      return;
    }

    const dictFull = document.querySelector('.dp-full');
    if (dictFull) {
      dictFull.classList.add('out');
      setTimeout(() => dictFull.remove(), 280);
      return;
    }

    const dictMini = document.querySelector('.dp-overlay');
    if (dictMini) {
      window.dispatchEvent(new CustomEvent('reader:lookup-cleanup'));
      dictMini.classList.add('out');
      dictMini.querySelector('.dp-mini')?.classList.add('out');
      setTimeout(() => dictMini.remove(), 200);
      return;
    }

    // Handle navigation back
    const routeName = router.getRouteName();
    if (routeName === 'read' || routeName !== 'home') {
      if (window.history.length > 2) {
        window.history.back();
      } else {
        window.location.hash = '/home';
      }
      return;
    }

    // If on home page and no overlays are open, show exit confirmation popup
    const popup = document.createElement('div');
    popup.className = 'r-exit-popup';
    popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;opacity:0;transition:opacity 0.2s ease';
    popup.innerHTML = `
      <div style="background:var(--bg);padding:24px;border-radius:16px;width:280px;text-align:center;transform:scale(0.9);transition:transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)">
        <h3 style="margin:0 0 8px 0;font-size:18px;color:var(--text)">Exit App?</h3>
        <p style="margin:0 0 24px 0;font-size:14px;color:var(--text);opacity:0.7">Are you sure you want to close the app?</p>
        <div style="display:flex;gap:12px">
          <button id="ep-cancel" class="r-btn" style="flex:1;background:var(--bg-panel);color:var(--text);border:none;padding:12px;border-radius:8px;font-weight:bold;cursor:pointer">Cancel</button>
          <button id="ep-exit" class="r-btn" style="flex:1;background:var(--primary);color:#fff;border:none;padding:12px;border-radius:8px;font-weight:bold;cursor:pointer">Exit</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);
    
    requestAnimationFrame(() => {
      popup.style.opacity = '1';
      popup.querySelector('div').style.transform = 'scale(1)';
    });
    
    popup.querySelector('#ep-cancel').onclick = () => {
      popup.style.opacity = '0';
      popup.querySelector('div').style.transform = 'scale(0.9)';
      setTimeout(() => popup.remove(), 200);
    };
    
    popup.querySelector('#ep-exit').onclick = () => {
      popup.style.opacity = '0';
      setTimeout(() => {
        popup.remove();
        if (CapacitorApp.minimizeApp) CapacitorApp.minimizeApp();
        else CapacitorApp.exitApp();
      }, 200);
    };
  });
}

settingsService.get('theme');
if (!window.location.hash) window.location.hash = '/home';

console.log('Reader initialized');
