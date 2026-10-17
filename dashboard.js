/* Daura · Dashboard (admin and viewers). Everything is worked out on the phone from the live data:
   completion, overdue ageing, delays, business, verification pending with each branch head, officers, photos.
   Plus WhatsApp nudges, Excel export and a shareable summary image. */

async function fetchAll(build) {
  const out = []; let from = 0;
  while (true) { const p = await q(build().range(from, from + 999)); out.push(...p); if (p.length < 1000) break; from += 1000; }
  return out;
}
const localDay = iso => iso ? new Date(iso).toLocaleDateString('en-CA') : null;   // YYYY-MM-DD in local time
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const inrShort = n => { n = +n || 0; if (n >= 1e7) return '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + ' Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + ' L'; return '₹' + Math.round(n).toLocaleString('en-IN'); };
const daoraLink = () => location.origin + location.pathname;
const waLink = (phone, text) => { const p = String(phone || '').replace(/\D/g, '').slice(-10); return p.length === 10 ? `https://wa.me/91${p}?text=${encodeURIComponent(text)}` : null; };
const telLink = phone => { const p = String(phone || '').replace(/\D/g, '').slice(-10); return p.length === 10 ? `tel:+91${p}` : null; };

async function loadDashData(force = false) {
  if (!force && S.cache.dash && Date.now() - S.cache.dash.at < 120000) return S.cache.dash;
  await loadBasics();
  const [asg, vis, branches, camps, req] = await Promise.all([
    fetchAll(() => sb.from('assignments').select('id, assignee, scheduled_on, status, campaign_id, entity:entities(id, name, type, area)').eq('status', 'open').order('id')),
    fetchAll(() => sb.from('visits').select('id, entity_id, assignment_id, visit_no, visitor, visitor_branch, visited_at, logged_at, status, outcome, closure, potential_rs, mobilised_rs, products, account_numbers, followup_on, banking_with, other_bank, person_name, person_designation, person_mobile, headcount, headcount_kind, next_step, remarks, verified_at, verified_by, entity:entities(id, name, type, area)').order('id')),
    q(sb.from('branches').select('code, name, is_ro')),
    q(sb.from('campaigns').select('id, name').order('id')),
    q(sb.from('requests').select('assignment_id, kind').eq('status', 'pending').not('assignment_id', 'is', null))
  ]);
  S.cache.dash = { at: Date.now(), asg, vis, branches, camps, hold: new Set(req.filter(r => r.kind === 'reassign' || r.kind === 'delete_assignment').map(r => r.assignment_id)) };
  return S.cache.dash;
}

