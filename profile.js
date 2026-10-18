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
    ${S.who.admin ? `<h2>Notifications</h2><div id="pushbox"><div class="spin" style="margin:16px auto"></div></div>` : ''}
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
  if (S.who.admin) { pushBox(); storageBox(); }
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
  el.innerHTML = `<div class="card">${mb == null ? '<p class="hint" style="margin:0">Could not read storage use.</p>' : `
    <div class="meter ${cls}"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="row"><span class="mono">${mb.toFixed(mb < 10 ? 1 : 0)} MB</span><span class="grow"></span><span class="hint">of 1 GB free</span></div>
    ${mb >= 800 ? `<div class="note bad" style="margin-top:10px"><b>Over 800 MB.</b> Time to move photos to Google Drive. Follow "Moving photos to Drive" in SETUP.md.</div>`
      : '<p class="hint" style="margin-bottom:0">Checked once a day. You will see a warning here at 800 MB.</p>'}`}</div>`;
}

/* ───────── Admin notifications (this phone only) ───────── */
const PUSH_KINDS = [
  ['visits', 'New visits'], ['requests', 'Requests'], ['verify', 'Verifications'],
  ['signins', 'New sign-ins'], ['alerts', 'Wrong date-of-birth tries'], ['admin', 'Other admin changes']
];
const PUSH_DEFAULT = ['visits', 'requests', 'alerts'];
const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!DAURA_CONFIG.vapidPublicKey;
const keyBytes = b64 => { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };

async function pushBox() {
  const el = $('#pushbox'); if (!el) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!pushOK()) {
    el.innerHTML = `<div class="card"><p class="muted" style="margin:0">${ios && !installed
      ? 'On iPhone, notifications work only after you add TASC Connect to the Home Screen (Share → Add to Home Screen) and open it from there.'
      : 'This browser can’t show notifications. Try Chrome on Android, or the installed app.'}</p></div>`;
    return;
  }
  let sub = null, kinds = null;
  try {
    const reg = await navigator.serviceWorker.ready;
    sub = await reg.pushManager.getSubscription();
    if (sub) kinds = await rpc('my_push_kinds', { p_endpoint: sub.endpoint });
  } catch (e) { el.innerHTML = `<p class="hint">${/my_push_kinds/.test(String(e && e.message)) ? 'Run the version 16 database update first (SETUP.md).' : esc(errText(e))}</p>`; return; }
  const on = !!(sub && kinds), blocked = Notification.permission === 'denied';
  const pick = new Set(on ? kinds : PUSH_DEFAULT);
  el.innerHTML = `<div class="card">
      <div class="row"><div class="grow"><div class="t" style="font-weight:600">${on ? 'On for this phone' : 'Off on this phone'}</div>
        <div class="s muted" style="font-size:13px">${blocked ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then come back.' : 'Activity from staff, as it happens. Your own actions don’t notify you.'}</div></div>
        <button class="btn small ${on ? 'ghost' : ''}" id="pushtog" ${blocked ? 'disabled' : ''}>${on ? 'Turn off' : 'Turn on'}</button></div>
      <div class="chips wrap" id="pushkinds">${PUSH_KINDS.map(([k, l]) => `<button class="chip ${pick.has(k) ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      <p class="hint" style="margin:0">Pick what to be told about. ${on ? 'Changes save straight away.' : 'Then tap Turn on.'}</p></div>`;
  const chosen = () => $$('#pushkinds .chip.on').map(b => b.dataset.k);
  const save = async (s) => rpc('save_push_subscription', { p_sub: s.toJSON(), p_kinds: chosen() });
  $$('#pushkinds .chip').forEach(b => b.onclick = async () => {
    b.classList.toggle('on');
    if (on) { try { await save(sub); toast('Saved'); } catch (e) { b.classList.toggle('on'); toast(errText(e)); } }
  });
  $('#pushtog').onclick = async () => {
    const t = $('#pushtog'); t.disabled = true;
    try {
      if (on) {
        await rpc('remove_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe(); toast('Notifications off');
      } else {
        if (!chosen().length) { toast('Pick at least one kind'); t.disabled = false; return; }
        if (await Notification.requestPermission() !== 'granted') { toast('Notifications weren’t allowed'); return pushBox(); }
        const reg = await navigator.serviceWorker.ready;
        const s = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(DAURA_CONFIG.vapidPublicKey) });
        await save(s); toast('Notifications on');
      }
    } catch (e) { toast(/push_subscription|my_push_kinds/.test(String(e && e.message)) ? 'Run the version 16 database update first (SETUP.md)' : errText(e)); }
    pushBox();
  };
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
