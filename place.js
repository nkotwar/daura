/* Daura · places (search, add new), a place's page with its visit history, and a visit's full view. */

async function loadEntities(force = false) {
  if (!force && S.cache.entities) return S.cache.entities;
  const rows = []; let from = 0;
  while (true) {   // page through in 1000s
    const page = await q(sb.from('entities').select('id, name, type, area, address, contact, closure, lat, lng, created_by').order('name').range(from, from + 999));
    rows.push(...page); if (page.length < 1000) break; from += 1000;
  }
  S.cache.entities = rows;
  return rows;
}

/* ───────── Places tab segment ───────── */
async function drawPlaces(el) {
  el.innerHTML = '<div class="spin"></div>';
  let list;
  try { list = await loadEntities(); } catch (e) { el.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  el.innerHTML = `<div class="row" style="margin-bottom:10px"><div class="search grow">${ICON.search}<input class="input" id="eq" type="search" placeholder="Search ${list.length} places" value="${esc(S.cache.placeQ || '')}" autocomplete="off"></div></div>
    <button class="btn soft block" id="addp">+ Add a new place</button><div class="spacer"></div>
    <div class="list" id="el"></div>`;
  const draw = () => {
    const t = $('#eq').value.trim().toLowerCase(); S.cache.placeQ = t;
    const rows = list.filter(e => !t || (e.name + ' ' + (e.area || '') + ' ' + e.type + ' ' + (e.address || '')).toLowerCase().includes(t)).slice(0, 60);
    $('#el').innerHTML = rows.length ? rows.map(e => `<button class="item" data-e="${e.id}"><div class="grow"><div class="t">${esc(e.name)}</div>
        <div class="s">${esc(e.type)}${e.area ? ' · ' + esc(e.area) : ''}</div></div>
        ${e.closure ? `<span class="badge ${e.closure === 'account_opened' ? 'ok' : ''}">${closureLabel(e.closure)}</span>` : ''}<span class="chev">${ICON.chev}</span></button>`).join('')
      : '<div class="empty">No place by that name. Add it as a new place.</div>';
  };
  draw();
  $('#eq').oninput = draw;
  $('#el').onclick = ev => { const b = ev.target.closest('[data-e]'); if (b) openPlace(list.find(e => e.id === b.dataset.e)); };
  $('#addp').onclick = () => openNewPlace($('#eq').value.trim());
}

async function openNewPlace(prefill = '') {
  await loadBasics();
  const list = await loadEntities();
  const body = openSheet('Add a new place', `
    <label class="f" for="np-n">Name</label><input class="input" id="np-n" value="${esc(prefill)}" autocomplete="off">
    <div id="np-dup"></div>
    <label class="f" for="np-t">Type</label><select class="input" id="np-t">${setting('entity_types').map(t => `<option>${esc(t)}</option>`).join('')}</select>
    <label class="f" for="np-a">Town / area</label><input class="input" id="np-a" value="${esc(S.who.me.branch || '')}">
    <label class="f" for="np-ad">Address</label><textarea class="input" id="np-ad" rows="2"></textarea>
    <label class="f" for="np-c">Contact details</label><input class="input" id="np-c" placeholder="Phone, email, website">
    <p class="hint" id="np-err" style="color:var(--bad)"></p>
    <button class="btn block" id="np-save">Add place</button>`);
  const dup = () => {
    const t = $('#np-n', body).value.trim().toLowerCase();
    const words = t.split(/\s+/).filter(w => w.length > 2);
    const hits = t.length < 4 ? [] : list.filter(e => words.every(w => e.name.toLowerCase().includes(w))).slice(0, 5);
    $('#np-dup', body).innerHTML = hits.length ? `<div class="note warn" style="margin-top:8px">Already in Daura? Tap it instead of adding again:
      <div class="list" style="margin-top:8px">${hits.map(e => `<button class="item" data-open="${e.id}"><div class="grow"><div class="t">${esc(e.name)}</div><div class="s">${esc(e.type)} · ${esc(e.area || '')}</div></div></button>`).join('')}</div></div>` : '';
    $$('[data-open]', body).forEach(b => b.onclick = () => openPlace(list.find(e => e.id === b.dataset.open)));
  };
  $('#np-n', body).oninput = dup; dup();
  $('#np-save', body).onclick = async () => {
    const name = $('#np-n', body).value.trim();
    if (name.length < 3) { $('#np-err', body).textContent = 'Please enter the place\'s name.'; return; }
    $('#np-save', body).disabled = true;
    try {
      const [e] = await q(sb.from('entities').insert({ name, type: $('#np-t', body).value, area: $('#np-a', body).value.trim() || null,
        address: $('#np-ad', body).value.trim() || null, contact: $('#np-c', body).value.trim() || null }).select('id, name, type, area, address, contact, closure, lat, lng, created_by'));
      S.cache.entities = null;
      toast('Place added');
      openPlace(e);
    } catch (err) { $('#np-save', body).disabled = false; $('#np-err', body).textContent = errText(err); }
  };
}

/* ───────── A place's page ───────── */
async function openPlace(e, assignment) {
  const me = S.who.me;
  if (!assignment && S.cache.visits) assignment = S.cache.visits.asg.find(a => a.entity.id === e.id);
  const body = openSheet(e.name, '<div class="spin"></div>');
  let tl;
  try { tl = await rpc('entity_timeline', { p_entity: e.id }); }
  catch (err) { body.innerHTML = `<div class="empty">${esc(errText(err))}</div>`; return; }
  const latest = tl[tl.length - 1];
  const asgVisited = !!(assignment && me && tl.some(v => v.visitor_emp === me.emp_id));
  let action = '';
  if (!me) action = '';
  else if (!latest) action = `<button class="btn block" id="pl-log">${ICON.pin} Log visit</button>`;
  else if (latest.closure) action = `<div class="note">Closed: <b>${closureLabel(latest.closure)}</b> (Visit ${latest.visit_no}).${S.who.admin ? ' <button class="linkbtn" id="pl-reopen">Reopen</button>' : ' Ask the admin if it needs reopening.'}</div>`;
  else if (latest.status === 'verified') action = `<button class="btn block" id="pl-fu">+ Add follow-up · Visit ${latest.visit_no + 1}</button>`;
  else action = `<div class="note">A follow-up can be added once Visit ${latest.visit_no} is verified.</div>`;
  const myAsg = assignment && assignment.status === 'open' && me && !asgVisited;

  body.innerHTML = `
    <div class="row wrap" style="margin-bottom:10px"><span class="badge acc">${esc(e.type)}</span>${e.area ? `<span class="badge">${esc(e.area)}</span>` : ''}
      ${assignment ? `<span class="badge ${assignment.scheduled_on < todayISO() && !asgVisited ? 'bad' : ''}">Scheduled ${fmtDate(assignment.scheduled_on)}</span>` : ''}
      ${e.lat != null ? '<span class="badge ok">On map</span>' : ''}</div>
    <dl class="kv"><dt>Address</dt><dd>${esc(e.address || '—')}</dd><dt>Contact</dt><dd>${esc(e.contact || '—')}</dd></dl>
    <div class="row" style="margin-top:12px">
      ${e.lat != null ? `<a class="btn ghost grow" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}">${ICON.pin} Map</a>`
        : e.address ? `<a class="btn ghost grow" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.name + ', ' + e.address)}">${ICON.pin} Find on Maps</a>` : ''}
    </div>
    <div class="spacer"></div>${action}
    <h2>Visit history</h2>
    ${tl.length ? `<div class="list">${tl.map(v => `<button class="item" ${v.can_open ? `data-v="${v.id}"` : 'style="cursor:default"'}>
        <div class="avatar mono" style="font-size:12px">V${v.visit_no}</div>
        <div class="grow"><div class="t">${esc(cleanName(v.visitor))}</div><div class="s">${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '—')}${v.next_step ? ' · Next: ' + esc(v.next_step) : ''}</div></div>
        <span class="badge ${v.status === 'verified' ? 'ok' : 'warn'}">${v.status === 'verified' ? 'Verified' : 'Submitted'}</span>${v.can_open ? `<span class="chev">${ICON.chev}</span>` : ''}</button>`).join('')}</div>`
      : '<p class="hint">Not visited yet.</p>'}
    ${myAsg ? `<h2>Your allotment</h2><div class="row"><button class="btn ghost grow small" id="pl-reas">Ask to reassign</button><button class="btn ghost grow small" id="pl-rem">Ask to remove</button></div>` : ''}`;

  const go = (nextNo) => openVisitForm({ entity: e, assignment: myAsg ? assignment : null, nextNo });
  if ($('#pl-log', body)) $('#pl-log', body).onclick = () => go(1);
  if ($('#pl-fu', body)) $('#pl-fu', body).onclick = () => go(latest.visit_no + 1);
  if ($('#pl-reopen', body)) $('#pl-reopen', body).onclick = async () => {
    try { await rpc('admin_reopen_place', { p_entity: e.id }); toast('Place reopened'); S.cache.entities = null; openPlace({ ...e, closure: null }, assignment); } catch (err) { toast(errText(err)); }
  };
  $$('[data-v]', body).forEach(b => b.onclick = () => openVisit(b.dataset.v));
  if ($('#pl-reas', body)) $('#pl-reas', body).onclick = () => askRequest('reassign', null, assignment.id, `Reassign ${e.name}`, 'Why should someone else visit? e.g. not in my area, I am on leave');
  if ($('#pl-rem', body)) $('#pl-rem', body).onclick = () => askRequest('delete_assignment', null, assignment.id, `Remove ${e.name}`, 'Why should this visit be removed? e.g. closed down, duplicate, not relevant');
}

/* A reason box → request to the admin */
function askRequest(kind, visitId, asgId, title, placeholder) {
  const body = openSheet(title, `<p class="muted" style="margin-top:0">The admin will approve or decline this.</p>
    <label class="f" for="rq">Reason</label><textarea class="input" id="rq" rows="3" placeholder="${esc(placeholder)}"></textarea>
    <p class="hint" id="rqe" style="color:var(--bad)"></p><button class="btn block" id="rqs">Send request</button>`);
  $('#rqs', body).onclick = async () => {
    const reason = $('#rq', body).value.trim();
    if (reason.length < 5) { $('#rqe', body).textContent = 'Please write a short reason.'; return; }
    $('#rqs', body).disabled = true;
    try { await rpc('raise_request', { p_kind: kind, p_visit: visitId, p_assignment: asgId, p_reason: reason }); closeSheet(); toast('Request sent to the admin'); }
    catch (e) { $('#rqs', body).disabled = false; $('#rqe', body).textContent = errText(e); }
  };
}

/* ───────── A visit's full view ───────── */
async function openVisit(id) {
  const body = openSheet('Visit', '<div class="spin"></div>');
  let v, photos, joint, ent;
  try {
    await loadBasics();
    [[v], photos, joint] = await Promise.all([
      q(sb.from('visits').select('*, entity:entities(id, name, type, area, address, contact, closure, lat, lng)').eq('id', id)),
      q(sb.from('visit_photos').select('*').eq('visit_id', id).order('created_at')),
      q(sb.from('visit_joint').select('emp_id').eq('visit_id', id))
    ]);
  } catch (e) { body.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  if (!v) { body.innerHTML = '<div class="empty">This visit is no longer available.</div>'; return; }
  ent = v.entity;
  const me = S.who.me || {};
  const mine = v.visitor === me.emp_id, sub = v.status === 'submitted', adm = S.who.admin;
  const canVerify = sub && (adm || (me.is_branch_head && v.visitor_branch === me.branch_code && !mine));
  $('.sheet-head h3').textContent = `${ent.name} · Visit ${v.visit_no}`;
  const urls = await signedUrls(photos.map(p => p.path)).catch(() => ({}));
  const pending = await raisedFor(v.id);
  const kv = (k, val) => val == null || val === '' || (Array.isArray(val) && !val.length) ? '' : `<dt>${k}</dt><dd>${val}</dd>`;
  body.innerHTML = `
    <div class="row wrap" style="margin-bottom:12px">
      <span class="badge ${v.status === 'verified' ? 'ok' : 'warn'}">${v.status === 'verified' ? 'Verified' : 'Submitted, not yet verified'}</span>
      ${v.closure ? `<span class="badge ${v.closure === 'account_opened' ? 'ok' : 'bad'}">${closureLabel(v.closure)}</span>` : ''}
      ${v.assignment_id ? '<span class="badge acc">Allotted</span>' : '<span class="badge">Self-initiated</span>'}</div>
    ${photos.length ? `<div class="pgrid" style="margin-bottom:14px">${photos.map(p => `<a class="pthumb" href="${urls[p.path] || '#'}" target="_blank" rel="noopener"><img src="${urls[p.path] || ''}" alt="Visit photo" loading="lazy"><span class="ptag">${p.source === 'capture' ? 'Live' : 'Uploaded'}</span></a>`).join('')}</div>` : ''}
    <dl class="kv">
      ${kv('Visited by', esc(personName(v.visitor)) + (joint.length ? ' with ' + joint.map(j => esc(personName(j.emp_id))).join(', ') : ''))}
      ${kv('When', fmtDateTime(v.visited_at))}
      ${kv('Logged', fmtDateTime(v.logged_at) + (new Date(v.logged_at) - new Date(v.visited_at) > 864e5 ? ` <span class="badge">${Math.floor((new Date(v.logged_at) - new Date(v.visited_at)) / 864e5)} d after visit</span>` : ''))}
      ${kv('Location', v.lat != null ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}" class="mono">${fmtCoords({ lat: v.lat, lng: v.lng, acc: v.accuracy_m })}</a>` : 'Not recorded')}
      ${kv('Person met', [esc(v.person_name), esc(v.person_designation)].filter(Boolean).join(', '))}
      ${kv('Mobile', v.person_mobile ? `<a href="tel:${esc(v.person_mobile)}" class="mono">${esc(v.person_mobile)}</a>` : '')}
      ${kv('Banks with', { us: 'Our bank', other: 'Other bank' + (v.other_bank ? ': ' + esc(v.other_bank) : ''), none: 'None / not known' }[v.banking_with])}
      ${kv('Headcount', v.headcount != null ? `${v.headcount} ${esc((v.headcount_kind || '').toLowerCase())}` : '')}
      ${kv('Potential', v.potential_rs != null ? inr(v.potential_rs) : '')}
      ${kv('Products', esc((v.products || []).join(', ')))}
      ${kv('Outcome', esc(v.outcome))}
      ${kv('Remarks', esc(v.remarks))}
      ${kv('Next step', esc(v.next_step))}
      ${kv('Follow-up', v.followup_on ? fmtDate(v.followup_on) : '')}
      ${kv('Closure', v.closure ? closureLabel(v.closure) + (v.closure_note ? ': ' + esc(v.closure_note) : '') : '')}
      ${kv('Accounts', v.account_numbers && v.account_numbers.length ? `<span class="mono">${v.account_numbers.map(esc).join(', ')}</span>` : '')}
      ${kv('Mobilised', v.mobilised_rs != null ? inr(v.mobilised_rs) : '')}
      ${kv('Verified', v.verified_at ? `${esc(v.verified_by ? personName(v.verified_by) : 'Admin')} · ${fmtDateTime(v.verified_at)}` : '')}
    </dl>
    ${pending ? `<div class="note warn" style="margin-top:12px">Your ${pending} request is waiting with the admin.</div>` : ''}
    <div class="stack" style="margin-top:16px" id="v-acts"></div>`;

  const acts = [];
  if (canVerify) acts.push(`<button class="btn block" id="va-ver">✓ Verify this visit</button>`);
  if (mine && sub) acts.push(`<button class="btn ghost block" id="va-edit">Edit</button>`);
  if (mine && sub && !v.assignment_id && !v.created_by_admin) acts.push(`<button class="btn danger block" id="va-del">Delete</button>`);
  if (mine && sub && (v.assignment_id || v.created_by_admin) && !pending) acts.push(`<button class="btn ghost block" id="va-rdel">Ask admin to delete</button>`);
  if (mine && !sub && !pending) acts.push(`<button class="btn ghost block" id="va-runv">Ask admin to unverify (to edit)</button>`);
  if (adm && !sub) acts.push(`<button class="btn ghost block" id="va-unv">Unverify</button>`);
  if (adm && !mine) acts.push(`<button class="btn danger block" id="va-adel">Delete visit (admin)</button>`);
  $('#v-acts', body).innerHTML = acts.join('');

  const on = (sel, fn) => { const b = $(sel, body); if (b) b.onclick = fn; };
  on('#va-ver', async () => { try { await rpc('verify_visit', { p_visit: v.id }); toast('Verified'); closeSheet(); refreshCurrent(); } catch (e) { toast(errText(e)); } });
  on('#va-unv', async () => { try { await rpc('unverify_visit', { p_visit: v.id }); toast('Unverified: the visitor can edit it again'); openVisit(v.id); } catch (e) { toast(errText(e)); } });
  on('#va-edit', () => openVisitForm({ entity: ent, visit: v, photos: photos.map(p => ({ id: p.id, path: p.path, url: urls[p.path], source: p.source })), joint: joint.map(j => j.emp_id) }));
  on('#va-del', async () => {
    if (!await confirmSheet('Delete this visit?', 'The visit and its photos are removed for good.', 'Delete', true)) return openVisit(v.id);
    try { await deleteVisitWithPhotos(v.id, photos); toast('Visit deleted'); refreshCurrent(); } catch (e) { toast(errText(e)); }
  });
  on('#va-adel', async () => {
    if (!await confirmSheet('Delete this visit?', `${esc(personName(v.visitor))}'s Visit ${v.visit_no} to ${esc(ent.name)} and its photos are removed for good.`, 'Delete', true)) return openVisit(v.id);
    try { await deleteVisitWithPhotos(v.id, photos); toast('Visit deleted'); refreshCurrent(); } catch (e) { toast(errText(e)); }
  });
  on('#va-rdel', () => askRequest('delete_visit', v.id, null, 'Ask to delete this visit', 'Why should this visit be deleted?'));
  on('#va-runv', () => askRequest('unverify', v.id, null, 'Ask to unverify', 'What do you need to correct?'));
}

async function raisedFor(visitId) {
  try {
    const r = await q(sb.from('requests').select('kind').eq('visit_id', visitId).eq('status', 'pending').eq('raised_by', (S.who.me || {}).emp_id || 0).limit(1));
    return r.length ? { delete_visit: 'delete', unverify: 'unverify' }[r[0].kind] || '' : '';
  } catch (e) { return ''; }
}

async function deleteVisitWithPhotos(id, photos) {
  if (photos && photos.length) await sb.storage.from('photos').remove(photos.map(p => p.path));
  const gone = await q(sb.from('visits').delete().eq('id', id).select('id'));
  if (!gone.length) throw { message: 'NOT_ALLOWED', hint: 'This visit can no longer be deleted. It may have been verified.' };
}

function refreshCurrent() { closeSheet(); S.cache.entities = null; if (VIEWS[S.tab]) VIEWS[S.tab](); }
