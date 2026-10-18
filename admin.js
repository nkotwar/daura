/* TASC Connect · Admin tab: people and their Gmails, roles, blocking; verifying visits; the requests queue;
   the staff list (udairo.js upload) and photo storage; the activity feed. The dashboard arrives next. */

const admPane = id => $(`#main > .tabview[data-tab="admin"] .pane[data-pane="${id}"]`) || document.createElement('div');

async function viewAdmin() {
  if (!S.who.admin) { TV().innerHTML = '<div class="empty">Admins only.</div>'; return; }
  await loadBasics();
  const panes = [
    { id: 'people', label: 'People', badge: 'an-people', draw: () => admPeople(false) },
    { id: 'verify', label: 'Verify', badge: 'an-verify', draw: () => admVerify() },
    { id: 'requests', label: 'Requests', badge: 'an-requests', draw: () => admRequests() },
    { id: 'activity', label: 'Activity', badge: 'an-activity', draw: () => admActivity() }
  ];
  const old = $('#adm-host', TV());
  if (old && old._pager) { await old._pager.refresh(); adminBadges(); return; }
  TV().innerHTML = `${S.updateReady ? updateBar() : ''}<div id="adm-host"></div>`;
  bindUpdate();
  mountPager($('#adm-host', TV()), panes, S.cache.adminSeg || 'people', id => { S.cache.adminSeg = id; remember(); });
  adminBadges();
}

async function adminBadges() {
  const rq = all('requests').filter(r => r.status === 'pending').length, vf = all('visits').filter(v => v.status === 'submitted').length;
  const a = $('#an-requests'); if (a) a.textContent = rq ? ` · ${rq}` : '';
  const b = $('#an-verify'); if (b) b.textContent = vf ? ` · ${vf}` : '';
}

/* ───────── Verify (admin) ─────────
   Every report waiting for a check, oldest first. Only the admin verifies. */
async function admVerify() {
  const rows = all('visits').filter(v => v.status === 'submitted').map(withEntity).sort((a, b) => (a.visited_at || '').localeCompare(b.visited_at || ''));
  const bname = new Map(all('branches').map(b => [b.code, b.name]));
  admPane('verify').innerHTML = rows.length ? `<p class="hint" style="margin-top:0">${rows.length} report${rows.length > 1 ? 's' : ''} waiting, oldest first. Open one, look at the photos and details, then tap <b>Verify</b>.</p>
    <div class="list">${rows.map(v => `<button class="item" data-v="${v.id}">
        <div class="avatar">${esc(initials(personName(v.visitor)))}</div>
        <div class="grow"><div class="t">${esc(v.entity.name)} · V${v.visit_no}</div>
          <div class="s">${esc(personName(v.visitor))} · ${esc(bname.get(v.visitor_branch) || '')} · ${fmtDateTime(v.visited_at)}</div></div>
        <span class="chev">${ICON.chev}</span></button>`).join('')}</div>`
    : emptyState(ICON.shield, 'Nothing waiting', 'Every submitted visit report has been verified.');
  $$('[data-v]', admPane('verify')).forEach(b => b.onclick = () => openVisit(b.dataset.v));
}

