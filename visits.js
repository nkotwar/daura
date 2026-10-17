/* TASC Connect · Visits tab: My visits (allotments and visit reports, with quick filters) · Places · Verify (branch heads). */

async function viewVisits() {
  const me = S.who.me;
  const main = TV();
  if (!me) {
    main.innerHTML = `<div class="empty">${ICON.shield}<p>You are signed in as admin without a staff profile.<br>Open the <b>Admin</b> tab.</p></div>`;
    return;
  }
  const panes = [
    { id: 'mine', label: 'My visits', badge: 'vn-mine', draw: el => drawMine(el) },
    { id: 'places', label: 'Places', badge: 'vn-places', draw: el => drawPlaces(el) }
  ];
  if (me.is_branch_head) panes.push({ id: 'verify', label: 'Verify', badge: 'vn-verify', draw: el => drawVerify(el) });
  const old = $('#v-host', main);
  if (old && old._pager && old._pager.ids === panes.map(p => p.id).join(',')) {   // already built: refresh quietly
    await old._pager.refresh(); countBadges(); return;
  }
  main.innerHTML = `${S.updateReady ? updateBar() : ''}<div id="v-host"></div>`;
  bindUpdate();
  await loadBasics();
  mountPager($('#v-host', main), panes, S.cache.vseg || 'mine', id => { S.cache.vseg = id; remember(); });
  countBadges();
}

async function countBadges() {
  try {
    const n = (await idb.all()).length;
    const od = S.cache.visits ? visitRows().overdue.length : 0;
    const el = $('#vn-mine'); if (el) el.textContent = (od ? ` · ${od}` : '') + (n ? ` · ${n}⏳` : '');
  } catch (e) { /* no IndexedDB */ }
  if (S.who.me && S.who.me.is_branch_head) {
    const count = qBranchVerify().length;
    const el = $('#vn-verify'); if (el) el.textContent = count ? ` · ${count}` : '';
  }
}

/* ───────── My visits: allotments and visit reports in one list ───────── */
/* My work comes from the phone's copy: no database call. */
async function loadMyWork() { S.cache.visits = qMyWork(); return S.cache.visits; }

/* Every row is in exactly one stage: overdue · today · upcoming · hold (allotments not visited yet),
   visited (report sent, not verified yet) · verified. */
function visitRows() {
  const { asg, vis, hold, cover } = S.cache.visits;
  const today = todayISO();
  const done = new Set(vis.filter(v => v.assignment_id).map(v => v.assignment_id));
  const g = { overdue: [], today: [], upcoming: [], hold: [], visited: [], verified: [] };
  for (const a of asg) {
    if (done.has(a.id)) continue;   // shown by its visit report instead
    const cv = cover && cover.get(a.id);
    if (cv) { (cv.status === 'verified' ? g.verified : g.visited).push({ k: 'cover', a, cv, at: cv.visited_at }); continue; }
    const r = { k: 'asg', a };
    if (hold && hold.has(a.id)) g.hold.push(r);
    else if (a.scheduled_on && a.scheduled_on < today) g.overdue.push(r);
    else if (a.scheduled_on === today) g.today.push(r);
    else g.upcoming.push(r);
  }
  for (const v of vis) (v.status === 'verified' ? g.verified : g.visited).push({ k: 'visit', v, at: v.visited_at });
  g.visited.sort((x, y) => (y.at || '').localeCompare(x.at || ''));
  g.verified.sort((x, y) => (y.at || '').localeCompare(x.at || ''));
  return g;
}

