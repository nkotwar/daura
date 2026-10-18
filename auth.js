/* TASC Connect · sign-in: pick your name + date of birth (this phone gets its own sign-in), or Google.
   The database decides which employee a phone or Gmail belongs to. Only the admin needs Google. */

let googleNonce = null;

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function waitForGoogle() {
  return new Promise((res, rej) => {
    let n = 0;
    const t = setInterval(() => {
      if (window.google && google.accounts && google.accounts.id) { clearInterval(t); res(); }
      else if (++n > 100) { clearInterval(t); rej(new Error('Google sign-in did not load. Check your internet and reopen the app.')); }
    }, 100);
  });
}

function screenSignIn(note) {
  header(); renderTabs(false);
  $('#main').innerHTML = `<div class="hero">
      <img src="icon-192.png" alt="">
      <h1>TASC Connect</h1><div class="dev">Trusts · Associations · Societies · Clubs</div>
      <p>Your assigned visits, visit reports with photos, and follow-ups, in one place.</p>
    </div>
    ${note ? `<div class="note ${note.kind || ''}" style="margin-top:12px">${note.html}</div>` : ''}
    ${configured ? `<button class="btn block" id="byname" style="margin-top:18px">${ICON.user} Sign in with your name</button>
      <p class="hint" style="text-align:center">Pick your name and enter your date of birth. This phone stays signed in.</p>
      <div class="orline"><span>or</span></div>
      <div class="gbtn" id="gbtn"><div class="spin" style="margin:6px auto"></div></div>
      <p class="hint" style="text-align:center">Google sign-in works on any phone. Admins use Google.</p>`
      : `<div class="note warn" style="margin-top:20px"><b>Almost there.</b> Fill in <span class="mono">config.js</span> with your Supabase and Google details (SETUP.md, step 4).</div>`}
    <div class="foot"><img src="cbi-emblem.png" alt="">Central Bank of India · via PDUDAIRO</div>`;
  if (configured) {
    mountGoogleButton();
    $('#byname').onclick = async () => {
      const b = $('#byname'); b.disabled = true; b.textContent = 'Opening…';
      try {
        const { error } = await sb.auth.signInAnonymously();
        if (error) throw error;
        await route({ fresh: true });
      } catch (e) {
        screenSignIn({ kind: 'bad', html: (/anonymous.*disabled|disabled.*anonymous/i.test(e.message || '') ? 'Name sign-in is not switched on yet. Please use Google for now.' : 'Name sign-in did not work. Please use Google for now.')
          + `<br><small class="mono">${esc(e.message || String(e))}</small>` });
      }
    };
  }
}

async function mountGoogleButton() {
  try {
    await waitForGoogle();
    const raw = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
    googleNonce = raw;
    google.accounts.id.initialize({
      client_id: DAURA_CONFIG.googleClientId,
      callback: onGoogleCredential,
      nonce: await sha256hex(raw),
      auto_select: false,
      itp_support: true,
      use_fedcm_for_prompt: true
    });
    const el = $('#gbtn'); if (!el) return;
    el.innerHTML = '';
    google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', width: 280 });
  } catch (e) {
    const el = $('#gbtn'); if (el) el.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
  }
}

async function onGoogleCredential(resp) {
  $('#main').innerHTML = '<div class="spin"></div>';
  try {
    const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: resp.credential, nonce: googleNonce });
    if (error) throw error;
    await route();
  } catch (e) {
    screenSignIn({ kind: 'bad', html: esc(errText(e)) });
  }
}

/* After sign-in: decide which screen to show. */
async function route(opts = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { screenSignIn(); return; }
  const u = session.user || {};
  const email = (u.email || (u.is_anonymous ? 'device:' + u.id : '')).toLowerCase();
  if (DB.user !== email) await loadSnap(email);
  // 1. This phone already has a copy: open straight away from it, then sync quietly.
  if (!opts.fresh && DB.who && DB.who.state === 'linked') {
    S.who = DB.who; startApp();
    if (!opts.noSync) syncAndRefresh().catch(e => { if (isNetErr(e)) toast('Offline: showing what is saved on this phone'); });
    return;
  }
  // 2. First time on this phone (or not yet linked): one call brings who you are and, once linked, everything.
  let r;
  try { r = await syncNow({ full: true }); }
  catch (e) {
    if (/JWT|token|session/i.test(e.message || '')) { await sb.auth.signOut({ scope: 'local' }); screenSignIn(); return; }
    screenOffline(e); return;
  }
  const who = r.who; S.who = who;
  if (who.state === 'not_google') { await signOut('local', true); screenSignIn({ kind: 'warn', html: 'Please sign in with a Google account.' }); return; }
  if (who.state === 'blocked') return screenStop('Access paused', 'The admin has paused access for this profile. Please contact the Regional Office.');
  if (who.state === 'inactive') return screenStop('Profile not active', 'Your name is not in the current staff list. If you have been posted to Udaipur RO, please ask the admin to update the staff list.');
  if (who.state === 'email_match') return screenEmailMatch(who);
  if (who.state === 'unlinked') return screenPickName(who);
  startApp();
}

