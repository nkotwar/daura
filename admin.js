/* Daura · Admin tab (foundation build): people and their Gmails, roles, blocking,
   the staff list (udairo.js upload), photo storage, and the activity feed.
   The dashboard, verification queue and requests arrive in later builds. */

async function viewAdmin() {
  if (!S.who.admin) { $('#main').innerHTML = '<div class="empty">Admins only.</div>'; return; }
  const seg = S.cache.adminSeg || 'people';
  $('#main').innerHTML = `<div class="seg">
      <button data-seg="people" class="${seg === 'people' ? 'on' : ''}">People</button>
      <button data-seg="staff" class="${seg === 'staff' ? 'on' : ''}">Staff list</button>
      <button data-seg="activity" class="${seg === 'activity' ? 'on' : ''}">Activity</button>
    </div><div id="adm"><div class="spin"></div></div>`;
  $$('[data-seg]').forEach(b => b.onclick = () => { S.cache.adminSeg = b.dataset.seg; viewAdmin(); });
  try {
    if (seg === 'people') await admPeople();
    else if (seg === 'staff') await admStaff();
    else await admActivity();
  } catch (e) { $('#adm').innerHTML = `<div class="empty"><p>${esc(errText(e))}</p></div>`; }
}

/* ───────── People ───────── */
async function admPeople(fresh = true) {
  if (fresh || !S.cache.people) S.cache.people = await rpc('admin_people');
  const all = S.cache.people;
  const act = all.filter(p => p.active);
  const linked = act.filter(p => p.logins.length);
  const f = S.cache.peopleFilter || 'all';
  const filters = {
    all: ['All', act],
    linked: ['Signed up', linked],
    pending: ['Not yet', act.filter(p => !p.logins.length)],
    heads: ['Branch heads', act.filter(p => p.is_branch_head)],
    roles: ['Viewers & admins', act.filter(p => p.role !== 'field')],
    blocked: ['Blocked', all.filter(p => p.blocked)],
    inactive: ['Inactive', all.filter(p => !p.active)]
  };
  $('#adm').innerHTML = `
    <div class="stats">
      <div class="stat ok"><b>${linked.length}</b><span>Signed up</span></div>
      <div class="stat"><b>${act.length - linked.length}</b><span>Not yet</span></div>
      <div class="stat"><b>${act.filter(p => p.is_branch_head && p.logins.length).length}/${act.filter(p => p.is_branch_head).length}</b><span>Branch heads in</span></div>
    </div>
    <div class="search">${ICON.search}<input class="input" id="pq" type="search" placeholder="Name, emp ID, branch or Gmail" value="${esc(S.cache.peopleQ || '')}"></div>
    <div class="chips">${Object.entries(filters).filter(([k, v]) => k === 'all' || v[1].length).map(([k, v]) =>
      `<button class="chip ${f === k ? 'on' : ''}" data-pf="${k}">${v[0]}<b>${v[1].length}</b></button>`).join('')}</div>
    <div class="list" id="plist"></div>`;
  const draw = () => {
    const t = ($('#pq').value || '').trim().toLowerCase(); S.cache.peopleQ = t;
    const rows = (filters[f] || filters.all)[1].filter(p => !t || [p.name, p.emp_id, p.branch, p.designation, ...p.logins.map(l => l.gmail)].join(' ').toLowerCase().includes(t));
    $('#plist').innerHTML = rows.length ? rows.map(p => `<button class="item" data-emp="${p.emp_id}">
        <div class="avatar">${esc(initials(p.name))}</div>
        <div class="grow"><div class="t">${esc(cleanName(p.name))}</div>
          <div class="s">${esc(p.designation || '')} · ${esc(p.branch || '')}</div></div>
        <div style="text-align:right;flex:none;display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          ${p.blocked ? '<span class="badge bad">Blocked</span>' : !p.active ? '<span class="badge">Inactive</span>'
            : p.logins.length ? `<span class="badge ok">${p.logins.length > 1 ? p.logins.length + ' Gmails' : 'Signed up'}</span>` : '<span class="badge">Not yet</span>'}
          ${p.role !== 'field' ? `<span class="badge acc">${roleLabel(p.role)}</span>` : ''}
        </div></button>`).join('') : '<div class="empty">No one matches.</div>';
  };
  draw();
  $('#pq').oninput = draw;
  $$('[data-pf]').forEach(b => b.onclick = () => { S.cache.peopleFilter = b.dataset.pf; admPeople(false); });
  $('#plist').onclick = e => { const b = e.target.closest('[data-emp]'); if (b) openPerson(+b.dataset.emp); };
}