const STAGES = [['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['hold', '🔒 On hold'], ['visited', 'Visited'], ['verified', 'Visit Verified']];

function visitRowHTML(r, stage, today) {
  if (r.k === 'visit') {
    const v = r.v;
    return `<button class="item" data-v="${v.id}"><div class="avatar mono" style="font-size:12px">V${v.visit_no}</div>
      <div class="grow"><div class="t">${esc(v.entity.name)}</div><div class="s">${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '—')}</div></div>
      <span class="badge ${v.status === 'verified' ? 'ok' : 'warn'}">${v.status === 'verified' ? 'Verified' : 'Awaiting check'}</span></button>`;
  }
  const a = r.a;
  if (r.k === 'cover') return `<button class="item" data-a="${a.id}"><div class="grow"><div class="t">${esc(a.entity.name)}</div>
      <div class="s">Visited by ${esc(cleanName(r.cv.visitor))} · ${fmtDate(r.cv.visited_at)}</div></div>
      <span class="badge ${r.cv.status === 'verified' ? 'ok' : 'acc'}">Colleague</span></button>`;
  const h = stage === 'hold' && S.cache.visits.hold.get(a.id);
  if (h) return `<button class="item locked" data-a="${a.id}"><div class="lock">${ICON.lock}</div><div class="grow"><div class="t">${esc(a.entity.name)}</div>
      <div class="s">Asked to ${h.kind === 'reassign' ? 'reassign' : 'remove'} · ${ago(h.created_at)} · waiting for admin</div></div>
    <span class="badge warn">Request pending</span></button>`;
  const late = stage === 'overdue' ? daysBetween(a.scheduled_on, today) : 0;
  return `<button class="item" data-a="${a.id}"><div class="grow"><div class="t">${esc(a.entity.name)}</div>
      <div class="s">${esc(a.entity.type)}${a.entity.area ? ' · ' + esc(a.entity.area) : ''}</div></div>
    <div style="text-align:right;flex:none"><div class="mono" style="font-size:13px">${fmtDate(a.scheduled_on)}</div>
      ${late ? `<span class="badge bad">${late} d late</span>` : stage === 'today' ? '<span class="badge warn">Today</span>' : ''}</div></button>`;
}

async function drawMine(el, noFetch) {
  const [, waiting] = await Promise.all([noFetch && S.cache.visits ? null : loadMyWork(), idb.all().catch(() => [])]);
  const { vis } = S.cache.visits;
  const g = visitRows(), today = todayISO();
  const total = STAGES.reduce((n, [k]) => n + g[k].length, 0);
  if (!total && !waiting.length) {
    el.innerHTML = emptyState(ICON.calendar, 'Nothing here yet',
      'Visits the Regional Office allots to you show up here with their due dates, and so do the visit reports you submit.',
      '<button class="btn soft" data-goto="places">Visit a place on your own</button>');
    return;
  }
  let f = S.cache.visitFilter;
  if (f !== 'all' && !(f && g[f])) f = 'all';
  S.cache.visitFilter = f;
  const pill = (id, label, n, cls) => `<button class="chip ${f === id ? 'on' : ''} ${cls || ''}" data-f="${id}">${label}<b>${n}</b></button>`;
  const pills = pill('all', 'All', total) + STAGES.filter(([k]) => k !== 'hold' || g.hold.length || f === 'hold')
    .map(([k, l]) => pill(k, l, g[k].length, k === 'overdue' && g.overdue.length && f !== 'overdue' ? 'hot' : '')).join('');

  // follow-ups due in the next 7 days (shown in All)
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const latest = new Map();
  vis.forEach(v => { const c = latest.get(v.entity_id); if (!c || v.visit_no > c.visit_no) latest.set(v.entity_id, v); });
  const due = [...latest.values()].filter(v => v.followup_on && v.followup_on <= soon && !v.closure).sort((x, y) => x.followup_on.localeCompare(y.followup_on));

  const list = rows => `<div class="list">${rows.join('')}</div>`;
  let body;
  if (f === 'all') {
    body = STAGES.filter(([k]) => g[k].length).map(([k, l]) =>
      `<h4 class="dh">${l} · ${g[k].length}</h4>${list(g[k].map(r => visitRowHTML(r, k, today)))}`).join('');
  } else {
    const msg = { overdue: ['Nothing overdue', 'Every visit due so far has a report.'], today: ['Nothing due today', 'Check Upcoming for what is next.'],
      upcoming: ['Nothing coming up', 'No more allotted visits after today.'], hold: ['Nothing on hold', 'Allotments you asked the admin to reassign or remove wait here until the admin decides.'],
      visited: ['Nothing awaiting a check', 'Reports you submit wait here until they are verified.'], verified: ['No verified visits yet', 'Once checked, your visit reports move here.'] }[f];
    body = g[f].length ? list(g[f].map(r => visitRowHTML(r, f, today))) : emptyState(f === 'overdue' ? ICON.shield : ICON.calendar, msg[0], msg[1]);
  }

  el.innerHTML = `
    <div class="chips wrap">${pills}</div>
    ${waiting.length ? `<h4 class="dh">Waiting to send · ${waiting.length}</h4><div class="list">${waiting.map(w => `<div class="item" style="cursor:default">
        <div class="grow"><div class="t">${esc(w.entityName)}</div><div class="s">${w.error ? `<span style="color:var(--bad)">${esc(w.error)}</span>` : 'Saved on this phone ' + ago(w.savedAt) + '. Sends when online.'}</div></div>
        <button class="btn small ghost" data-wd="${w.id}">Discard</button></div>`).join('')}</div>
      <button class="btn soft block" id="wsend" style="margin-top:8px">Send now</button>` : ''}
    ${f === 'all' && due.length ? `<h4 class="dh">Follow-ups due · ${due.length}</h4><div class="list">${due.map(v => `<button class="item" data-pe="${v.entity_id}"><div class="grow"><div class="t">${esc(v.entity.name)}</div>
        <div class="s">${esc(v.next_step || 'Follow-up')}${v.status !== 'verified' ? ' · Visit ' + v.visit_no + ' awaiting verification' : ''}</div></div>
        <span class="badge ${v.followup_on < today ? 'bad' : v.followup_on === today ? 'warn' : ''}">${fmtDate(v.followup_on)}</span></button>`).join('')}</div>` : ''}
    ${body}
    <div class="spacer"></div>
    <p class="hint" style="text-align:center">Visiting somewhere not on your list? <button class="linkbtn" data-goto="places">Find or add it in Places</button></p>`;

  $$('.chip[data-f]', el).forEach(b => b.onclick = () => { S.cache.visitFilter = b.dataset.f; drawMine(el, true); });
  $$('[data-a]', el).forEach(b => b.onclick = () => { const a = S.cache.visits.asg.find(x => x.id === b.dataset.a); openPlace(a.entity, a); });
  $$('[data-v]', el).forEach(b => b.onclick = () => openVisit(b.dataset.v));
  $$('[data-pe]', el).forEach(b => b.onclick = () => { const v = vis.find(x => x.entity_id === b.dataset.pe); openPlace(v.entity); });
  $$('[data-wd]', el).forEach(b => b.onclick = async () => {
    if (!await confirmSheet('Discard this saved visit?', 'It has not been sent. Discarding removes it from this phone for good.', 'Discard', true)) return;
    await idb.del(b.dataset.wd); viewVisits();
  });
  const ws = $('#wsend', el); if (ws) ws.onclick = async () => { ws.disabled = true; await flushOutbox(); viewVisits(); };
  countBadges();
}

/* ───────── Verify (branch heads) ───────── */
async function drawVerify(el) {
  const me = S.who.me;
  const rows = qBranchVerify();
  if (!rows.length) {
    el.innerHTML = emptyState(ICON.shield, 'All caught up', `When ${esc(me.branch)} staff log visits, they wait here for your check. Open one, look at the photos and details, then tap Verify.`);
    return;
  }
  el.innerHTML = `<p class="muted" style="margin-top:0">Visits by ${esc(me.branch)} staff waiting for your check. Open one, look at the photos and details, then tap <b>Verify</b>.</p>
    ${rows.length ? `<div class="list">${rows.map(v => `<button class="item" data-v="${v.id}">
        <div class="avatar">${esc(initials(personName(v.visitor)))}</div>
        <div class="grow"><div class="t">${esc(v.entity.name)} · V${v.visit_no}</div><div class="s">${esc(personName(v.visitor))} · ${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '')}</div></div>
        <span class="chev">${ICON.chev}</span></button>`).join('')}</div>`
      : `<div class="empty">${ICON.shield}<p>All caught up. Nothing to verify.</p></div>`}`;
  $$('[data-v]', el).forEach(b => b.onclick = () => openVisit(b.dataset.v));
}
