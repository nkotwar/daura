/* TASC Connect · the phone's own copy of the data.
   · One call, sync(since), brings only what changed since the last time (or everything, the first time).
   · The copy is saved on the phone (IndexedDB), so screens open instantly and work with weak signal.
   · It syncs when the app opens, when you come back after 2+ minutes, and on pull-to-refresh.
   · Your own changes go straight into the copy (the save returns the saved row); no reloads.
   Screens never query the database directly; they ask the helpers at the bottom of this file. */

const TABLES = ['branches', 'staff', 'campaigns', 'entities', 'assignments', 'visits', 'photos', 'joint', 'requests'];
const KEY = { branches: r => r.code, staff: r => r.emp_id, joint: r => r.visit_id + ':' + r.emp_id };
const keyOf = (t, r) => (KEY[t] ? KEY[t](r) : r.id);
const DEL_TABLE = { entities: 'entities', assignments: 'assignments', visits: 'visits', visit_photos: 'photos', visit_joint: 'joint', requests: 'requests' };
const SYNC_AGAIN_MS = 120000;     // coming back after 2+ minutes syncs again
const OVERLAP_MS = 120000;        // ask a little further back than the last sync; applying a row twice is harmless

const DB = { t: {}, settings: {}, holds: new Set(), since: null, who: null, at: 0, user: null, ver: 0, syncing: null };
function dbReset() { TABLES.forEach(t => { DB.t[t] = new Map(); }); DB.settings = {}; DB.holds = new Set(); DB.since = null; DB.who = null; DB.at = 0; DB.ver++; }
dbReset();
const all = t => [...DB.t[t].values()];
const get = (t, k) => DB.t[t].get(k);

/* ───────── saving the copy on the phone ───────── */
const kv = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('daura-store', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async del(k) { const db = await this.open(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); }
};
const snapKey = () => 'snap:' + (DB.user || '');
async function loadSnap(user) {
  dbReset(); DB.user = (user || '').toLowerCase();
  try {
    const s = await kv.get(snapKey());
    if (!s || s.v !== 1) return false;
    TABLES.forEach(t => (s.t[t] || []).forEach(r => DB.t[t].set(keyOf(t, r), r)));
    DB.settings = s.settings || {}; DB.holds = new Set(s.holds || []); DB.since = s.since; DB.who = s.who; DB.at = s.at || 0;
    DB.ver++; buildDir();
    return true;
  } catch (e) { return false; }
}
let saveT = 0;
function saveSnap() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const t = {}; TABLES.forEach(n => { t[n] = all(n); });
    kv.set(snapKey(), { v: 1, t, settings: DB.settings, holds: [...DB.holds], since: DB.since, who: DB.who, at: DB.at }).catch(() => {});
  }, 400);
}
async function forgetSnap() { try { await kv.del(snapKey()); } catch (e) { /* ignore */ } dbReset(); }