function openPerson(emp) {
  const p = S.cache.people.find(x => x.emp_id === emp); if (!p) return;
  const isMe = S.who.me && S.who.me.emp_id === emp;
  const phone = (p.phone || '').replace(/\D/g, '').slice(-10);
  const body = openSheet(cleanName(p.name), `
    <div class="row wrap" style="margin-bottom:12px">
      <span class="badge acc">${roleLabel(p.role)}</span>${p.is_branch_head ? '<span class="badge ok">Branch head</span>' : ''}
      ${p.blocked ? '<span class="badge bad">Blocked</span>' : ''}${!p.active ? '<span class="badge">Not in staff list</span>' : ''}</div>
    <dl class="kv">
      <dt>Emp ID</dt><dd class="mono">${p.emp_id}</dd>
      <dt>Designation</dt><dd>${esc(p.designation || '—')}</dd>
      <dt>Branch</dt><dd>${esc(p.branch || '—')}</dd>
      <dt>Phone</dt><dd class="mono">${esc(p.phone || '—')}</dd>
      <dt>Email on file</dt><dd>${esc(p.email || '—')}</dd>
      <dt>Date of birth</dt><dd class="mono">${esc(p.dob || '—')}</dd>
      <dt>Last used</dt><dd>${ago(p.last_seen)}</dd>
    </dl>
    ${phone.length === 10 ? `<div class="row" style="margin-top:14px">
      <a class="btn soft grow" href="tel:+91${phone}">${ICON.phone} Call</a>
      <a class="btn soft grow" target="_blank" rel="noopener" href="https://wa.me/91${phone}?text=${encodeURIComponent(`Dear ${cleanName(p.name)}, please sign in to Daura with your Gmail: ${location.origin + location.pathname}`)}">${ICON.wa} Invite on WhatsApp</a></div>` : ''}

    <h2>Gmails</h2>
    ${p.logins.length ? `<div class="list">${p.logins.map(l => `<div class="item" style="cursor:default">
        <div class="grow"><div class="t" style="overflow-wrap:anywhere">${esc(l.gmail)}</div>
          <div class="s">via ${{ email: 'staff-list email', dob: 'name + date of birth', admin: 'admin' }[l.via] || l.via} · ${fmtDate(l.linked_at)} · used ${ago(l.last_seen)}</div></div>
        <button class="btn small danger" data-unlink="${esc(l.gmail)}">Unlink</button></div>`).join('')}</div>`
      : '<p class="hint">Hasn\'t signed in yet.</p>'}
    <div class="row" style="margin-top:10px"><input class="input grow" id="lg" type="email" placeholder="Add a Gmail for them" autocomplete="off">
      <button class="btn small" id="lgb" style="min-height:44px">Link</button></div>

    <h2>Role</h2>
    <select class="input" id="role" ${isMe ? 'disabled' : ''}>
      <option value="field" ${p.role === 'field' ? 'selected' : ''}>Field staff: own visits</option>
      <option value="viewer" ${p.role === 'viewer' ? 'selected' : ''}>Viewer: sees everything, read-only</option>
      <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin: full control</option>
    </select>
    ${isMe ? '<p class="hint">You can\'t change your own role.</p>' : ''}

    <h2>Access</h2>
    ${isMe ? '<p class="hint">You can\'t block yourself.</p>' : `<button class="btn block ${p.blocked ? 'soft' : 'danger'}" id="blk">${p.blocked ? 'Unblock: allow access again' : 'Block: cut off access on every device now'}</button>`}
  `);
  const refresh = async (msg) => { toast(msg); S.cache.people = await rpc('admin_people'); closeSheet(); admPeople(false); openPerson(emp); };
  $$('[data-unlink]', body).forEach(b => b.onclick = async () => {
    if (!await confirmSheet('Unlink this Gmail?', `<b>${esc(b.dataset.unlink)}</b> will no longer open ${esc(cleanName(p.name))}'s profile.`, 'Unlink', true)) return openPerson(emp);
    try { await rpc('admin_unlink', { p_gmail: b.dataset.unlink }); await refresh('Unlinked'); } catch (e) { toast(errText(e)); }
  });
  $('#lgb', body).onclick = async () => {
    const g = $('#lg', body).value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(g)) { toast('Enter a valid Gmail address'); return; }
    try { await rpc('admin_link', { p_gmail: g, p_emp: emp }); await refresh('Linked'); } catch (e) { toast(errText(e)); }
  };
  $('#role', body).onchange = async e => {
    try { await rpc('admin_set_role', { p_emp: emp, p_role: e.target.value }); await refresh('Role updated'); } catch (err) { toast(errText(err)); }
  };
  const blk = $('#blk', body);
  if (blk) blk.onclick = async () => {
    if (!p.blocked && !await confirmSheet('Block this person?', `${esc(cleanName(p.name))} loses access to Daura at once, on every device, until you unblock them. Their visits stay.`, 'Block', true)) return openPerson(emp);
    try { await rpc('admin_set_blocked', { p_emp: emp, p_blocked: !p.blocked }); await refresh(p.blocked ? 'Unblocked' : 'Blocked'); } catch (e) { toast(errText(e)); }
  };
}