/* ───────── Requests (admin) ───────── */
const RQ_LABEL = { delete_visit: 'Delete a visit', delete_assignment: 'Remove an allotment', reassign: 'Reassign an allotment', unverify: 'Unverify a visit (to edit)' };
async function admRequests() {
  const { pending, done } = qRequests();
  const target = r => r.visit ? `${esc(r.visit.entity.name)} · Visit ${r.visit.visit_no}` : r.assignment ? `${esc(r.assignment.entity.name)} · scheduled ${fmtDate(r.assignment.scheduled_on)}` : '<i>no longer exists</i>';
  admPane('requests').innerHTML = `
    ${pending.length ? pending.map(r => `<div class="card">
        <div class="row"><span class="badge warn">${RQ_LABEL[r.kind]}</span><span class="grow"></span><span class="hint">${ago(r.created_at)}</span></div>
        <h3 style="margin-top:10px">${target(r)}</h3>
        <p class="hint" style="margin:2px 0 8px">From ${esc(personName(r.raised_by))}</p>
        <div class="note">"${esc(r.reason)}"</div>
        ${r.kind === 'reassign' ? `<label class="f" for="to-${r.id}">Reassign to</label>
          <select class="input" id="to-${r.id}"><option value="">Choose a person…</option>${[...S.dir.values()].filter(p => p.emp_id !== r.raised_by).map(p => `<option value="${p.emp_id}">${esc(cleanName(p.name))} · ${esc(p.branch || '')}</option>`).join('')}</select>` : ''}
        <input class="input" id="nt-${r.id}" placeholder="Note to them (optional)" style="margin-top:10px">
        <div class="row" style="margin-top:10px">
          ${r.visit_id ? `<button class="btn ghost small" data-open="${r.visit_id}">View visit</button>` : ''}
          <span class="grow"></span>
          <button class="btn ghost small" data-dec="${r.id}">Decline</button>
          <button class="btn small" data-ok="${r.id}">Approve</button></div></div>`).join('')
      : emptyState(ICON.shield, 'No requests waiting', 'When staff ask to delete a visit, remove or reassign an allotment, or unverify a visit to correct it, the request lands here for you to approve or decline.')}
    ${done.length ? `<h2>Recently decided</h2><div class="list">${done.map(r => `<div class="item" style="cursor:default"><div class="grow">
        <div class="t">${RQ_LABEL[r.kind]}</div><div class="s">${target(r)} · ${esc(personName(r.raised_by))}${r.decision_note ? ' · ' + esc(r.decision_note) : ''}</div></div>
        <span class="badge ${r.status === 'approved' ? 'ok' : ''}">${r.status === 'approved' ? 'Approved' : 'Declined'}</span></div>`).join('')}</div>` : ''}`;
  $$('[data-open]', admPane('requests')).forEach(b => b.onclick = () => openVisit(b.dataset.open));
  const decide = async (id, approve) => {
    const r = pending.find(x => x.id === id);
    const note = ($('#nt-' + id) || {}).value || null;
    let to = null;
    if (approve && r.kind === 'reassign') { to = +($('#to-' + id).value || 0); if (!to) { toast('Choose who to reassign to'); return; } }
    try {
      if (approve && r.kind === 'delete_visit' && r.visit_id) {
        const ph = all('photos').filter(p => p.visit_id === r.visit_id);
        if (ph.length) await sb.storage.from('photos').remove(ph.map(p => p.path));
      }
      await rpc('decide_request', { p_request: id, p_approve: approve, p_note: note, p_to: to });
      // apply the decision to the phone's copy
      patch('requests', id, { status: approve ? 'approved' : 'declined', decision_note: note, decided_at: new Date().toISOString(), decided_by: S.who.gmail });
      if (r.assignment_id) DB.holds.delete(r.assignment_id);
      if (approve) {
        if (r.kind === 'delete_visit' && r.visit_id) dropVisit(r.visit_id);
        if (r.kind === 'delete_assignment' && r.assignment_id) patch('assignments', r.assignment_id, { status: 'cancelled' });
        if (r.kind === 'reassign' && r.assignment_id) patch('assignments', r.assignment_id, { assignee: to });
        if (r.kind === 'unverify' && r.visit_id) patch('visits', r.visit_id, { status: 'submitted', verified_at: null, verified_by: null });
      }
      toast(approve ? 'Approved' : 'Declined'); admRequests(); adminBadges();
    } catch (e) { toast(errText(e)); }
  };
  $$('[data-ok]', admPane('requests')).forEach(b => b.onclick = () => decide(b.dataset.ok, true));
  $$('[data-dec]', admPane('requests')).forEach(b => b.onclick = () => decide(b.dataset.dec, false));
}

