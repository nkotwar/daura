/* TASC Connect · start-up and tab switching. */

const VIEWS = { visits: () => viewVisits(), dashboard: () => viewDashboard(), admin: () => viewAdmin(), profile: () => viewProfile() };

function startApp() {
  if (!S.who) return route();
  try {
    const w = JSON.parse(sessionStorage.getItem('daura-where') || 'null');
    if (w) { if (w.tab) S.tab = w.tab; if (w.vseg) S.cache.vseg = w.vseg; if (w.adminSeg) S.cache.adminSeg = w.adminSeg; }
    const t = sessionStorage.getItem('daura-tab'); const want = +sessionStorage.getItem('daura-updated');
    sessionStorage.removeItem('daura-tab'); sessionStorage.removeItem('daura-updated');
    if (t) S.tab = t;
    if (want) setTimeout(() => toast(APP_VERSION >= want ? `Updated to version ${APP_VERSION}` : 'Update still downloading. Close and reopen TASC Connect in a minute.', 3500), 600);
  } catch (e) { /* storage blocked */ }
  setTimeout(flushOutbox, 1500);
  if (!S.who.me && S.who.admin) S.tab = 'admin';
  header(); renderTabs(true); show(S.tab);
  armBack();
}

function remember() {
  try { sessionStorage.setItem('daura-where', JSON.stringify({ tab: S.tab, vseg: S.cache.vseg, adminSeg: S.cache.adminSeg })); } catch (e) { /* storage blocked */ }
}

function show(tab) {
  if (!VIEWS[tab] || (tab === 'admin' && !S.who.admin) || (tab === 'dashboard' && !S.who.viewer)) tab = 'visits';
  const main = $('#main');
  S.scrollAt = S.scrollAt || {};
  if (S.tab && main.querySelector('.tabview')) S.scrollAt[S.tab] = window.scrollY;   // remember where you were in the tab you leave
  [...main.children].forEach(c => { if (!c.classList.contains('tabview')) c.remove(); });   // clear sign-in / loading screens
  let tv = main.querySelector(`:scope > .tabview[data-tab="${tab}"]`);
  const fresh = !tv;
  if (fresh) { tv = document.createElement('div'); tv.className = 'tabview'; tv.dataset.tab = tab; main.appendChild(tv); }
  $$(':scope > .tabview', main).forEach(x => { x.hidden = x !== tv; });
  S.tab = tab; renderTabs(true); remember(); if (typeof updateFab === 'function') updateFab();
  window.scrollTo(0, fresh ? 0 : (S.scrollAt[tab] || 0));
  VIEWS[tab]();
}

$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });

async function boot() {
  header();
  if (!configured) { screenSignIn(); return; }
  $('#main').innerHTML = '<div class="spin"></div>';
  sb.auth.onAuthStateChange((event) => {
    // Signed out elsewhere ("sign out on all devices") or session expired.
    if (event === 'SIGNED_OUT' && S.who) { S.who = null; S.cache = {}; forgetSnap(); screenSignIn({ kind: 'warn', html: 'You have been signed out.' }); }
  });
  await route();
  checkForUpdate();
  flushOutbox();
}

// Coming back to the app after 2+ minutes: one quiet sync (it also notices if access was paused).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.who || S.who.state !== 'linked') return;
  flushOutbox();
  if (Date.now() - DB.at > SYNC_AGAIN_MS) { syncAndRefresh().catch(() => {}); checkForUpdate(); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
boot();
