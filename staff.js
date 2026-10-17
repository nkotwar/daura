/* Daura · one staff member's work: summary numbers, every place allotted to them with its current status,
   and their own (self-initiated) visits. Used in Admin → People and Dashboard → Officers. */

async function loadStaffWork(el, emp) {
  el.innerHTML = '<div class="spin" style="margin:18px auto"></div>';
  let asg, vis;
  try {
    [asg, vis] = await Promise.all([
      q(sb.from('assignments').select('id, scheduled_on, entity:entities(id, name, type, area, address, contact, closure, lat, lng, created_by)').eq('assignee', emp).eq('status', 'open').order('scheduled_on')),
      q(sb.from('visits').select('id, entity_id, assignment_id, visit_no, status, visited_at, outcome, closure, potential_rs, mobilised_rs, account_numbers, entity:entities(id, name, type, area, address, contact, closure, lat, lng, created_by)').eq('visitor', emp).order('visited_at', { ascending: false }))
    ]);
  } catch (e) { el.innerHTML = `<p class="hint">${esc(errText(e))}</p>`; return; }

  const today = todayISO();
  const byAsg = new Map(); vis.forEach(v => { if (v.assignment_id) { const c = byAsg.get(v.assignment_id); if (!c || v.visit_no < c.visit_no) byAsg.set(v.assignment_id, v); } });
  const latest = new Map(); vis.forEach(v => { const c = latest.get(v.entity_id); if (!c || v.visit_no > c.visit_no) latest.set(v.entity_id, v); });
  const rows = asg.map(a => {
    const v = byAsg.get(a.id);
    const st = v ? (v.status === 'verified' ? 'verified' : 'visited') : !a.scheduled_on ? 'upcoming' : a.scheduled_on < today ? 'overdue' : a.scheduled_on === today ? 'today' : 'upcoming';
    return { a, v, st, late: st === 'overdue' ? daysBetween(a.scheduled_on, today) : 0, closure: (latest.get(a.entity.id) || {}).closure || a.entity.closure };
  });
  const order = { overdue: 0, today: 1, upcoming: 2, visited: 3, verified: 4 };
  rows.sort((x, y) => order[x.st] - order[y.st] || (x.a.scheduled_on || '').localeCompare(y.a.scheduled_on || ''));
  const n = k => rows.filter(r => r.st === k).length;
  const own = vis.filter(v => !v.assignment_id);
  const opened = vis.filter(v => v.closure === 'account_opened');
  const potential = [...latest.values()].reduce((s, v) => s + (+v.potential_rs || 0), 0);
  const mobilised = opened.reduce((s, v) => s + (+v.mobilised_rs || 0), 0);
  const visitedN = n('visited') + n('verified');
  const badge = r => ({
    overdue: `<span class="badge bad">${r.late} d overdue</span>`, today: '<span class="badge warn">Due today</span>',
    upcoming: `<span class="badge">Due ${r.a.scheduled_on ? fmtDate(r.a.scheduled_on) : '—'}</span>`,
    visited: '<span class="badge acc">Visited · not verified</span>', verified: '<span class="badge ok">Verified</span>' }[r.st]);
  const filt = el._f || 'all';
  const shown = filt === 'all' ? rows : rows.filter(r => filt === 'visited' ? (r.st === 'visited' || r.st === 'verified') : filt === 'pending' ? (r.st === 'today' || r.st === 'upcoming') : r.st === filt);

  el.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${rows.length}</b><span>Allotted</span></div>
      <div class="stat ok"><b>${visitedN}</b><span>Visited · ${pct(visitedN, rows.length)}%</span></div>
      <div class="stat ${n('overdue') ? 'bad' : ''}"><b>${n('overdue')}</b><span>Overdue</span></div>
      <div class="stat"><b>${n('verified')}</b><span>Verified</span></div>
      <div class="stat"><b>${own.length}</b><span>Own visits</span></div>
      <div class="stat ok"><b>${opened.length}</b><span>Accounts opened</span></div>
    </div>
    ${potential || mobilised ? `<p class="hint" style="margin-top:-4px">Potential ${inrShort(potential)} · Mobilised ${inrShort(mobilised)}</p>` : ''}
    ${rows.length ? `${stackBar([['Verified', n('verified'), 'ok'], ['Visited, not verified', n('visited'), 'acc'], ['Not due yet', n('today') + n('upcoming'), 'mute'], ['Overdue', n('overdue'), 'bad']], rows.length)}
    <h4 class="dh">Allotted places</h4>
    <div class="chips" style="margin-top:0">${[['all', 'All', rows.length], ['overdue', 'Overdue', n('overdue')], ['pending', 'Coming up', n('today') + n('upcoming')], ['visited', 'Visited', visitedN]]
      .filter(([k, , c]) => k === 'all' || c).map(([k, l, c]) => `<button class="chip ${filt === k ? 'on' : ''}" data-sf="${k}">${l}<b>${c}</b></button>`).join('')}</div>
    <div class="list">${shown.map(r => `<button class="item" data-ent="${r.a.entity.id}" data-asg="${r.a.id}">
        <div class="grow"><div class="t">${esc(r.a.entity.name)}</div>
          <div class="s">${esc(r.a.entity.type)}${r.a.entity.area ? ' · ' + esc(r.a.entity.area) : ''}${r.v ? ` · visited ${fmtDate(r.v.visited_at)}` : ''}</div></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none">${badge(r)}${r.closure ? `<span class="badge ${r.closure === 'account_opened' ? 'ok' : ''}">${closureLabel(r.closure)}</span>` : ''}</div></button>`).join('')}</div>`
      : '<p class="hint">No places allotted.</p>'}
    ${own.length ? `<h4 class="dh">Own visits</h4><div class="list">${own.map(v => `<button class="item" data-v="${v.id}"><div class="avatar mono" style="font-size:12px">V${v.visit_no}</div>
        <div class="grow"><div class="t">${esc(v.entity.name)}</div><div class="s">${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '—')}</div></div>
        <span class="badge ${v.status === 'verified' ? 'ok' : 'acc'}">${v.status === 'verified' ? 'Verified' : 'Visited'}</span></button>`).join('')}</div>` : ''}`;
  $$('[data-sf]', el).forEach(b => b.onclick = () => { el._f = b.dataset.sf; loadStaffWork(el, emp); });
  $$('[data-ent]', el).forEach(b => b.onclick = () => { const r = rows.find(x => x.a.id === b.dataset.asg); openPlace(r.a.entity); });
  $$('[data-v]', el).forEach(b => b.onclick = () => openVisit(b.dataset.v));
}

/* Staff summary for viewers (admins get the full People panel, which includes this). */
async function openStaff(emp) {
  if (S.who.admin) {
    if (!S.cache.people) { try { S.cache.people = await rpc('admin_people'); } catch (e) { toast(errText(e)); return; } }
    return openPerson(emp);
  }
  await loadBasics();
  const p = S.dir.get(emp) || { name: 'Emp ' + emp };
  const tel = telLink(p.phone);
  const body = openSheet(cleanName(p.name), `
    <div class="row wrap" style="margin-bottom:10px"><span class="badge">${esc(p.designation || '')}</span><span class="badge">${esc(p.branch || '')}</span>${p.is_branch_head ? '<span class="badge ok">Branch head</span>' : ''}</div>
    ${tel ? `<div class="row" style="margin-bottom:6px"><a class="btn ghost grow" href="${tel}">${ICON.phone} Call</a>${waLink(p.phone, `Dear ${cleanName(p.name)}, `) ? `<a class="btn soft grow" target="_blank" rel="noopener" href="${waLink(p.phone, `Dear ${cleanName(p.name)}, `)}">${ICON.wa} WhatsApp</a>` : ''}</div>` : ''}
    <div id="sw"></div>`);
  loadStaffWork($('#sw', body), emp);
}