/* ───────── People ───────── */
async function admPeople(fresh = true) {
  if (fresh || !S.cache.people) S.cache.people = await rpc('admin_people');
  const all = S.cache.people;
  const act = all.filter(p => p.active);
  const linked = act.filter(p => p.logins.length);
  const f = S.cache.peopleFilter || 'due';
  const due = pendingByEmp();
  const filters = {
    due: ['Due', act.filter(p => due.has(p.emp_id)).sort((a, b) => due.get(b.emp_id).late - due.get(a.emp_id).late || due.get(b.emp_id).n - due.get(a.emp_id).n)],
    all: ['All', act],
    linked: ['Signed up', linked],
    pending: ['Not yet', act.filter(p => !p.logins.length)],
    heads: ['Branch heads', act.filter(p => p.is_branch_head)],
    roles: ['Viewers & admins', act.filter(p => p.role !== 'field')],
    blocked: ['Blocked', all.filter(p => p.blocked)],
    inactive: ['Inactive', all.filter(p => !p.active)]
  };
  admPane('people').innerHTML = `
    <div class="row" style="margin-bottom:10px"><div class="grow hint" style="margin:0">${act.length} staff in ${new Set(act.map(p => p.branch_code)).size} branches</div>
      <button class="btn small soft" id="ub">${ICON.upload} Upload udairo.js</button>
      <input type="file" id="uf" accept=".js,text/javascript,application/javascript" hidden></div>
    <div class="search">${ICON.search}<input class="input" id="pq" type="search" placeholder="Name, emp ID, branch or Gmail" value="${esc(S.cache.peopleQ || '')}"></div>
    <div class="chips">${Object.entries(filters).filter(([k, v]) => k === 'all' || v[1].length || k === f).map(([k, v]) =>
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
          ${f === 'due' ? `<span class="badge warn">${due.get(p.emp_id).n} pending</span>${due.get(p.emp_id).late ? `<span class="badge bad">${due.get(p.emp_id).late} overdue</span>` : ''}` : p.blocked ? '<span class="badge bad">Blocked</span>' : !p.active ? '<span class="badge">Inactive</span>'
            : p.logins.length ? `<span class="badge ok">${p.logins.length > 1 ? p.logins.length + ' Gmails' : 'Signed up'}</span>` : '<span class="badge">Not yet</span>'}
          ${f !== 'due' && p.role !== 'field' ? `<span class="badge acc">${roleLabel(p.role)}</span>` : ''}
        </div></button>`).join('') : emptyState(ICON.search, 'No one matches', 'Try part of a name, an Emp ID, a branch or a Gmail.');
  };
  draw();
  $('#pq').oninput = draw;
  $$('[data-pf]').forEach(b => b.onclick = () => { S.cache.peopleFilter = b.dataset.pf; admPeople(false); });
  $('#plist').onclick = e => { const b = e.target.closest('[data-emp]'); if (b) openPerson(+b.dataset.emp); };
  $('#ub').onclick = () => $('#uf').click();
  $('#uf').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) staffUpload(file); };
}

/* Allotments not visited yet (by them or a colleague), per person: { n, late } — from the phone's copy */
function pendingByEmp() {
  const today = todayISO(), m = new Map();
  const vs = all('visits'), byAsg = new Set(vs.filter(v => v.assignment_id).map(v => v.assignment_id));
  const held = new Set(all('requests').filter(r => r.status === 'pending' && r.assignment_id).map(r => r.assignment_id));
  for (const a of openAsg()) {
    if (byAsg.has(a.id) || held.has(a.id)) continue;
    if (vs.some(v => v.entity_id === a.entity_id && v.visitor !== a.assignee)) continue;   // a colleague visited
    const c = m.get(a.assignee) || { n: 0, late: 0 };
    c.n++; if (a.scheduled_on && a.scheduled_on < today) c.late++;
    m.set(a.assignee, c);
  }
  return m;
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
      <a class="btn soft grow" target="_blank" rel="noopener" href="https://wa.me/91${phone}?text=${encodeURIComponent(`Dear ${cleanName(p.name)}, please sign in to TASC Connect (tap "Sign in with your name"): ${location.origin + location.pathname}`)}">${ICON.wa} Invite on WhatsApp</a></div>` : ''}

    <h2>Visits</h2><div id="sw"></div>
    <h2>Phones and Gmails</h2>
    ${p.logins.length ? `<div class="list">${p.logins.map(l => `<div class="item" style="cursor:default">
        <div class="grow"><div class="t" style="overflow-wrap:anywhere">${esc(loginLabel(l.gmail))}</div>
          <div class="s">via ${{ email: 'staff-list email', dob: 'Gmail + date of birth', admin: 'admin', device: 'name + date of birth' }[l.via] || l.via} · ${fmtDate(l.linked_at)} · used ${ago(l.last_seen)}</div></div>
        <button class="btn small danger" data-unlink="${esc(l.gmail)}">Remove</button></div>`).join('')}</div>`
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
  loadStaffWork($('#sw', body), emp);
  const refresh = async (msg) => { toast(msg); S.cache.people = await rpc('admin_people'); closeSheet(); admPeople(false); openPerson(emp); };
  $$('[data-unlink]', body).forEach(b => b.onclick = async () => {
    if (!await confirmSheet('Remove this sign-in?', `<b>${esc(loginLabel(b.dataset.unlink))}</b> will no longer open ${esc(cleanName(p.name))}'s profile.`, 'Remove', true)) return openPerson(emp);
    try { await rpc('admin_unlink', { p_gmail: b.dataset.unlink }); await refresh('Removed'); } catch (e) { toast(errText(e)); }
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
    if (!p.blocked && !await confirmSheet('Block this person?', `${esc(cleanName(p.name))} loses access to TASC Connect at once, on every device, until you unblock them. Their visits stay.`, 'Block', true)) return openPerson(emp);
    try { await rpc('admin_set_blocked', { p_emp: emp, p_blocked: !p.blocked }); await refresh(p.blocked ? 'Unblocked' : 'Blocked'); } catch (e) { toast(errText(e)); }
  };
}

