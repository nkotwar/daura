/* TASC Connect · Profile tab: who you are, which Gmails open your profile, sign out, app version. */

async function viewProfile() {
  const me = S.who.me;
  const main = TV();
  main.innerHTML = `${S.updateReady ? updateBar() : ''}
    ${me ? profileCard(me, null) + `<div class="row wrap" style="margin:-4px 0 14px">
        <span class="badge acc">${roleLabel(me.role)}</span>${me.is_branch_head ? '<span class="badge ok">Branch head: verifies branch visits</span>' : ''}
        ${S.who.admin && me.role !== 'admin' ? '<span class="badge acc">Admin</span>' : ''}</div>`
      : `<div class="card"><h3>Admin</h3><p class="muted">Signed in as ${esc(S.who.gmail)} without a staff profile.</p></div>`}
    ${me ? `<h2>Gmails that open your profile</h2><div id="logins"><div class="spin" style="margin:16px auto"></div></div>
    <p class="hint">If you see a Gmail here that isn't yours, remove it and tell the Regional Office.</p>` : ''}
    ${S.who.admin ? `<h2>Photo storage</h2><div id="storebox"><div class="spin" style="margin:16px auto"></div></div>` : ''}
    <h2>TASC Connect</h2>
    <div class="list">
      <button class="item" data-about><div class="grow"><div class="t">About TASC Connect</div><div class="s">A short field guide</div></div><span class="chev">${ICON.chev}</span></button>
      <div class="item" style="cursor:default"><div class="grow"><div class="t">Synced ${syncedAgo()}</div><div class="s">Pull down at the top of any tab to sync now</div></div>
        <button class="btn small ghost" id="syncnow">Sync</button></div>
    </div>
    <h2>Sign out</h2>
    <div class="stack">
      <button class="btn ghost block" id="so">${ICON.logout} Sign out on this phone</button>
      <button class="btn ghost block" id="soall">Sign out on all devices</button>
    </div>
    <div class="foot"><img src="cbi-emblem.png" alt="">TASC Connect · version ${APP_VERSION}<br>Built by Nitin Kotwar (139535), via PDUDAIRO</div>`;
  $('#so').onclick = async () => { if (await confirmSheet('Sign out?', 'You can sign in again any time with Google.', 'Sign out')) signOut('local'); };
  $('#soall').onclick = async () => {
    if (await confirmSheet('Sign out everywhere?', `Every phone or computer signed in as <b>${esc(S.who.gmail)}</b> is signed out, including this one.`, 'Sign out everywhere')) signOut('global');
  };
  bindUpdate();
  $('#syncnow').onclick = async () => { const b = $('#syncnow'); b.disabled = true; b.textContent = 'Syncing…';
    try { await syncAndRefresh(); toast('Synced'); } catch (e) { toast(errText(e)); } viewProfile(); };
  if (me) loadLogins();
  if (S.who.admin) storageBox();
}

async function loadLogins() {
  const el = $('#logins'); if (!el) return;
  const paint = rows => {
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
      try { await rpc('unlink_my_login', { p_gmail: b.dataset.rm }); S.cache.logins = null; toast('Removed'); if (cur) signOut('local'); else loadLogins(); }
      catch (e) { toast(errText(e)); }
    });
  };
  if (S.cache.logins) paint(S.cache.logins);   // show the last list straight away, then refresh
  try { S.cache.logins = await rpc('my_logins'); if (el.isConnected) paint(S.cache.logins); }
  catch (e) {
    if (S.cache.logins) return;   // keep showing what we had
    el.innerHTML = `<div class="row"><p class="hint grow" style="margin:0">${esc(errText(e))}</p><button class="btn small ghost" id="lgr">Try again</button></div>`;
    $('#lgr', el).onclick = () => { el.innerHTML = '<div class="spin" style="margin:16px auto"></div>'; loadLogins(); };
  }
}

/* Admin: photo storage used, out of the free 1 GB (asked at most once a day) */
async function storageBox() {
  const el = $('#storebox'); if (!el) return;
  let bytes = null;
  try { const c = JSON.parse(localStorage.getItem('daura-storage') || 'null'); if (c && Date.now() - c.at < 864e5) bytes = c.bytes; } catch (e) { /* storage blocked */ }
  if (bytes == null) { try { bytes = await rpc('admin_storage_bytes'); localStorage.setItem('daura-storage', JSON.stringify({ at: Date.now(), bytes })); } catch (e) { /* shown as unknown */ } }
  const mb = bytes == null ? null : bytes / 1048576;
  const pct = mb == null ? 0 : Math.min(100, mb / 1024 * 100);
  const cls = mb >= 800 ? 'bad' : mb >= 600 ? 'warn' : '';
  el.innerHTML = `<div class="card">${mb == null ? '<div class="row"><p class="hint grow" style="margin:0">Could not read storage use right now.</p><button class="btn small ghost" id="stg-r">Try again</button></div>' : `
    <div class="meter ${cls}"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="row"><span class="mono">${mb.toFixed(mb < 10 ? 1 : 0)} MB</span><span class="grow"></span><span class="hint">of 1 GB free</span></div>
    ${mb >= 800 ? `<div class="note bad" style="margin-top:10px"><b>Over 800 MB.</b> Time to move photos to Google Drive. Follow "Moving photos to Drive" in SETUP.md.</div>`
      : '<p class="hint" style="margin-bottom:0">Checked once a day. You will see a warning here at 800 MB.</p>'}`}</div>`;
  const r = $('#stg-r', el); if (r) r.onclick = () => { el.innerHTML = '<div class="spin" style="margin:16px auto"></div>'; storageBox(); };
}

/* App updates: the service worker keeps the app working offline; a new version.js means new files are waiting. */
const updateBar = () => `<div class="update-bar">Version ${S.updateReady} is available.<button id="upd">Update now</button></div>`;
function bindUpdate() { $$('[id="upd"]').forEach(b => { b.onclick = applyUpdate; }); }
async function checkForUpdate() {
  try {
    const t = await (await fetch('version.js?t=' + Date.now(), { cache: 'no-store' })).text();
    const v = +(t.match(/APP_VERSION\s*=\s*(\d+)/) || [])[1];
    if (v && v > APP_VERSION) { S.updateReady = v; if (S.tab === 'profile' && !$('#upd')) viewProfile(); else toast(`TASC Connect ${v} is ready. Profile → Update now.`); }
  } catch (e) { /* offline */ }
}
async function applyUpdate() {
  const b = $('#upd'); if (b) { b.disabled = true; b.textContent = 'Updating…'; }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      // Wait (up to 8 s) for the new service worker to take over, so the reload gets the new files.
      const took = new Promise(res => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); setTimeout(res, 8000); });
      await reg.update();
      if (reg.installing || reg.waiting) await took;
    }
    const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k)));
  } catch (e) { /* ignore */ }
  try { sessionStorage.setItem('daura-tab', 'profile'); sessionStorage.setItem('daura-updated', String(S.updateReady || '')); } catch (e) { /* storage blocked */ }
  location.reload();
}
