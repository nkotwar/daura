/* Daura · Visits tab: To do (your allotments) · My visits (logged, follow-ups, waiting to send) · Places · Verify (branch heads). */

async function viewVisits() {
  const me = S.who.me;
  const main = $('#main');
  if (!me) {
    main.innerHTML = `<div class="empty">${ICON.shield}<p>You are signed in as admin without a staff profile.<br>Open the <b>Admin</b> tab.</p></div>`;
    return;
  }
  const panes = [
    { id: 'todo', label: 'To do', badge: 'vn-todo', draw: el => drawTodo(el) },
    { id: 'mine', label: 'My visits', badge: 'vn-mine', draw: el => drawMine(el) },
    { id: 'places', label: 'Places', badge: 'vn-places', draw: el => drawPlaces(el) }
  ];
  if (me.is_branch_head) panes.push({ id: 'verify', label: 'Verify', badge: 'vn-verify', draw: el => drawVerify(el) });
  main.innerHTML = `${S.updateReady ? updateBar() : ''}<div id="v-host"></div>`;
  bindUpdate();
  try { await loadBasics(); } catch (e) { /* each section shows its own error */ }
  mountPager($('#v-host'), panes, S.cache.vseg || 'todo', id => { S.cache.vseg = id; remember(); });
  countBadges();
}

async function countBadges() {
  try {
    const n = (await idb.all()).length;
    const el = $('#vn-mine'); if (el) el.textContent = n ? ` · ${n}⏳` : '';
  } catch (e) { /* no IndexedDB */ }
  if (S.who.me && S.who.me.is_branch_head) {
    try {
      const { count } = await sb.from('visits').select('id', { count: 'exact', head: true })
        .eq('visitor_branch', S.who.me.branch_code).eq('status', 'submitted').neq('visitor', S.who.me.emp_id);
      const el = $('#vn-verify'); if (el) el.textContent = count ? ` · ${count}` : '';
    } catch (e) { /* offline */ }
  }
}

/* ───────── To do ───────── */
async function loadMyWork() {
  if (S.cache.mw && Date.now() - S.cache.mw.at < 5000) return S.cache.mw.p;
  const p = loadMyWorkNow(); S.cache.mw = { at: Date.now(), p };
  p.catch(() => { S.cache.mw = null; });
  return p;
}
async function loadMyWorkNow() {
  const me = S.who.me;
  const [asg, vis] = await Promise.all([
    q(sb.from('assignments').select('id, scheduled_on, status, entity:entities(id, name, type, area, address, contact, closure, lat, lng, created_by)')
      .eq('assignee', me.emp_id).eq('status', 'open').order('scheduled_on', { ascending: true })),
    q(sb.from('visits').select('id, assignment_id, entity_id, visit_no, status, visited_at, outcome, closure, followup_on, next_step, entity:entities(id, name, type, area, address, contact, closure, lat, lng, created_by)')
      .eq('visitor', me.emp_id).order('visited_at', { ascending: false }).limit(500))
  ]);
  S.cache.visits = { asg, vis };
  return S.cache.visits;
}

function visitGroups() {
  const { asg, vis } = S.cache.visits;
  const done = new Set(vis.filter(v => v.assignment_id).map(v => v.assignment_id));
  const today = todayISO();
  const g = { overdue: [], today: [], upcoming: [], done: [] };
  for (const a of asg) {
    if (done.has(a.id)) g.done.push(a);
    else if (a.scheduled_on && a.scheduled_on < today) g.overdue.push(a);
    else if (a.scheduled_on === today) g.today.push(a);
    else g.upcoming.push(a);
  }
  return g;
}

async function drawTodo(el) {
  await loadMyWork();
  const g = visitGroups();
  const f = S.cache.visitFilter && g[S.cache.visitFilter] ? S.cache.visitFilter : (g.overdue.length ? 'overdue' : g.today.length ? 'today' : 'upcoming');
  S.cache.visitFilter = f;
  const today = todayISO(); const rows = g[f];
  const chip = (id, label) => `<button class="chip ${f === id ? 'on' : ''}" data-f="${id}">${label}<b>${g[id].length}</b></button>`;
  el.innerHTML = `
    <div class="stats">
      <div class="stat ${g.overdue.length ? 'bad' : ''}"><b>${g.overdue.length}</b><span>Overdue</span></div>
      <div class="stat warn"><b>${g.today.length + g.upcoming.length}</b><span>Coming up</span></div>
      <div class="stat ok"><b>${g.done.length}</b><span>Visited</span></div>
    </div>
    <div class="chips">${chip('overdue', 'Overdue')}${chip('today', 'Today')}${chip('upcoming', 'Upcoming')}${chip('done', 'Visited')}</div>
    ${rows.length ? `<div class="list">${rows.map(a => {
      const late = f === 'overdue' ? daysBetween(a.scheduled_on, today) : 0;
      return `<button class="item" data-a="${a.id}"><div class="grow"><div class="t">${esc(a.entity.name)}</div>
          <div class="s">${esc(a.entity.type)}${a.entity.area ? ' · ' + esc(a.entity.area) : ''}</div></div>
        <div style="text-align:right;flex:none"><div class="mono" style="font-size:13px">${fmtDate(a.scheduled_on)}</div>
          ${late ? `<span class="badge bad">${late} d late</span>` : ''}</div></button>`; }).join('')}</div>`
      : `<div class="empty">${ICON.calendar}<p>${f === 'done' ? 'No allotted visits logged yet.' : 'Nothing here.'}</p></div>`}
    <div class="spacer"></div>
    <p class="hint" style="text-align:center">Visiting somewhere not on your list? Use <b>Places</b> to find it or add it.</p>`;
  $$('.chip[data-f]', el).forEach(b => b.onclick = () => { S.cache.visitFilter = b.dataset.f; drawTodo(el); });
  $$('[data-a]', el).forEach(b => b.onclick = () => { const a = S.cache.visits.asg.find(x => x.id === b.dataset.a); openPlace(a.entity, a); });
}