/* Staff list upload (from People): check what changes, then apply. */
async function staffUpload(file) {
  const people = S.cache.people || await rpc('admin_people');
  const text = await file.text();
  if (!/UDAIRO_DATA/.test(text)) { toast('That is not the staff list file. Please pick udairo.js.'); return; }
  let D;
  try { D = new Function(text + ';return UDAIRO_DATA;')(); } catch (err) { toast('Could not read that file.'); return; }
  if (!D || !Array.isArray(D.branches)) { toast('That file has no branches in it.'); return; }
  // Send only what TASC Connect needs (no DOJ, FTP, etc.).
  const slim = { branches: D.branches.map(b => ({ branchCode: b.branchCode, branchName: b.branchName, lat: b.lat, lng: b.lng, mobile: b.mobile, size: b.size,
    staff: (b.staff || []).map(s => ({ empId: s.empId, name: s.name, designation: s.designation, grade: s.grade, phone: s.phone, email: s.email, dob: s.dob, dept: s.dept, secondInCommand: !!s.secondInCommand })) })) };
  const incoming = new Map(slim.branches.flatMap(b => b.staff.map(s => [s.empId, { ...s, branch: b.branchName }])));
  const current = new Map(people.filter(p => p.active).map(p => [p.emp_id, p]));
  const added = [...incoming.values()].filter(s => !current.has(s.empId));
  const gone = [...current.values()].filter(p => !incoming.has(p.emp_id));
  const moved = [...incoming.values()].filter(s => current.has(s.empId) && current.get(s.empId).branch !== s.branch);
  const li = (arr, f) => arr.slice(0, 30).map(f).join('') + (arr.length > 30 ? `<div class="item"><span class="hint">and ${arr.length - 30} more</span></div>` : '');
  const body = openSheet('Update staff list', `<p class="muted" style="margin-top:0">Matching is by Emp ID: changes are updated, new people added, and anyone missing is marked inactive (their visits stay).</p>
    <div class="note"><b>${incoming.size} staff in ${slim.branches.length} branches.</b> Please check before applying.</div>
    ${added.length ? `<h2>New (${added.length})</h2><div class="list">${li(added, s => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(s.name))}</div><div class="s">${esc(s.designation)} · ${esc(s.branch)}</div></div></div>`)}</div>` : ''}
    ${moved.length ? `<h2>Moved (${moved.length})</h2><div class="list">${li(moved, s => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(s.name))}</div><div class="s">${esc(current.get(s.empId).branch)} → ${esc(s.branch)}</div></div></div>`)}</div>` : ''}
    ${gone.length ? `<h2>Will be marked inactive (${gone.length})</h2><div class="list">${li(gone, p => `<div class="item"><div class="grow"><div class="t">${esc(cleanName(p.name))}</div><div class="s">${esc(p.branch || '')}</div></div></div>`)}</div>` : ''}
    ${!added.length && !moved.length && !gone.length ? '<p class="hint">No joins, moves or exits. Names, phones and other details will be refreshed.</p>' : ''}
    <div class="row" style="margin-top:14px"><button class="btn ghost grow" id="ucan">Cancel</button><button class="btn grow" id="uok">Apply</button></div>`);
  $('#ucan', body).onclick = () => closeSheet();
  $('#uok', body).onclick = async () => {
    $('#uok', body).disabled = true;
    try {
      const r = await rpc('admin_import_directory', { d: slim });
      S.cache.people = null;
      closeSheet();
      toast(`Updated: ${r.staff} staff, ${r.new} new, ${r.inactivated} marked inactive`, 4000);
      syncNow().catch(() => {});   // bring the new staff list into the phone's copy
      admPeople(true);
    } catch (err) { $('#uok', body).disabled = false; toast(errText(err)); }
  };
}