/* Turn raw rows into everything the dashboard shows, for the chosen filters. */
function dashModel(D, f) {
  const today = todayISO();
  const tmr = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); })();
  const staff = e => S.dir.get(e) || {};
  const bname = new Map(D.branches.map(b => [b.code, b.name]));
  const ro = new Set(D.branches.filter(b => b.is_ro).map(b => b.code));
  const asgCamp = new Map(D.asg.map(a => [a.id, a.campaign_id]));
  const okA = a => (!f.camp || a.campaign_id === f.camp) && (!f.type || a.entity.type === f.type) && (!f.branch || staff(a.assignee).branch_code === f.branch);
  const okV = v => (!f.camp || (v.assignment_id && asgCamp.get(v.assignment_id) === f.camp)) && (!f.type || v.entity.type === f.type) && (!f.branch || v.visitor_branch === f.branch);

  const firstVisit = new Map();
  D.vis.forEach(v => { if (v.assignment_id) { const c = firstVisit.get(v.assignment_id); if (!c || v.visit_no < c.visit_no) firstVisit.set(v.assignment_id, v); } });

  const entVisits = new Map();
  D.vis.slice().sort((x, y) => x.visit_no - y.visit_no).forEach(v => { if (!entVisits.has(v.entity_id)) entVisits.set(v.entity_id, []); entVisits.get(v.entity_id).push(v); });
  const rows = D.asg.filter(okA).map(a => {
    const own = firstVisit.get(a.id);
    const ov = !own && (entVisits.get(a.entity.id) || []).find(x => x.visitor !== a.assignee);   // visited by a colleague
    const v = own || ov;
    const st = v ? (v.status === 'verified' ? 'verified' : 'submitted') : D.hold && D.hold.has(a.id) ? 'hold' : (a.scheduled_on && a.scheduled_on < today ? 'overdue' : 'notdue');
    return { a, v, by: ov ? ov.visitor : null, st, late: st === 'overdue' ? daysBetween(a.scheduled_on, today) : 0, delay: v && a.scheduled_on ? daysBetween(a.scheduled_on, localDay(v.visited_at)) : null };
  });
  const vis = D.vis.filter(okV);
  const n = { total: rows.length, verified: 0, submitted: 0, overdue: 0, notdue: 0, hold: 0 };
  rows.forEach(r => n[r.st]++);
  const visited = n.verified + n.submitted;

  const ageing = [['1–3 days', 1, 3], ['4–7 days', 4, 7], ['8–15 days', 8, 15], ['15+ days', 16, 1e9]].map(([l, lo, hi]) => ({ l, n: rows.filter(r => r.st === 'overdue' && r.late >= lo && r.late <= hi).length }));
  const delays = rows.filter(r => r.delay != null);
  const onTime = delays.filter(r => r.delay <= 0).length;
  const avgDelay = delays.length ? delays.reduce((s, r) => s + Math.max(0, r.delay), 0) / delays.length : 0;

  // latest visit per place → follow-ups due and closures
  const latest = new Map();
  vis.forEach(v => { const c = latest.get(v.entity_id); if (!c || v.visit_no > c.visit_no) latest.set(v.entity_id, v); });
  const followDue = [...latest.values()].filter(v => v.followup_on && v.followup_on <= today && !v.closure).sort((a, b) => a.followup_on.localeCompare(b.followup_on));
  const opened = vis.filter(v => v.closure === 'account_opened');
  const biz = {
    potential: [...latest.values()].reduce((s, v) => s + (+v.potential_rs || 0), 0),
    mobilised: opened.reduce((s, v) => s + (+v.mobilised_rs || 0), 0),
    accounts: opened.reduce((s, v) => s + (v.account_numbers || []).length, 0),
    opened: opened.length, rejected: vis.filter(v => v.closure === 'rejected').length, notFeasible: vis.filter(v => v.closure === 'not_feasible').length,
    places: latest.size
  };
  const countBy = (arr, key) => { const m = new Map(); arr.forEach(x => [].concat(key(x) || []).forEach(k => m.set(k, (m.get(k) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const outcomes = countBy(vis, v => v.outcome);
  const products = countBy(vis, v => v.products);
  const banking = countBy([...latest.values()], v => ({ us: 'Our bank', other: 'Other bank', none: 'None / not known' }[v.banking_with]));
  const otherBanks = countBy([...latest.values()].filter(v => v.banking_with === 'other' && v.other_bank), v => v.other_bank.split(/[,/&]+/).map(s => s.trim().toUpperCase()).filter(Boolean));

  // by branch (assignee's branch for allotments)
  const byBranch = new Map();
  const bb = code => { if (!byBranch.has(code)) byBranch.set(code, { code, name: bname.get(code) || '—', total: 0, visited: 0, verified: 0, overdue: 0, tmr: 0 }); return byBranch.get(code); };
  // every branch with staff appears, even with nothing allotted (unless one branch is filtered)
  new Set([...S.dir.values()].map(p => p.branch_code)).forEach(code => { if (code != null && (!f.branch || code === f.branch)) bb(code); });
  rows.forEach(r => { const b = bb(staff(r.a.assignee).branch_code); b.total++; if (r.v) b.visited++; if (r.st === 'verified') b.verified++; if (r.st === 'overdue') b.overdue++; if (!r.v && r.a.scheduled_on === tmr) b.tmr++; });
  // by officer
  const byOff = new Map();
  const oo = e => { if (!byOff.has(e)) byOff.set(e, { emp: e, name: cleanName(staff(e).name || 'Emp ' + e), branch: staff(e).branch || '', phone: staff(e).phone, total: 0, visited: 0, overdue: 0, own: 0, delaySum: 0, delayN: 0, pending: [] }); return byOff.get(e); };
  rows.forEach(r => { const o = oo(r.a.assignee); o.total++; if (r.v) o.visited++; if (r.st === 'overdue') { o.overdue++; o.pending.push(r); } if (r.delay != null) { o.delaySum += Math.max(0, r.delay); o.delayN++; } });
  vis.filter(v => !v.assignment_id).forEach(v => oo(v.visitor).own++);
  // by type
  const byType = countBy(rows, r => r.a.entity.type).map(([t]) => { const rr = rows.filter(r => r.a.entity.type === t); return { t, total: rr.length, visited: rr.filter(r => r.v).length, overdue: rr.filter(r => r.st === 'overdue').length }; });
  // verification pending, per verifier (branch head of the visitor's branch, or admin for BHs / RO staff)
  const verifiers = new Map();
  vis.filter(v => v.status === 'submitted').forEach(v => {
    const isAdmin = ro.has(v.visitor_branch) || staff(v.visitor).is_branch_head;
    const bh = isAdmin ? null : [...S.dir.values()].find(p => p.branch_code === v.visitor_branch && p.is_branch_head);
    const key = bh ? bh.emp_id : 'admin';
    if (!verifiers.has(key)) verifiers.set(key, { key, name: bh ? cleanName(bh.name) : 'You (admin)', branch: bh ? bh.branch : 'Branch heads & RO staff', phone: bh ? bh.phone : null, n: 0, oldest: null });
    const x = verifiers.get(key); x.n++; if (!x.oldest || v.logged_at < x.oldest) x.oldest = v.logged_at;
  });
  return { today, tmr, rows, vis, n, visited, ageing, delays, onTime, avgDelay, followDue, biz, outcomes, products, banking, otherBanks,
    byBranch: [...byBranch.values()].sort((a, b) => b.overdue - a.overdue || b.tmr - a.tmr || b.total - a.total || a.name.localeCompare(b.name)),
    byOff: [...byOff.values()].sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name)),
    byType, verifiers: [...verifiers.values()].sort((a, b) => b.n - a.n), bname };
}

/* ───────── view ───────── */
async function viewDashboard(force = false) {
  const main = TV();
  if (!S.who.viewer) { main.innerHTML = '<div class="empty">For admin and viewers.</div>'; return; }
  if (!main.children.length) main.innerHTML = '<div class="spin"></div>';
  let D;
  try { D = await loadDashData(force); } catch (e) { main.innerHTML = `<div class="empty"><p>${esc(errText(e))}</p><button class="btn" id="rt">Try again</button></div>`; $('#rt').onclick = () => viewDashboard(true); return; }
  const f = S.cache.dashF || (S.cache.dashF = { camp: null, type: null, branch: null });
  const M = dashModel(D, f);
  S.cache.dashM = M;
  const types = [...new Set(D.asg.map(a => a.entity.type).concat(D.vis.map(v => v.entity.type)))].sort();
  const branchOpts = D.branches.filter(b => [...S.dir.values()].some(p => p.branch_code === b.code)).sort((a, b) => a.name.localeCompare(b.name));
  const sel = (id, label, opts, val) => `<select class="input dsel" id="${id}" aria-label="${label}"><option value="">${label}: all</option>${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const N = M.n;

  main.innerHTML = `${S.updateReady ? updateBar() : ''}
    <div class="dfilters">
      ${D.camps.length > 1 ? sel('df-c', 'Campaign', D.camps.map(c => [c.id, c.name]), f.camp) : ''}
      ${sel('df-t', 'Type', types.map(t => [t, t]), f.type)}
      ${sel('df-b', 'Branch', branchOpts.map(b => [b.code, b.name]), f.branch)}
      <button class="btn small ghost" id="df-r" title="Reload the latest data">↻</button>
    </div>
    <div class="hint" style="margin:-4px 0 10px">Updated ${ago(new Date(D.at))}. Allotment figures follow the allotted officer's branch; business figures follow the visitor's branch.</div>

    <div class="stats s6">
      ${tile(N.total, 'Allotted')}
      ${tile(M.visited, `Visited · ${pct(M.visited, N.total)}%`, 'ok')}
      ${tile(N.overdue, 'Overdue', N.overdue ? 'bad' : '')}
      ${tile(N.verified, `Verified · ${pct(N.verified, M.visited)}%`)}
      ${tile(M.followDue.length, 'Follow-ups due', M.followDue.length ? 'warn' : '')}
      ${tile(M.biz.opened, 'Accounts opened', 'ok')}
    </div>

    <div class="card"><h3>Progress</h3>
      ${stackBar([['Verified', N.verified, 'ok'], ['Visited, not verified', N.submitted, 'acc'], ['Not due yet', N.notdue, 'mute'], ['On hold (request)', N.hold, 'warn'], ['Overdue', N.overdue, 'bad']], N.total)}
    </div>

    <div class="card"><h3>Overdue ageing</h3>
      ${N.overdue ? hbars(M.ageing.map(x => [x.l, x.n]), 'bad') : '<p class="hint">Nothing overdue.</p>'}
      <div class="row wrap" style="margin-top:10px;gap:14px">
        <span class="hint">On time or early: <b class="mono">${M.onTime}/${M.delays.length}</b></span>
        <span class="hint">Average delay: <b class="mono">${M.avgDelay.toFixed(1)} d</b></span>
      </div>
    </div>

    <div class="card"><h3>Business</h3>
      <div class="stats" style="margin-bottom:6px">${tile(inrShort(M.biz.potential), 'Potential')}${tile(inrShort(M.biz.mobilised), 'Mobilised', 'ok')}${tile(M.biz.accounts, 'Accounts')}</div>
      <p class="hint">Closures: ${M.biz.opened} opened · ${M.biz.rejected} rejected · ${M.biz.notFeasible} not feasible, across ${M.biz.places} places visited. Potential counts each place's latest visit once.</p>
      ${M.outcomes.length ? `<h4 class="dh">Outcomes</h4>${hbars(M.outcomes)}` : ''}
      ${M.products.length ? `<h4 class="dh">Products discussed</h4>${hbars(M.products.slice(0, 10))}` : ''}
      ${M.banking.length ? `<h4 class="dh">Banks with</h4>${hbars(M.banking)}${M.otherBanks.length ? `<p class="hint" style="margin-top:6px">Other banks named: ${M.otherBanks.slice(0, 8).map(([b, c]) => `${esc(b)} (${c})`).join(', ')}</p>` : ''}` : ''}
      ${!M.vis.length ? '<p class="hint">No visits logged yet.</p>' : ''}
    </div>

    <div class="card"><h3>Waiting for verification</h3>
      ${M.verifiers.length ? `<div class="list">${M.verifiers.map(x => {
        const wa = x.phone && waLink(x.phone, `Dear ${x.name}, ${x.n} visit${x.n > 1 ? 's' : ''} by your branch staff ${x.n > 1 ? 'are' : 'is'} waiting for your verification in Daura (Visits → Verify). Kindly check and verify: ${daoraLink()}`);
        return `<div class="item" style="cursor:default"><div class="grow"><div class="t">${esc(x.name)}</div><div class="s">${esc(x.branch || '')} · oldest ${ago(x.oldest)}</div></div>
          <span class="badge warn">${x.n}</span>${nudgeBtns(wa, x.phone && telLink(x.phone))}</div>`; }).join('')}</div>` : '<p class="hint">Nothing waiting.</p>'}
    </div>

    <div class="card"><h3>By branch</h3>
      <div class="tbl"><table><thead><tr><th>Branch</th><th>Allotted</th><th>Visited</th><th>Overdue</th><th>Due ${shortDay(M.tmr)}</th><th>Done</th></tr></thead><tbody>
      ${M.byBranch.map(b => `<tr data-br="${b.code}"><td>${esc(b.name)}</td><td class="mono">${b.total}</td><td class="mono">${b.visited}</td><td class="mono ${b.overdue ? 'bad' : ''}">${b.overdue}</td><td class="mono">${b.tmr || '·'}</td><td>${minibar(pct(b.visited, b.total))}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">No branches.</td></tr>'}
      </tbody></table></div>
      <p class="hint">Tap a branch to filter the whole dashboard to it.</p>
    </div>

    <div class="card"><h3>By type</h3>
      <div class="tbl"><table><thead><tr><th>Type</th><th>Allotted</th><th>Visited</th><th>Overdue</th><th>Done</th></tr></thead><tbody>
      ${M.byType.map(t => `<tr><td>${esc(t.t)}</td><td class="mono">${t.total}</td><td class="mono">${t.visited}</td><td class="mono ${t.overdue ? 'bad' : ''}">${t.overdue}</td><td>${minibar(pct(t.visited, t.total))}</td></tr>`).join('')}
      </tbody></table></div>
    </div>

    <div class="card"><h3>Officers</h3>
      <div class="chips" style="margin-top:0"><button class="chip ${S.cache.offF !== 'all' ? 'on' : ''}" data-of="over">With overdue<b>${M.byOff.filter(o => o.overdue).length}</b></button><button class="chip ${S.cache.offF === 'all' ? 'on' : ''}" data-of="all">All<b>${M.byOff.length}</b></button></div>
      <div class="list" id="offl">${offRows(M)}</div>
    </div>

    ${M.followDue.length ? `<div class="card"><h3>Follow-ups due</h3><div class="list">${M.followDue.slice(0, 30).map(v => `<button class="item" data-v="${v.id}"><div class="grow"><div class="t">${esc(v.entity.name)}</div>
      <div class="s">${esc(personName(v.visitor))} · ${esc(v.next_step || 'Follow-up')}</div></div><span class="badge ${v.followup_on < M.today ? 'bad' : 'warn'}">${fmtDate(v.followup_on)}</span></button>`).join('')}</div></div>` : ''}

    <div class="card"><h3>Latest photos</h3><div class="pgrid" id="gal"><div class="hint" style="grid-column:1/-1">Loading…</div></div>
      <button class="btn ghost block small" id="galmore" hidden style="margin-top:10px">Show more</button></div>

    <div class="card"><h3>Share &amp; export</h3>
      <div class="stack">
        <button class="btn block" id="dx-img">Summary image for WhatsApp</button>
        <button class="btn ghost block" id="dx-xls">Download Excel (all data)</button>
      </div>
      <p class="hint">The image and the Excel follow the filters above.</p>
    </div>`;

  // filters
  const setF = (k, v) => { f[k] = v || null; viewDashboard(); };
  if ($('#df-c')) $('#df-c').onchange = e => setF('camp', +e.target.value || null);
  $('#df-t').onchange = e => setF('type', e.target.value);
  $('#df-b').onchange = e => setF('branch', +e.target.value || null);
  $('#df-r').onclick = () => viewDashboard(true);
  $$('[data-br]').forEach(r => r.onclick = () => { f.branch = +r.dataset.br; viewDashboard(); window.scrollTo(0, 0); });
  $$('[data-of]').forEach(b => b.onclick = () => { S.cache.offF = b.dataset.of; viewDashboard(); });
  $$('#offl [data-off]').forEach(b => b.onclick = () => (S.who.admin ? openStaff(+b.dataset.off) : openOfficer(+b.dataset.off)));
  $$('[data-v]', main).forEach(b => b.onclick = () => openVisit(b.dataset.v));
  $('#dx-img').onclick = () => summaryImage(M, f, D);
  $('#dx-xls').onclick = () => exportExcel(M, D);
  loadGallery(f, M);
}

const shortDay = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const tile = (v, l, cls = '') => `<div class="stat ${cls}"><b>${typeof v === 'number' ? v.toLocaleString('en-IN') : v}</b><span>${l}</span></div>`;
const minibar = p => `<div class="mini" title="${p}% visited"><i style="width:${p}%"></i></div><span class="mono hint">${p}%</span>`;
function stackBar(parts, total) {
  if (!total) return '<p class="hint">No allotments for these filters.</p>';
  return `<div class="stack-bar" role="img" aria-label="${parts.map(([l, n]) => `${l} ${n}`).join(', ')}">${parts.filter(p => p[1]).map(([l, n, c]) =>
      `<i class="sb-${c}" style="flex:${n}" title="${l}: ${n} (${pct(n, total)}%)"></i>`).join('')}</div>
    <div class="legend">${parts.map(([l, n, c]) => `<span><i class="sb-${c}"></i>${l} <b class="mono">${n}</b></span>`).join('')}</div>`;
}
function hbars(pairs, cls = '') {
  const max = Math.max(1, ...pairs.map(p => p[1]));
  return `<div class="hbars">${pairs.map(([l, n]) => `<div class="hb" title="${esc(l)}: ${n}"><span class="hl">${esc(l)}</span><span class="ht"><i class="${cls}" style="width:${Math.max(2, n / max * 100)}%"></i></span><b class="mono">${n}</b></div>`).join('')}</div>`;
}
const nudgeBtns = (wa, tel) => `${wa ? `<a class="nb wa" href="${wa}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">${ICON.wa}</a>` : ''}${tel ? `<a class="nb" href="${tel}" title="Call" aria-label="Call">${ICON.phone}</a>` : ''}`;
function overdueMsg(o) {
  const list = o.pending.slice(0, 5).map(r => `• ${r.a.entity.name} (due ${fmtDate(r.a.scheduled_on)})`).join('\n');
  return `Dear ${o.name}, ${o.overdue} visit${o.overdue > 1 ? 's' : ''} allotted to you ${o.overdue > 1 ? 'are' : 'is'} pending in Daura:\n${list}${o.overdue > 5 ? `\n…and ${o.overdue - 5} more` : ''}\nKindly complete and update: ${daoraLink()}\n– Regional Office, Udaipur`;
}
function offRows(M) {
  const list = S.cache.offF === 'all' ? M.byOff : M.byOff.filter(o => o.overdue);
  if (!list.length) return '<div class="empty">No officer has an overdue visit. 🎉</div>';
  return list.map(o => `<div class="item"><button class="grow" data-off="${o.emp}" style="all:unset;cursor:pointer;flex:1;min-width:0">
      <div class="t">${esc(o.name)}</div><div class="s">${esc(o.branch)} · ${o.visited}/${o.total} visited${o.own ? ` · +${o.own} own` : ''}${o.delayN ? ` · avg delay ${(o.delaySum / o.delayN).toFixed(1)} d` : ''}</div></button>
    ${o.overdue ? `<span class="badge bad">${o.overdue} overdue</span>` : `<span class="badge ok">${pct(o.visited, o.total)}%</span>`}
    ${o.overdue ? nudgeBtns(waLink(o.phone, overdueMsg(o)), telLink(o.phone)) : nudgeBtns(null, telLink(o.phone))}</div>`).join('');
}

function openOfficer(emp) {
  const M = S.cache.dashM; const o = M.byOff.find(x => x.emp === emp); if (!o) return;
  const rows = M.rows.filter(r => r.a.assignee === emp).sort((a, b) => (a.a.scheduled_on || '').localeCompare(b.a.scheduled_on || ''));
  const own = M.vis.filter(v => v.visitor === emp && !v.assignment_id);
  const lbl = { verified: ['Verified', 'ok'], submitted: ['Visited', 'acc'], overdue: ['Overdue', 'bad'], notdue: ['Not due', ''], hold: ['🔒 On hold', 'warn'] };
  const body = openSheet(o.name, `
    <div class="row wrap" style="margin-bottom:10px"><span class="badge">${esc(o.branch)}</span><span class="badge ok">${o.visited}/${o.total} visited</span>${o.overdue ? `<span class="badge bad">${o.overdue} overdue</span>` : ''}</div>
    <div class="row">${o.overdue && waLink(o.phone, overdueMsg(o)) ? `<a class="btn soft grow" target="_blank" rel="noopener" href="${waLink(o.phone, overdueMsg(o))}">${ICON.wa} Nudge on WhatsApp</a>` : ''}
      ${telLink(o.phone) ? `<a class="btn ghost grow" href="${telLink(o.phone)}">${ICON.phone} Call</a>` : ''}</div>
    <h2>Allotted</h2><div class="list">${rows.map(r => `<button class="item" ${r.v ? `data-v="${r.v.id}"` : `data-e="${r.a.entity.id}"`}><div class="grow"><div class="t">${esc(r.a.entity.name)}</div>
      <div class="s">Due ${fmtDate(r.a.scheduled_on)}${r.v ? ' · visited ' + fmtDate(r.v.visited_at) + (r.by ? ' by ' + esc(personName(r.by)) : '') + (r.delay > 0 ? ` (${r.delay} d late)` : '') : r.late ? ` · ${r.late} d late` : ''}</div></div>
      <span class="badge ${lbl[r.st][1]}">${lbl[r.st][0]}</span></button>`).join('') || '<div class="empty">None.</div>'}</div>
    ${own.length ? `<h2>Own visits</h2><div class="list">${own.map(v => `<button class="item" data-v="${v.id}"><div class="grow"><div class="t">${esc(v.entity.name)} · V${v.visit_no}</div><div class="s">${fmtDateTime(v.visited_at)} · ${esc(v.outcome || closureLabel(v.closure) || '')}</div></div></button>`).join('')}</div>` : ''}`);
  $$('[data-v]', body).forEach(b => b.onclick = () => openVisit(b.dataset.v));
  $$('[data-e]', body).forEach(b => b.onclick = () => { const r = rows.find(x => x.a.entity.id === b.dataset.e); openPlace({ ...r.a.entity }, null); });
}

/* ───────── photo gallery ───────── */
async function loadGallery(f, M, limit = 12) {
  const el = $('#gal'); if (!el) return;
  try {
    const ids = new Set(M.vis.map(v => v.id));
    const filtered = f.camp || f.type || f.branch;
    let rows = await q(sb.from('visit_photos').select('id, path, visit_id, source, created_at').order('created_at', { ascending: false }).limit(filtered ? 300 : limit + 1));
    if (filtered) rows = rows.filter(p => ids.has(p.visit_id));
    const more = rows.length > limit; rows = rows.slice(0, limit);
    if (!rows.length) { el.innerHTML = '<div class="hint" style="grid-column:1/-1">No photos yet.</div>'; return; }
    const urls = await signedUrls(rows.map(p => p.path));
    const vmap = new Map(M.vis.map(v => [v.id, v]));
    el.innerHTML = rows.map(p => { const v = vmap.get(p.visit_id); return `<button class="pthumb" data-v="${p.visit_id}" title="${v ? esc(v.entity.name + ' · ' + personName(v.visitor)) : ''}" style="border:0;padding:0;cursor:pointer">
      <img src="${urls[p.path] || ''}" alt="" loading="lazy"><span class="ptag">${v ? esc(v.entity.name.slice(0, 18)) : ''}</span></button>`; }).join('');
    $$('[data-v]', el).forEach(b => b.onclick = () => openVisit(b.dataset.v));
    const m = $('#galmore'); m.hidden = !more; m.onclick = () => loadGallery(f, M, limit + 24);
  } catch (e) { el.innerHTML = `<div class="hint" style="grid-column:1/-1">${esc(errText(e))}</div>`; }
}

/* ───────── summary image (1080 wide, as tall as needed: every branch, plus a totals row) ───────── */
async function summaryImage(M, f, D) {
  const W = 1080, ROW = 46;
  const br = M.byBranch;
  const H = 640 + 70 + (br.length + 1) * ROW + 120;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  try { await document.fonts.load('600 30px "IBM Plex Sans"'); await document.fonts.load('600 30px "IBM Plex Mono"'); } catch (e) { /* fallback fonts */ }
  const sans = (w, s) => `${w} ${s}px "IBM Plex Sans", system-ui, sans-serif`, mono = (w, s) => `${w} ${s}px "IBM Plex Mono", monospace`;
  const P = { bg: '#F3F5F8', card: '#FFFFFF', ink: '#142033', muted: '#5B6B80', faint: '#8A97A8', line: '#DCE2EA', zebra: '#F7F9FB', acc: '#146CC0', ok: '#12805C', bad: '#C2412D', warn: '#A86A0F', red: '#D20838', mute: '#B7C2D0' };
  const txt = (t, X, Y, o = {}) => { x.font = o.f || sans(400, 26); x.fillStyle = o.c || P.ink; x.textAlign = o.a || 'left'; x.textBaseline = 'alphabetic'; x.fillText(t, X, Y); };
  const rr = (X, Y, w, h, r, fill) => { x.beginPath(); x.roundRect(X, Y, w, h, r); x.fillStyle = fill; x.fill(); };
  x.fillStyle = P.bg; x.fillRect(0, 0, W, H);
  // header
  const logo = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'icon-192.png'; });
  if (logo) x.drawImage(logo, 60, 50, 76, 76);
  txt('Daura · Visit report', 156, 92, { f: sans(700, 42) });
  const scope = [f.camp && (D.camps.find(cc => cc.id === f.camp) || {}).name, f.type, f.branch && M.bname.get(f.branch)].filter(Boolean).join(' · ') || 'All visits';
  txt(`Udaipur RO · ${scope}`, 156, 128, { f: sans(400, 26), c: P.muted });
  txt(new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }), W - 60, 92, { f: sans(500, 24), c: P.muted, a: 'right' });
  x.fillStyle = P.red; x.fillRect(60, 156, W - 120, 4);
  // tiles
  const N = M.n, dueT = br.reduce((s, b) => s + b.tmr, 0);
  const tiles = [[N.total, 'Allotted', P.ink], [`${M.visited} (${pct(M.visited, N.total)}%)`, 'Visited', P.ok], [N.overdue, 'Overdue', N.overdue ? P.bad : P.ink],
    [dueT, `Due ${shortDay(M.tmr)}`, dueT ? P.warn : P.ink], [M.biz.opened, 'Accounts opened', P.ok], [inrShort(M.biz.mobilised), 'Mobilised', P.ok]];
  tiles.forEach(([v, l, col], i) => {
    const cx = 60 + (i % 3) * 330, cy = 190 + Math.floor(i / 3) * 150;
    rr(cx, cy, 310, 130, 18, P.card);
    txt(String(v), cx + 24, cy + 66, { f: mono(600, 44), c: col });
    txt(l, cx + 24, cy + 106, { f: sans(500, 24), c: P.muted });
  });
  // progress bar
  let y = 510; const bw = W - 120;
  rr(60, y, bw, 26, 13, P.line);
  let bx = 60; [[N.verified, P.ok], [N.submitted, P.acc], [N.notdue, P.mute], [N.hold, P.warn], [N.overdue, P.bad]].forEach(([n, col]) => {
    if (!n || !N.total) return; const w = n / N.total * bw; x.fillStyle = col; x.fillRect(bx, y, w, 26); bx += w; });
  y += 62;
  [['Verified', N.verified, P.ok], ['Visited', N.submitted, P.acc], ['Not due', N.notdue, P.mute], ['On hold', N.hold, P.warn], ['Overdue', N.overdue, P.bad]].forEach(([l, n, col], i) => {
    const lx = 60 + i * 200; x.fillStyle = col; x.fillRect(lx, y - 18, 18, 18); txt(`${l} ${n}`, lx + 28, y, { f: sans(500, 24) }); });
  // branch table: every branch
  const cols = [['Allotted', 580], ['Visited', 710], ['Overdue', 850], [`Due ${shortDay(M.tmr)}`, 1020]];
  y = 640 + 40;
  txt('Branch', 60, y, { f: sans(700, 24) });
  cols.forEach(([h, X]) => txt(h, X, y, { f: sans(700, 24), a: 'right' }));
  y += 16; x.fillStyle = P.ink; x.fillRect(60, y, W - 120, 2);
  const cell = (b, Y, bold) => {
    const w = bold ? 700 : 500, R = { a: 'right' };
    txt(b.name.length > 28 ? b.name.slice(0, 27) + '…' : b.name, 72, Y, { f: sans(w, 25) });
    txt(String(b.total), 580, Y, { ...R, f: mono(w, 25) });
    txt(String(b.visited), 710, Y, { ...R, f: mono(w, 25), c: b.visited ? P.ok : P.faint });
    txt(String(b.overdue), 850, Y, { ...R, f: mono(bold ? 700 : 600, 25), c: b.overdue ? P.bad : P.faint });
    txt(b.tmr ? String(b.tmr) : '–', 1020, Y, { ...R, f: mono(w, 25), c: b.tmr ? P.warn : P.faint });
  };
  const rt = cell;
  br.forEach((b, i) => {
    const top = y + i * ROW;
    if (i % 2 === 0) { x.fillStyle = P.zebra; x.fillRect(60, top + 2, W - 120, ROW); }
    rt(b, top + ROW - 14, false);
  });
  y += br.length * ROW;
  x.fillStyle = P.ink; x.fillRect(60, y + 2, W - 120, 2);
  const tot = br.reduce((t, b) => ({ name: 'Total', total: t.total + b.total, visited: t.visited + b.visited, overdue: t.overdue + b.overdue, tmr: t.tmr + b.tmr }), { total: 0, visited: 0, overdue: 0, tmr: 0 });
  rt(tot, y + ROW - 10, true);
  // footer
  txt('Daura · Built by Nitin Kotwar (139535), via PDUDAIRO', W / 2, H - 44, { f: sans(500, 22), c: P.faint, a: 'center' });
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const name = `Daura-summary-${todayISO()}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Daura visit report' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Summary image downloaded');
}

/* ───────── Excel export (SheetJS, loaded only when needed) ───────── */
function loadScript(src) {
  return new Promise((res, rej) => { if ([...document.scripts].some(s => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel tool. Check your internet.')); document.head.appendChild(s); });
}
async function exportExcel(M, D) {
  toast('Preparing Excel…', 2000);
  try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); } catch (e) { toast(e.message); return; }
  const st = { verified: 'Verified', submitted: 'Visited (not verified)', overdue: 'Overdue', notdue: 'Not due yet', hold: 'On hold (request pending)' };
  const d = s => s ? new Date(s.length === 10 ? s + 'T00:00:00' : s) : null;
  const visits = M.vis.slice().sort((a, b) => a.visited_at.localeCompare(b.visited_at)).map(v => ({
    'Place': v.entity.name, 'Type': v.entity.type, 'Area': v.entity.area || '', 'Visit no': v.visit_no,
    'Visited by': personName(v.visitor), 'Emp ID': v.visitor, 'Branch': M.bname.get(v.visitor_branch) || '',
    'Visited at': d(v.visited_at), 'Logged at': d(v.logged_at), 'Allotted': v.assignment_id ? 'Yes' : 'No',
    'Person met': v.person_name || '', 'Designation': v.person_designation || '', 'Mobile': v.person_mobile || '',
    'Banks with': { us: 'Our bank', other: 'Other bank', none: 'None / not known' }[v.banking_with] || '', 'Other bank': v.other_bank || '',
    'Headcount': v.headcount ?? '', 'Headcount of': v.headcount_kind || '', 'Potential (₹)': v.potential_rs != null ? +v.potential_rs : '',
    'Products': (v.products || []).join(', '), 'Outcome': v.outcome || '', 'Remarks': v.remarks || '', 'Next step': v.next_step || '',
    'Follow-up on': d(v.followup_on), 'Closure': closureLabel(v.closure), 'Accounts': (v.account_numbers || []).join(', '),
    'Mobilised (₹)': v.mobilised_rs != null ? +v.mobilised_rs : '', 'Status': v.status === 'verified' ? 'Verified' : 'Submitted',
    'Verified at': d(v.verified_at), 'Verified by': v.verified_at ? (v.verified_by ? personName(v.verified_by) : 'Admin') : ''
  }));
  const allot = M.rows.slice().sort((a, b) => (a.a.scheduled_on || '').localeCompare(b.a.scheduled_on || '')).map(r => ({
    'Place': r.a.entity.name, 'Type': r.a.entity.type, 'Area': r.a.entity.area || '', 'Officer': personName(r.a.assignee), 'Emp ID': r.a.assignee,
    'Officer branch': (S.dir.get(r.a.assignee) || {}).branch || '', 'Scheduled': d(r.a.scheduled_on), 'Status': st[r.st],
    'Visited on': r.v ? d(r.v.visited_at) : null, 'Visited by': r.v ? personName(r.v.visitor) : '', 'Delay (days)': r.delay != null ? r.delay : (r.st === 'overdue' ? r.late : ''),
    'Outcome': r.v ? (r.v.outcome || '') : '', 'Closure': r.v ? closureLabel(r.v.closure) : ''
  }));
  const offs = M.byOff.map(o => ({ 'Officer': o.name, 'Emp ID': o.emp, 'Branch': o.branch, 'Allotted': o.total, 'Visited': o.visited, 'Overdue': o.overdue,
    'Own visits': o.own, 'Avg delay (days)': o.delayN ? +(o.delaySum / o.delayN).toFixed(1) : '', 'Done %': pct(o.visited, o.total) }));
  const brs = M.byBranch.map(b => ({ 'Branch': b.name, 'Allotted': b.total, 'Visited': b.visited, 'Verified': b.verified, 'Overdue': b.overdue, [`Due ${shortDay(M.tmr)}`]: b.tmr, 'Done %': pct(b.visited, b.total) }));
  const wb = XLSX.utils.book_new();
  const add = (rows, name, widths) => { const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'No data' }], { cellDates: true, dateNF: 'dd-mmm-yyyy hh:mm' });
    ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add(allot, 'Allotments', [40, 20, 16, 26, 9, 18, 14, 20, 14, 11, 18, 14]);
  add(visits, 'Visits', [40, 20, 16, 8, 26, 9, 18, 18, 18, 9, 22, 18, 12, 14, 16, 10, 12, 13, 40, 18, 40, 30, 13, 15, 22, 14, 11, 18, 22]);
  add(offs, 'Officers', [28, 9, 20, 9, 9, 9, 10, 14, 8]);
  add(brs, 'Branches', [26, 9, 9, 9, 9, 11, 8]);
  XLSX.writeFile(wb, `Daura-${todayISO()}.xlsx`);
  toast('Excel downloaded');
}