/* ───────── My visits ───────── */
async function drawMine(el) {
  const [{ vis }, waiting] = await Promise.all([loadMyWork(), idb.all().catch(() => [])]);
  const today = todayISO(), soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const latestByEntity = new Map();
  vis.forEach(v => { const c = latestByEntity.get(v.entity_id); if (!c || v.visit_no > c.visit_no) latestByEntity.set(v.entity_id, v); });
  const due = [...latestByEntity.values()].filter(v => v.followup_on && v.followup_on <= soon && !v.closure).sort((a, b) => a.followup_on.localeCompare(b.followup_on));
  const ver = vis.filter(v => v.status === 'verified').length;
  el.innerHTML = `
    ${waiting.length ? `<h2>Waiting to send (${waiting.length})</h2><div class="list">${waiting.map(w => `<div class="item" style="cursor:default">
        <div class="grow"><div class="t">${esc(w.entityName)}</div><div class="s">${w.error ? `<span style="color:var(--bad)">${esc(w.error)}</span>` : 'Saved on this phone ' + ago(w.savedAt) + '. Sends when online.'}</div></div>
        <button class="btn small ghost" data-wd="${w.id}">Discard</button></div>`).join('')}</div>
      <button class="btn soft block" id="wsend" style="margin-top:8px">Send now</button>` : ''}
    ${due.length ? `<h2>Follow-ups due</h2><div class="list">${due.map(v => `<button class="item" data-pe="${v.entity_id}"><div class="grow"><div class="t">${esc(v.entity.name)}</div>
        <div class="s">${esc(v.next_step || 'Follow-up')}${v.status !== 'verified' ? ' · Visit ' + v.visit_no + ' awaiting verification' : ''}</div></div>
        <span class="badge ${v.followup_on < today ? 'bad' : v.followup_on === today ? 'warn' : ''}">${fmtDate(v.followup_on)}</span></button>`).join('')}</div>` : ''}
    <h2>Logged visits</h2>
    <div class="stats"><div class="stat"><b>${vis.length}</b><span>Logged</span></div><div class="stat ok"><b>${ver}</b><span>Verified</span></div><div class="stat warn"><b>${vis.length - ver}</b><span>Not yet</span></div></div>
    ${vis.length ? `<div class="list">${vis.map(v => `<button class="item" data-v="${v.id}">
        <div class="avatar mono" style="font-size:12px">V${v.visit_no}</div>
        <div class="grow"><div class="t">${esc(v.entity.name)}</div><div class="s">${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '—')}</div></div>
        <span class="badge ${v.status === 'verified' ? 'ok' : 'warn'}">${v.status === 'verified' ? 'Verified' : 'Submitted'}</span></button>`).join('')}</div>`
      : `<div class="empty">${ICON.pin}<p>No visits logged yet.</p></div>`}`;
  $$('[data-v]', el).forEach(b => b.onclick = () => openVisit(b.dataset.v));
  $$('[data-pe]', el).forEach(b => b.onclick = () => { const v = vis.find(x => x.entity_id === b.dataset.pe); openPlace(v.entity); });
  $$('[data-wd]', el).forEach(b => b.onclick = async () => {
    if (!await confirmSheet('Discard this saved visit?', 'It has not been sent. Discarding removes it from this phone for good.', 'Discard', true)) return;
    await idb.del(b.dataset.wd); viewVisits();
  });
  const ws = $('#wsend', el); if (ws) ws.onclick = async () => { ws.disabled = true; await flushOutbox(); viewVisits(); };
}

/* ───────── Verify (branch heads) ───────── */
async function drawVerify(el) {
  const me = S.who.me;
  const rows = await q(sb.from('visits').select('id, visit_no, visitor, visited_at, outcome, closure, entity:entities(name, type)')
    .eq('visitor_branch', me.branch_code).eq('status', 'submitted').neq('visitor', me.emp_id).order('visited_at', { ascending: true }));
  el.innerHTML = `<p class="muted" style="margin-top:0">Visits by ${esc(me.branch)} staff waiting for your check. Open one, look at the photos and details, then tap <b>Verify</b>.</p>
    ${rows.length ? `<div class="list">${rows.map(v => `<button class="item" data-v="${v.id}">
        <div class="avatar">${esc(initials(personName(v.visitor)))}</div>
        <div class="grow"><div class="t">${esc(v.entity.name)} · V${v.visit_no}</div><div class="s">${esc(personName(v.visitor))} · ${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '')}</div></div>
        <span class="chev">${ICON.chev}</span></button>`).join('')}</div>`
      : `<div class="empty">${ICON.shield}<p>All caught up. Nothing to verify.</p></div>`}`;
  $$('[data-v]', el).forEach(b => b.onclick = () => openVisit(b.dataset.v));
}