/* ───────── Staff list (udairo.js) + storage ───────── */
async function admStaff() {
  let bytes = null;
  try { bytes = await rpc('admin_storage_bytes'); } catch (e) { /* shown as unknown */ }
  const mb = bytes == null ? null : bytes / 1048576;
  const pct = mb == null ? 0 : Math.min(100, mb / 1024 * 100);
  const cls = mb >= 800 ? 'bad' : mb >= 600 ? 'warn' : '';
  const people = S.cache.people || await rpc('admin_people');
  S.cache.people = people;
  const act = people.filter(p => p.active);
  $('#adm').innerHTML = `
    <div class="card"><h3>Staff list</h3>
      <p class="muted">${act.length} staff in ${new Set(act.map(p => p.branch_code)).size} branches. Upload the latest <span class="mono">udairo.js</span> after transfers or postings. Matching is by Emp ID: changes are updated, new people added, and anyone missing is marked inactive (their visits stay).</p>
      <input type="file" id="uf" accept=".js,text/javascript,application/javascript" hidden>
      <button class="btn block" id="ub">${ICON.upload} Upload udairo.js</button>
      <div id="up"></div>
    </div>
    <div class="card"><h3>Photo storage</h3>
      ${mb == null ? '<p class="hint">Could not read storage use.</p>' : `
      <div class="meter ${cls}"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="row"><span class="mono">${mb.toFixed(mb < 10 ? 1 : 0)} MB</span><span class="grow"></span><span class="hint">of 1 GB free</span></div>
      ${mb >= 800 ? `<div class="note bad" style="margin-top:10px"><b>Over 800 MB.</b> Time to move photos to Google Drive. Follow "Moving photos to Drive" in SETUP.md.</div>`
        : '<p class="hint">You will see a warning here at 800 MB.</p>'}`}
    </div>`;
  $('#ub').onclick = () => $('#uf').click();
  $('#uf').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const text = await file.text();
    if (!/UDAIRO_DATA/.test(text)) { toast('That is not the staff list file. Please pick udairo.js.'); return; }
    let D;
    try { D = new Function(text + ';return UDAIRO_DATA;')(); } catch (err) { toast('Could not read that file.'); return; }
    if (!D || !Array.isArray(D.branches)) { toast('That file has no branches in it.'); return; }
    // Send only what Daura needs (no DOJ, FTP, etc.).
    const slim = { branches: D.branches.map(b => ({ branchCode: b.branchCode, branchName: b.branchName, lat: b.lat, lng: b.lng, mobile: b.mobile, size: b.size,
      staff: (b.staff || []).map(s => ({ empId: s.empId, name: s.name, designation: s.designation, grade: s.grade, phone: s.phone, email: s.email, dob: s.dob, dept: s.dept, secondInCommand: !!s.secondInCommand })) })) };
    const incoming = new Map(slim.branches.flatMap(b => b.staff.map(s => [s.empId, { ...s, branch: b.branchName }])));
    const current = new Map(people.filter(p => p.active).map(p => [p.emp_id, p]));
    const added = [...incoming.values()].filter(s => !current.has(s.empId));
    const gone = [...current.values()].filter(p => !incoming.has(p.emp_id));
    const moved = [...incoming.values()].filter(s => current.has(s.empId) && current.get(s.empId).branch !== s.branch);
    const li = (arr, f) => arr.slice(0, 30).map(f).join('') + (arr.length > 30 ? `<div class="item"><span class="hint">and ${arr.length - 30} more</span></div>` : '');
    $('#up').innerHTML = `<div class="spacer"></div><div class="note"><b>${incoming.size} staff in ${slim.branches.length} branches.</b> Please check before applying.</div>
      ${added.length ? `<h2>New (${added.length})</h2><div class="list">${li(added, s => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(s.name))}</div><div class="s">${esc(s.designation)} · ${esc(s.branch)}</div></div></div>`)}</div>` : ''}
      ${moved.length ? `<h2>Moved (${moved.length})</h2><div class="list">${li(moved, s => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(s.name))}</div><div class="s">${esc(current.get(s.empId).branch)} → ${esc(s.branch)}</div></div></div>`)}</div>` : ''}
      ${gone.length ? `<h2>Will be marked inactive (${gone.length})</h2><div class="list">${li(gone, p => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(p.name))}</div><div class="s">${esc(p.branch || '')}</div></div></div>`)}</div>` : ''}
      ${!added.length && !moved.length && !gone.length ? '<p class="hint">No joins, moves or exits. Names, phones and other details will be refreshed.</p>' : ''}
      <div class="row" style="margin-top:14px"><button class="btn ghost grow" id="ucan">Cancel</button><button class="btn grow" id="uok">Apply</button></div>`;
    $('#ucan').onclick = () => { $('#up').innerHTML = ''; };
    $('#uok').onclick = async () => {
      $('#uok').disabled = true;
      try {
        const r = await rpc('admin_import_directory', { d: slim });
        S.cache.people = null;
        toast(`Updated: ${r.staff} staff, ${r.new} new, ${r.inactivated} marked inactive`, 4000);
        admStaff();
      } catch (err) { $('#uok').disabled = false; toast(errText(err)); }
    };
  };
}

/* ───────── Activity ───────── */
const ACT = {
  login_linked: (a) => `linked ${esc(a.detail?.gmail || 'a Gmail')} to ${esc(cleanName(a.target_name || a.target))}${a.detail?.via === 'dob' ? ' (name + date of birth)' : a.detail?.via === 'email' ? ' (staff-list email)' : ' (admin)'}`,
  login_unlinked: (a) => `unlinked ${esc(a.detail?.gmail || 'a Gmail')} from ${esc(cleanName(a.target_name || a.target))}`,
  claim_failed: (a) => `tried to claim ${esc(cleanName(a.target_name || a.target))}'s profile with a wrong date of birth (${esc(a.detail?.gmail || '')})`,
  directory_imported: (a) => `uploaded the staff list: ${a.detail?.staff} staff, ${a.detail?.new} new, ${a.detail?.inactivated} marked inactive`,
  role_set: (a) => `made ${esc(cleanName(a.target_name || a.target))} ${roleLabel(a.detail?.role).toLowerCase()}`,
  person_blocked: (a) => `blocked ${esc(cleanName(a.target_name || a.target))}`,
  person_unblocked: (a) => `unblocked ${esc(cleanName(a.target_name || a.target))}`,
  visit_verified: () => 'verified a visit',
  visit_unverified: () => 'unverified a visit',
  request_raised: (a) => `raised a ${String(a.detail?.kind || '').replace('_', ' ')} request`,
  request_decided: (a) => `${a.detail?.approved ? 'approved' : 'declined'} a request`,
  assignment_reassigned: () => 'reassigned a visit'
};
async function admActivity() {
  const rows = await rpc('admin_activity', { p_limit: 150 });
  $('#adm').innerHTML = rows.length ? `<div class="list">${rows.map(a => {
    const who = a.actor ? cleanName(a.actor) : (a.actor_gmail || 'Setup');
    const what = (ACT[a.action] || (() => esc(a.action)))(a);
    const bad = a.action === 'claim_failed' || a.action === 'person_blocked';
    return `<div class="item" style="cursor:default;align-items:flex-start">
      <div class="grow"><div style="font-size:14px"><b>${esc(who)}</b> ${what}</div><div class="s">${fmtDateTime(a.at)}</div></div>
      ${bad ? '<span class="badge bad">Check</span>' : ''}</div>`; }).join('')}</div>`
    : '<div class="empty">Nothing yet. Sign-ins and changes will show up here.</div>';
}