/* ───────── Activity ───────── */
const ACT = {
  login_linked: (a) => a.detail?.via === 'device' ? `linked a phone to ${esc(cleanName(a.target_name || a.target))} (name + date of birth)`
    : `linked ${esc(a.detail?.gmail || 'a Gmail')} to ${esc(cleanName(a.target_name || a.target))}${a.detail?.via === 'dob' ? ' (name + date of birth)' : a.detail?.via === 'email' ? ' (staff-list email)' : ' (admin)'}`,
  login_unlinked: (a) => `removed ${String(a.detail?.gmail || '').startsWith('device:') ? 'a phone sign-in' : esc(a.detail?.gmail || 'a Gmail')} from ${esc(cleanName(a.target_name || a.target))}`,
  claim_failed: (a) => `tried to open ${esc(cleanName(a.target_name || a.target))}'s profile with a wrong date of birth (${String(a.detail?.gmail || '').startsWith('device:') ? 'from a phone' : esc(a.detail?.gmail || '')})`,
  allotted: (a) => `allotted ${esc(a.detail?.entity || 'a place')} to ${esc(cleanName(a.target_name || a.target))}${a.detail?.on ? ', visit by ' + fmtDate(a.detail.on) : ''}`,
  directory_imported: (a) => `uploaded the staff list: ${a.detail?.staff} staff, ${a.detail?.new} new, ${a.detail?.inactivated} marked inactive`,
  role_set: (a) => `made ${esc(cleanName(a.target_name || a.target))} ${roleLabel(a.detail?.role).toLowerCase()}`,
  person_blocked: (a) => `blocked ${esc(cleanName(a.target_name || a.target))}`,
  person_unblocked: (a) => `unblocked ${esc(cleanName(a.target_name || a.target))}`,
  visit_logged: (a) => `logged visit ${esc(a.detail?.visit_no || '')} at ${esc(a.detail?.entity || 'a place')}`,
  visit_verified: () => 'verified a visit',
  visit_unverified: () => 'unverified a visit',
  request_raised: (a) => `raised a ${String(a.detail?.kind || '').replace('_', ' ')} request`,
  request_decided: (a) => `${a.detail?.approved ? 'approved' : 'declined'} a request`,
  assignment_reassigned: (a) => a.detail?.entity ? `reallotted ${esc(a.detail.entity)} to ${esc(cleanName(a.target_name || personName(+a.detail.to)))}` : 'reassigned a visit',
  place_reopened: () => 'reopened a closed place',
  place_deleted: (a) => `deleted the place ${esc(a.detail?.entity || '')}${a.detail?.visits ? ` with ${a.detail.visits} visit report${a.detail.visits > 1 ? 's' : ''}` : ''}`
};
async function admActivity() {
  const rows = await rpc('admin_activity', { p_limit: 150 });
  admPane('activity').innerHTML = rows.length ? `<div class="list">${rows.map(a => {
    const who = a.actor ? cleanName(a.actor) : (a.actor_gmail || 'Setup');
    const what = (ACT[a.action] || (() => esc(a.action)))(a);
    const bad = a.action === 'claim_failed' || a.action === 'person_blocked';
    return `<div class="item" style="cursor:default;align-items:flex-start">
      <div class="grow"><div style="font-size:14px"><b>${esc(who)}</b> ${what}</div><div class="s">${fmtDateTime(a.at)}</div></div>
      ${bad ? '<span class="badge bad">Check</span>' : ''}</div>`; }).join('')}</div>`
    : emptyState(ICON.user, 'Nothing yet', 'Sign-ins, new Gmail links, failed date-of-birth tries, role changes and staff-list uploads will show up here.');
}
