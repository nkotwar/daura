/* Daura · start-up and tab switching. */

const VIEWS = { visits: () => viewVisits(), admin: () => viewAdmin(), profile: () => viewProfile() };

function startApp() {
  if (!S.who) return route();
  setTimeout(flushOutbox, 1500);
  if (!S.who.me && S.who.admin) S.tab = 'admin';
  header(); renderTabs(true); show(S.tab);
}

function show(tab) {
  if (!VIEWS[tab] || (tab === 'admin' && !S.who.admin)) tab = 'visits';
  S.tab = tab; renderTabs(true);
  $('#main').scrollTop = 0; window.scrollTo(0, 0);
  VIEWS[tab]();
}

$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });

async function boot() {
  header();
  if (!configured) { screenSignIn(); return; }
  $('#main').innerHTML = '<div class="spin"></div>';
  sb.auth.onAuthStateChange((event) => {
    // Signed out elsewhere ("sign out on all devices") or session expired.
    if (event === 'SIGNED_OUT' && S.who) { S.who = null; S.cache = {}; screenSignIn({ kind: 'warn', html: 'You have been signed out.' }); }
  });
  await route();
  checkForUpdate();
  flushOutbox();
}

// Re-check identity when the app comes back to the foreground (blocked / unlinked people drop out).
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !S.who || S.who.state !== 'linked') return;
  try {
    const w = await rpc('whoami');
    if (w.state !== 'linked') { S.who = w; route(); }
  } catch (e) { /* offline: keep going */ }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
