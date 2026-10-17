/* Daura · Visits tab. Foundation build: your assigned visits (overdue, today, upcoming, done)
   and each place's details. The visit form, photos and follow-ups arrive in the next build. */

async function viewVisits() {
  const me = S.who.me;
  const main = $('#main');
  if (!me) {
    main.innerHTML = `<div class="empty">${ICON.shield}<p>You are signed in as admin without a staff profile.<br>Open the <b>Admin</b> tab.</p></div>`;
    return;
  }
  main.innerHTML = '<div class="spin"></div>';
  try {
    const [asg, vis] = await Promise.all([
      q(sb.from('assignments').select('id, scheduled_on, status, entity:entities(id, name, type, area, address, contact, closure)')
        .eq('assignee', me.emp_id).eq('status', 'open').order('scheduled_on', { ascending: true })),
      q(sb.from('visits').select('id, assignment_id, entity_id, visit_no, status, visited_at').eq('visitor', me.emp_id))
    ]);
    S.cache.visits = { asg, vis };
  } catch (e) {
    main.innerHTML = `<div class="empty"><p>${esc(errText(e))}</p><button class="btn" id="rt">Try again</button></div>`;
    $('#rt').onclick = viewVisits; return;
  }
  drawVisits();
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

function drawVisits() {
  const g = visitGroups();
  const f = S.cache.visitFilter || (g.overdue.length ? 'overdue' : g.today.length ? 'today' : 'upcoming');
  S.cache.visitFilter = f;
  const today = todayISO();
  const rows = g[f];
  const chip = (id, label) => `<button class="chip ${f === id ? 'on' : ''}" data-f="${id}">${label}<b>${g[id].length}</b></button>`;
  $('#main').innerHTML = `
    <div class="stats">
      <div class="stat ${g.overdue.length ? 'bad' : ''}"><b>${g.overdue.length}</b><span>Overdue</span></div>
      <div class="stat warn"><b>${g.today.length + g.upcoming.length}</b><span>Coming up</span></div>
      <div class="stat ok"><b>${g.done.length}</b><span>Visited</span></div>
    </div>
    <div class="note" style="margin-bottom:12px">Logging visits with photos arrives in the next update. For now, check your list and keep photos of each visit.</div>
    <div class="chips">${chip('overdue', 'Overdue')}${chip('today', 'Today')}${chip('upcoming', 'Upcoming')}${chip('done', 'Visited')}</div>
    ${rows.length ? `<div class="list">${rows.map(a => {
      const late = a.scheduled_on && a.scheduled_on < today && f === 'overdue' ? daysBetween(a.scheduled_on, today) : 0;
      return `<button class="item" data-a="${a.id}">
        <div class="grow"><div class="t">${esc(a.entity.name)}</div>
          <div class="s">${esc(a.entity.type)}${a.entity.area ? ' · ' + esc(a.entity.area) : ''}</div></div>
        <div style="text-align:right;flex:none"><div class="mono" style="font-size:13px">${fmtDate(a.scheduled_on)}</div>
          ${late ? `<span class="badge bad">${late} d late</span>` : ''}</div>
      </button>`; }).join('')}</div>`
      : `<div class="empty">${ICON.calendar}<p>Nothing here.</p></div>`}`;
  $$('.chip[data-f]').forEach(b => b.onclick = () => { S.cache.visitFilter = b.dataset.f; drawVisits(); });
  $$('[data-a]').forEach(b => b.onclick = () => openPlace(S.cache.visits.asg.find(a => a.id === b.dataset.a)));
}

async function openPlace(a) {
  const e = a.entity;
  const body = openSheet(e.name, `
    <div class="row wrap" style="margin-bottom:10px"><span class="badge acc">${esc(e.type)}</span>${e.area ? `<span class="badge">${esc(e.area)}</span>` : ''}
      <span class="badge">Scheduled ${fmtDate(a.scheduled_on)}</span></div>
    <dl class="kv">
      <dt>Address</dt><dd>${esc(e.address || '—')}</dd>
      <dt>Contact</dt><dd>${esc(e.contact || '—')}</dd>
    </dl>
    ${e.address ? `<div class="spacer"></div><a class="btn ghost block" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.name + ', ' + e.address)}">${ICON.pin} Open in Maps</a>` : ''}
    <h2>Visit history</h2><div id="tl"><div class="spin" style="margin:16px auto"></div></div>`);
  try {
    const tl = await rpc('entity_timeline', { p_entity: e.id });
    $('#tl', body).innerHTML = tl.length ? `<div class="list">${tl.map(v => `<div class="item" style="cursor:default">
        <div class="avatar mono" style="font-size:12px">V${v.visit_no}</div>
        <div class="grow"><div class="t">${esc(cleanName(v.visitor))}</div><div class="s">${fmtDateTime(v.visited_at)} · ${esc(v.outcome || '—')}</div></div>
        <span class="badge ${v.status === 'verified' ? 'ok' : 'warn'}">${v.status === 'verified' ? 'Verified' : 'Submitted'}</span></div>`).join('')}</div>`
      : '<p class="hint">Not visited yet.</p>';
  } catch (err) { $('#tl', body).innerHTML = `<p class="hint">${esc(errText(err))}</p>`; }
}