/* Just confirmed who you are: bring everything onto the phone once, then open the app. */
async function enterApp(who) {
  S.who = who;
  $('#main').innerHTML = '<div class="spin"></div><p class="hint" style="text-align:center">Getting your visits ready…</p>';
  try { await syncNow({ full: true }); S.who = DB.who || who; } catch (e) { /* opens with what there is; pull to retry */ }
  toast('Welcome to TASC Connect');
  startApp();
}

function screenOffline(e) {
  header(); renderTabs(false);
  $('#main').innerHTML = `<div class="empty">${ICON.pin}<p><b>Can't reach TASC Connect right now.</b><br>${esc(errText(e))}</p>
    <button class="btn" id="retry">Try again</button></div>`;
  $('#retry').onclick = () => { $('#main').innerHTML = '<div class="spin"></div>'; route(); };
}

function screenStop(title, text) {
  header(); renderTabs(false);
  $('#main').innerHTML = `<div class="card"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
    <p class="hint">Signed in ${S.who.device ? 'with your name on this phone' : 'as ' + esc(S.who.gmail)}</p></div>
    <button class="btn ghost block" id="so">${ICON.logout} Sign out</button>`;
  $('#so').onclick = () => signOut('local');
}

function profileCard(p, gmail) {
  return `<div class="card"><div class="row"><div class="avatar">${esc(initials(p.name))}</div>
      <div class="grow"><h3 style="margin:0">${esc(cleanName(p.name))}</h3><div class="hint">${esc(p.designation || '')}</div></div></div>
      <dl class="kv" style="margin-top:14px">
        <dt>Emp ID</dt><dd class="mono">${esc(p.emp_id)}</dd>
        <dt>Branch</dt><dd>${esc(p.branch || '—')}</dd>
        <dt>Date of birth</dt><dd class="mono">${esc(p.dob || '—')}</dd>
        ${p.phone_last4 ? `<dt>Mobile</dt><dd class="mono">••••••${esc(p.phone_last4)}</dd>` : ''}
        ${gmail ? `<dt>Gmail</dt><dd>${esc(gmail)}</dd>` : ''}
      </dl></div>`;
}

/* Case 1: this Gmail is the one in the staff list. */
function screenEmailMatch(who) {
  header(); renderTabs(false);
  $('#main').innerHTML = `<h2>Is this you?</h2>
    <p class="muted" style="margin-top:0">This Gmail matches a profile in the staff list. Please check the details.</p>
    ${profileCard(who.candidate, who.gmail)}
    <button class="btn block" id="yes">Yes, this is me</button>
    <div class="spacer"></div>
    <button class="btn ghost block" id="no">No, this is not me</button>
    <p class="hint" style="text-align:center;margin-top:18px">Wrong details? You can still continue. Tell the Regional Office so the staff list gets corrected.</p>`;
  $('#yes').onclick = async () => {
    $('#yes').disabled = true;
    try { await enterApp(await rpc('confirm_email_match')); }
    catch (e) { $('#yes').disabled = false; toast(errText(e)); }
  };
  $('#no').onclick = () => screenPickName(who);
}

