/* Daura · Profile tab: who you are, which Gmails open your profile, sign out, app version. */

async function viewProfile() {
  const me = S.who.me;
  const main = $('#main');
  main.innerHTML = `${S.updateReady ? updateBar() : ''}
    ${me ? profileCard(me, null) + `<div class="row wrap" style="margin:-4px 0 14px">
        <span class="badge acc">${roleLabel(me.role)}</span>${me.is_branch_head ? '<span class="badge ok">Branch head: verifies branch visits</span>' : ''}
        ${S.who.admin && me.role !== 'admin' ? '<span class="badge acc">Admin</span>' : ''}</div>`
      : `<div class="card"><h3>Admin</h3><p class="muted">Signed in as ${esc(S.who.gmail)} without a staff profile.</p></div>`}
    ${me ? `<h2>Gmails that open your profile</h2><div id="logins"><div class="spin" style="margin:16px auto"></div></div>
    <p class="hint">If you see a Gmail here that isn't yours, remove it and tell the Regional Office.</p>` : ''}
    <h2>Sign out</h2>
    <div class="stack">
      <button class="btn ghost block" id="so">${ICON.logout} Sign out on this phone</button>
      <button class="btn ghost block" id="soall">Sign out on all devices</button>
    </div>
    <div class="foot"><img src="cbi-emblem.png" alt="">Daura · version ${APP_VERSION}<br>Built by Nitin Kotwar (139535), via PDUDAIRO</div>`;
  $('#so').onclick = async () => { if (await confirmSheet('Sign out?', 'You can sign in again any time with Google.', 'Sign out')) signOut('local'); };
  $('#soall').onclick = async () => {
    if (await confirmSheet('Sign out everywhere?', `Every phone or computer signed in as <b>${esc(S.who.gmail)}</b> is signed out, including this one.`, 'Sign out everywhere')) signOut('global');
  };
  bindUpdate();
  if (me) loadLogins();
}

async function loadLogins() {
  const el = $('#logins'); if (!el) return;
  try {
    const rows = await rpc('my_logins');
    el.innerHTML = `<div class="list">${rows.map(r => `<div class="item" style="cursor:default">
        <div class="grow"><div class="t" style="overflow-wrap:anywhere">${esc(r.gmail)}</div>
          <div class="s">${r.is_current ? 'This phone · ' : ''}linked ${fmtDate(r.linked_at)} · last used ${ago(r.last_seen)}</div></div>
        <button class="btn small danger" data-rm="${esc(r.gmail)}" data-cur="${r.is_current ? 1 : ''}">Remove</button></div>`).join('')}</div>`;
    $$('[data-rm]', el).forEach(b => b.onclick = async () => {
      const cur = !!b.dataset.cur;
      const ok = await confirmSheet('Remove this Gmail?', cur
        ? `<b>${esc(b.dataset.rm)}</b> is the Gmail you are using now. You will be signed out and will need to confirm your profile again to come back.`
        : `<b>${esc(b.dataset.rm)}</b> will no longer open your profile.`, 'Remove', true);
      if (!ok) return;
      try { await rpc('unlink_my_login', { p_gmail: b.dataset.rm }); toast('Removed'); if (cur) signOut('local'); else loadLogins(); }
      catch (e) { toast(errText(e)); }
    });
  } catch (e) { el.innerHTML = `<p class="hint">${esc(errText(e))}</p>`; }
}

/* App updates: the service worker keeps the app working offline; a new version.js means new files are waiting. */
const updateBar = () => `<div class="update-bar">Version ${S.updateReady} is available.<button id="upd">Update now</button></div>`;
function bindUpdate() { const b = $('#upd'); if (b) b.onclick = applyUpdate; }
async function checkForUpdate() {
  try {
    const t = await (await fetch('version.js?t=' + Date.now(), { cache: 'no-store' })).text();
    const v = +(t.match(/APP_VERSION\s*=\s*(\d+)/) || [])[1];
    if (v && v > APP_VERSION) { S.updateReady = v; if (S.tab === 'profile' && !$('#upd')) viewProfile(); else toast(`Daura ${v} is ready. Profile → Update now.`); }
  } catch (e) { /* offline */ }
}
async function applyUpdate() {
  try {
    const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k)));
    const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update();
  } catch (e) { /* ignore */ }
  location.reload();
}