/* ───────── sync ───────── */
const roleSig = w => w && w.state === 'linked' ? [w.admin, w.viewer, w.me && w.me.emp_id, w.me && w.me.branch_code, w.me && w.me.is_branch_head].join('|') : String(w && w.state);
function applySync(res) {
  if (res.full) TABLES.forEach(t => DB.t[t].clear());
  TABLES.forEach(t => (res[t] || []).forEach(r => {
    const k = keyOf(t, r), old = DB.t[t].get(k);
    DB.t[t].set(k, t === 'visits' && old && !r.f && old.f ? { ...old, ...r } : r);   // a summary never wipes details you already had
  }));
  Object.assign(DB.settings, res.settings || {});
  if (res.holds) DB.holds = new Set(res.holds);
  (res.deleted || []).forEach(d => { const t = DEL_TABLE[d.t]; if (t) DB.t[t].delete(d.k); });
  DB.since = res.now; DB.at = Date.now(); DB.ver++;
  buildDir();
}
/* Sync now. Returns { changed, who }. Concurrent calls share one request. */
function syncNow(opts = {}) {
  if (DB.syncing) return DB.syncing;
  DB.syncing = (async () => {
    const prevSig = roleSig(DB.who), prevVer = DB.ver;
    const since = opts.full || !DB.since ? null : new Date(new Date(DB.since).getTime() - OVERLAP_MS).toISOString();
    let res = await rpc('sync', { p_since: since });
    if (since && res.who && roleSig(res.who) !== prevSig && prevSig !== 'undefined') res = await rpc('sync', { p_since: null });   // role or branch changed: start fresh
    DB.who = res.who;
    if (res.who && res.who.state === 'linked' || res.full !== undefined) applySync(res);
    saveSnap();
    return { changed: DB.ver !== prevVer, who: res.who };
  })().finally(() => { DB.syncing = null; });
  return DB.syncing;
}
/* After a sync, redraw what is on screen from the new copy (quietly), and follow any change in who you are. */
async function syncAndRefresh(opts) {
  const r = await syncNow(opts);
  if (r.who && S.who && (r.who.state !== S.who.state || roleSig(r.who) !== roleSig(S.who))) { S.who = r.who; route({ noSync: true }); return r; }
  if (r.who) S.who = r.who;
  if (r.changed && S.who && S.who.state === 'linked' && VIEWS[S.tab]) VIEWS[S.tab]();
  return r;
}
const syncedAgo = () => DB.at ? ago(new Date(DB.at)) : 'never';

/* ───────── your own changes go straight into the copy ───────── */
function put(t, r) { DB.t[t].set(keyOf(t, r), r); DB.ver++; saveSnap(); }
function drop(t, k) { DB.t[t].delete(k); DB.ver++; saveSnap(); }
function patch(t, k, fields) { const r = DB.t[t].get(k); if (r) { DB.t[t].set(k, { ...r, ...fields }); DB.ver++; saveSnap(); } }
/* the place's "closed" mark follows its latest visit */
function recomputeClosure(entityId) {
  const vs = visitsOf(entityId); const last = vs[vs.length - 1];
  patch('entities', entityId, { closure: last ? last.closure || null : null });
}
function dropVisit(id) {
  const v = get('visits', id); if (!v) return;
  all('photos').filter(p => p.visit_id === id).forEach(p => DB.t.photos.delete(p.id));
  all('joint').filter(j => j.visit_id === id).forEach(j => DB.t.joint.delete(keyOf('joint', j)));
  drop('visits', id); recomputeClosure(v.entity_id);
}

/* ───────── staff names and settings ───────── */
function buildDir() {
  const bn = new Map(all('branches').map(b => [b.code, b]));
  S.dir = new Map(all('staff').filter(p => p.active !== false).map(p => [p.emp_id, { ...p, branch: (bn.get(p.branch_code) || {}).name || '' }]));
  S.settings = DB.settings;
}
async function loadBasics() { if (!S.dir || !S.settings) buildDir(); }
const branchName = code => (get('branches', code) || {}).name || '';

/* ───────── questions screens ask ───────── */
const withEntity = r => r && ({ ...r, entity: get('entities', r.entity_id) || { id: r.entity_id, name: '(place removed)', type: '' } });
const visitsOf = entityId => all('visits').filter(v => v.entity_id === entityId).sort((a, b) => a.visit_no - b.visit_no);
const openAsg = () => all('assignments').filter(a => a.status === 'open');