/* Case 2: a new Gmail. Pick your name, enter date of birth, confirm. */
async function screenPickName(who) {
  header(); renderTabs(false);
  $('#main').innerHTML = '<div class="spin"></div>';
  let list;
  try { list = await rpc('claim_list'); } catch (e) { screenOffline(e); return; }
  let picked = null;
  $('#main').innerHTML = `<h2>Find your name</h2>
    <p class="muted" style="margin-top:0">${who.device ? 'Pick your name, then enter your date of birth.' : `First time with <b>${esc(who.gmail)}</b>. Pick your name and confirm your date of birth.`}</p>
    ${who.admin ? `<div class="note" style="margin-bottom:12px">This Gmail is an admin. <button class="linkbtn" id="adm-skip">Continue without a staff profile</button></div>` : ''}
    <div class="search">${ICON.search}<input class="input" id="pq" type="search" placeholder="Type your name or branch" autocomplete="off"></div>
    <div class="spacer"></div>
    <div class="list" id="plist"></div>
    <div id="pdob" hidden>
      <div class="card" style="margin-top:12px"><div id="pwho"></div>
        <label class="f" for="dob">Your date of birth</label>
        <input class="input" type="date" id="dob" max="${todayISO()}">
        <div class="spacer"></div>
        <button class="btn block" id="check">Check</button>
        <p class="hint" id="perr" style="color:var(--bad)"></p>
      </div>
      <button class="linkbtn" id="repick">Pick a different name</button>
    </div>
    <div class="spacer"></div>
    <button class="btn ghost block" id="so">${who.device ? 'Back' : ICON.logout + ' Use a different Gmail'}</button>`;

  const draw = () => {
    const t = $('#pq').value.trim().toLowerCase();
    const rows = list.filter(r => !t || (r.name + ' ' + (r.branch || '') + ' ' + r.emp_id).toLowerCase().includes(t)).slice(0, t ? 40 : 12);
    $('#plist').innerHTML = rows.length ? rows.map(r => `<button class="item" data-emp="${r.emp_id}">
        <div class="avatar">${esc(initials(r.name))}</div>
        <div class="grow"><div class="t">${esc(cleanName(r.name))}</div><div class="s">${esc(r.designation || '')} · ${esc(r.branch || '')}</div></div>
        <span class="chev">${ICON.chev}</span></button>`).join('')
      : `<div class="empty">No one by that name. Check the spelling, or ask the Regional Office if you are missing from the staff list.</div>`;
    if (!t) $('#plist').insertAdjacentHTML('beforeend', `<div class="item" style="cursor:default"><span class="hint">Showing 12 of ${list.length}. Type to search.</span></div>`);
  };
  draw();
  $('#pq').oninput = draw;
  $('#plist').onclick = e => {
    const b = e.target.closest('[data-emp]'); if (!b) return;
    picked = list.find(r => String(r.emp_id) === b.dataset.emp);
    $('#pwho').innerHTML = `<div class="row"><div class="avatar">${esc(initials(picked.name))}</div><div class="grow">
      <div style="font-weight:600">${esc(cleanName(picked.name))}</div><div class="hint">${esc(picked.designation || '')} · ${esc(picked.branch || '')}</div></div></div>`;
    $('#plist').hidden = true; $('.search').hidden = true; $('#pdob').hidden = false; $('#perr').textContent = '';
    $('#dob').focus();
  };
  $('#repick').onclick = () => { $('#plist').hidden = false; $('.search').hidden = false; $('#pdob').hidden = true; picked = null; };
  $('#check').onclick = async () => {
    const dob = $('#dob').value;
    if (!picked || !dob) { $('#perr').textContent = 'Please enter your date of birth.'; return; }
    $('#check').disabled = true; $('#perr').textContent = '';
    try {
      const p = await rpc('claim_by_dob', { p_emp: picked.emp_id, p_dob: dob, p_confirm: false });
      $('#check').disabled = false;
      if (!p) { $('#perr').textContent = 'The name and date of birth do not match our records. Please check and try again.'; return; }
      screenConfirmClaim(who, p, dob);
    } catch (e) { $('#check').disabled = false; $('#perr').textContent = errText(e); }
  };
  $('#so').onclick = () => signOut('local');
  if ($('#adm-skip')) $('#adm-skip').onclick = () => startApp();
}

function screenConfirmClaim(who, p, dob) {
  $('#main').innerHTML = `<h2>Confirm your profile</h2>
    <p class="muted" style="margin-top:0">${who.device ? 'Once confirmed, this phone opens this profile.' : `Once confirmed, <b>${esc(who.gmail)}</b> opens this profile on any phone.`}</p>
    ${profileCard(p, who.device ? null : who.gmail)}
    <button class="btn block" id="ok">Confirm, this is me</button>
    <div class="spacer"></div>
    <button class="btn ghost block" id="back">Back</button>`;
  $('#ok').onclick = async () => {
    $('#ok').disabled = true;
    try { await enterApp(await rpc('claim_by_dob', { p_emp: p.emp_id, p_dob: dob, p_confirm: true })); }
    catch (e) { $('#ok').disabled = false; toast(errText(e)); }
  };
  $('#back').onclick = () => screenPickName(who);
}

/* Sign out of this phone, or of every device signed in with this Gmail. */
async function signOut(scope = 'local', quiet = false) {
  if (S.who && S.who.device && S.who.gmail) { try { await rpc('unlink_my_login', { p_gmail: S.who.gmail }, 8000); } catch (e) { /* offline: the admin can remove it */ } }
  try { await sb.auth.signOut({ scope }); } catch (e) { if (scope === 'global') { toast(errText(e)); return; } }
  try { localStorage.removeItem('daura-auth'); } catch (e) { /* storage may be blocked */ }
  try { google.accounts.id.disableAutoSelect(); } catch (e) { /* not loaded */ }
  S.who = null; S.cache = {}; S.tab = 'visits'; S.scrollAt = {}; $('#main').innerHTML = '';
  await forgetSnap();   // signing out removes this person's copy from the phone
  if (!quiet) { screenSignIn(); toast(scope === 'global' ? 'Signed out on all devices' : 'Signed out'); }
}
