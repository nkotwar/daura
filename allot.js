/* TASC Connect · admin allotment: give a place to a staff member with a visit date and a note.
   Used from "Add a new place" (admin) and from a place's page (Allot / Reallot). */

const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const latestCampaign = () => all('campaigns').sort((a, b) => b.id - a.id)[0];

/* The fields. `cur` = an existing allotment (for Reallot), else defaults. */
function allotFieldsHTML(cur, optional) {
  const camps = all('campaigns').sort((a, b) => b.id - a.id);
  const camp = cur ? cur.campaign_id : (latestCampaign() || {}).id;
  return `
    <label class="f" for="al-q">Allot to${optional ? ' <span class="hint">(optional)</span>' : ''}</label>
    <div id="al-picked"></div>
    <div class="search" id="al-sbox">${ICON.search}<input class="input" id="al-q" type="search" placeholder="Name, Emp ID or branch" autocomplete="off"></div>
    <div class="list" id="al-list" hidden></div>
    <div id="al-more" ${optional && !cur ? 'hidden' : ''}>
      <div class="g2">
        <div><label class="f" for="al-d">Visit by</label><input class="input" type="date" id="al-d" min="${todayISO()}" value="${esc((cur && cur.scheduled_on) || plusDays(7))}"></div>
        <div><label class="f" for="al-c">Campaign</label><select class="input" id="al-c">${camps.map(c => `<option value="${c.id}" ${c.id === camp ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="" ${camp ? '' : 'selected'}>None</option></select></div>
      </div>
      <label class="f" for="al-n">Note for staff <span class="hint">(optional)</span></label>
      <textarea class="input" id="al-n" rows="2" placeholder="e.g. Meet the secretary; they bank with SBI">${esc((cur && cur.note) || '')}</textarea>
      <div id="al-why" hidden><label class="f" for="al-r">Reason for reallotting <span class="hint">(optional)</span></label>
        <input class="input" id="al-r" placeholder="e.g. on leave, closer branch"></div>
    </div>`;
}

/* Wire the staff picker. Returns a getter for the chosen values. */
function bindAllotFields(body, cur) {
  let to = cur ? cur.assignee : null;
  const pend = typeof pendingByEmp === 'function' ? pendingByEmp() : new Map();
  const people = [...S.dir.values()].sort((a, b) => cleanName(a.name).localeCompare(cleanName(b.name)));
  const load = e => { const c = pend.get(e); return c ? `${c.n} pending${c.late ? ` · ${c.late} overdue` : ''}` : 'Nothing pending'; };
  const showPicked = () => {
    const p = to && S.dir.get(to);
    $('#al-picked', body).innerHTML = p ? `<div class="item" style="cursor:default"><div class="avatar">${esc(initials(p.name))}</div>
        <div class="grow"><div class="t">${esc(cleanName(p.name))}</div><div class="s">${esc(p.designation || '')} · ${esc(p.branch || '')} · ${load(p.emp_id)}</div></div>
        <button type="button" class="btn small ghost" id="al-chg">Change</button></div>` : '';
    $('#al-sbox', body).hidden = !!p; $('#al-list', body).hidden = true;
    $('#al-more', body).hidden = !(p || cur);
    $('#al-why', body).hidden = !(cur && to && to !== cur.assignee);
    const c = $('#al-chg', body); if (c) c.onclick = () => { to = null; showPicked(); $('#al-q', body).value = ''; $('#al-q', body).focus(); draw(); };
  };
  const draw = () => {
    const t = $('#al-q', body).value.trim().toLowerCase(), l = $('#al-list', body);
    const rows = people.filter(p => !t || (p.name + ' ' + (p.branch || '') + ' ' + p.emp_id).toLowerCase().includes(t)).slice(0, t ? 30 : 8);
    l.hidden = false;
    l.innerHTML = rows.map(p => `<button type="button" class="item" data-to="${p.emp_id}"><div class="avatar">${esc(initials(p.name))}</div>
        <div class="grow"><div class="t">${esc(cleanName(p.name))}</div><div class="s">${esc(p.branch || '')} · ${load(p.emp_id)}</div></div></button>`).join('')
      || '<div class="item" style="cursor:default"><span class="hint">No one by that name.</span></div>';
    $$('[data-to]', l).forEach(b => b.onclick = () => { to = +b.dataset.to; showPicked(); });
  };
  $('#al-q', body).oninput = draw;
  $('#al-q', body).onfocus = draw;
  showPicked();
  return () => ({ to, date: $('#al-d', body).value || null, camp: $('#al-c', body).value ? +$('#al-c', body).value : null,
    note: $('#al-n', body).value.trim(), reason: $('#al-r', body).value.trim() });
}

/* Allot a place (no open allotment), or Reallot / change date / note of an existing one */
async function openAllot(entity, asgId) {
  await loadBasics();
  const cur = asgId ? get('assignments', asgId) : null;
  const body = openSheet(cur ? 'Reallot or change' : 'Allot this place', `
    <p class="muted" style="margin-top:0"><b>${esc(entity.name)}</b></p>
    ${allotFieldsHTML(cur, false)}
    <p class="hint" id="al-err" style="color:var(--bad)"></p>
    <button class="btn block" id="al-save">${cur ? 'Save' : 'Allot'}</button>`);
  const val = bindAllotFields(body, cur);
  $('#al-save', body).onclick = async () => {
    const v = val();
    if (!v.to) { $('#al-err', body).textContent = 'Pick who should visit.'; return; }
    if (!v.date) { $('#al-err', body).textContent = 'Pick a visit date.'; return; }
    $('#al-save', body).disabled = true;
    try {
      const row = cur
        ? await rpc('admin_update_allotment', { p_assignment: cur.id, p_to: v.to, p_date: v.date, p_note: v.note, p_reason: v.reason })
        : await rpc('admin_allot', { p_entity: entity.id, p_to: v.to, p_date: v.date, p_campaign: v.camp, p_note: v.note });
      put('assignments', row);
      toast(cur ? (cur.assignee !== v.to ? `Reallotted to ${personName(v.to)}` : 'Saved') : `Allotted to ${personName(v.to)}`);
      openPlace(get('entities', entity.id) || entity);
    } catch (e) { $('#al-save', body).disabled = false; $('#al-err', body).textContent = errText(e); }
  };
}