/* My work: allotments, my visits, my pending requests, what is on hold, what a colleague already visited */
function qMyWork() {
  const me = S.who.me.emp_id;
  const asg = openAsg().filter(a => a.assignee === me).map(withEntity).sort((a, b) => (a.scheduled_on || '').localeCompare(b.scheduled_on || ''));
  const vis = all('visits').filter(v => v.visitor === me).map(withEntity).sort((a, b) => (b.visited_at || '').localeCompare(a.visited_at || ''));
  const req = all('requests').filter(r => r.raised_by === me && r.status === 'pending');
  const hold = new Map(req.filter(r => r.assignment_id).map(r => [r.assignment_id, r]));
  const mineDone = new Set(vis.filter(v => v.assignment_id).map(v => v.assignment_id));
  const cover = new Map();
  asg.forEach(a => {
    if (mineDone.has(a.id)) return;
    const o = visitsOf(a.entity_id).find(v => v.visitor !== me);
    if (o) cover.set(a.id, { assignment_id: a.id, visit_id: o.id, visitor_emp: o.visitor, visitor: personName(o.visitor), visited_at: o.visited_at, status: o.status });
  });
  return { asg, vis, req, hold, cover };
}
/* A place's visit history (summary for everyone; can_open when you are allowed the details) */
function qTimeline(entityId) {
  return visitsOf(entityId).map(v => ({ id: v.id, visit_no: v.visit_no, visited_at: v.visited_at, visitor_emp: v.visitor, visitor: personName(v.visitor),
    branch: branchName(v.visitor_branch), outcome: v.outcome, next_step: v.next_step, followup_on: v.followup_on, status: v.status, closure: v.closure, can_open: !!v.f }));
}
/* Who a place is allotted to, and who visited it */
function qAssignees(entityId) {
  const vs = visitsOf(entityId);
  return openAsg().filter(a => a.entity_id === entityId).sort((a, b) => (a.scheduled_on || '').localeCompare(b.scheduled_on || '')).map(a => {
    const fv = vs.find(v => v.assignment_id === a.id) || vs.find(v => v.visitor !== a.assignee);
    const p = S.dir.get(a.assignee) || {};
    return { assignment_id: a.id, emp_id: a.assignee, name: p.name || 'Emp ' + a.assignee, designation: p.designation, branch: p.branch, scheduled_on: a.scheduled_on,
      visited: !!fv, verified: !!fv && fv.status === 'verified', on_hold: DB.holds.has(a.id),
      visited_by_emp: fv ? fv.visitor : null, visited_by: fv ? personName(fv.visitor) : null, visited_at: fv ? fv.visited_at : null };
  });
}
/* One visit with its photos and joint visitors */
function qVisit(id) {
  const v = get('visits', id); if (!v) return null;
  return { v: withEntity(v), photos: all('photos').filter(p => p.visit_id === id).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
    joint: all('joint').filter(j => j.visit_id === id) };
}
const qMyPendingFor = visitId => all('requests').find(r => r.visit_id === visitId && r.status === 'pending' && S.who.me && r.raised_by === S.who.me.emp_id);
/* Branch head: visits by my branch's staff waiting for me */
function qBranchVerify() {
  const me = S.who.me;
  return all('visits').filter(v => v.visitor_branch === me.branch_code && v.status === 'submitted' && v.visitor !== me.emp_id)
    .map(withEntity).sort((a, b) => (a.visited_at || '').localeCompare(b.visited_at || ''));
}
/* Everything the dashboard needs */
function qDash() {
  return { at: DB.at, asg: openAsg().map(a => ({ ...a, entity: get('entities', a.entity_id) || { id: a.entity_id, name: '—', type: '' } })),
    vis: all('visits').map(withEntity), branches: all('branches'), camps: all('campaigns').sort((a, b) => a.id - b.id), hold: DB.holds };
}
/* Admin: requests with what they are about */
function qRequests() {
  const emb = r => ({ ...r, visit: r.visit_id && get('visits', r.visit_id) ? withEntity(get('visits', r.visit_id)) : null,
    assignment: r.assignment_id && get('assignments', r.assignment_id) ? withEntity(get('assignments', r.assignment_id)) : null });
  const rq = all('requests');
  return {
    pending: rq.filter(r => r.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at)).map(emb),
    done: rq.filter(r => r.status !== 'pending').sort((a, b) => (b.decided_at || '').localeCompare(a.decided_at || '')).slice(0, 20).map(emb)
  };
}
