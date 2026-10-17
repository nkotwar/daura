/* Daura · shared data (settings, staff names) and the "waiting to send" outbox.
   A visit saved without signal stays on the phone (IndexedDB, photos included) and is sent when the network returns. */

async function loadBasics(force = false) {
  if (!force && S.settings && S.dir) return;
  const [settings, dir] = await Promise.all([q(sb.from('settings').select('key, value')), rpc('staff_directory')]);
  S.settings = Object.fromEntries(settings.map(r => [r.key, r.value]));
  S.dir = new Map(dir.map(p => [p.emp_id, p]));
}
const personName = emp => { const p = S.dir && S.dir.get(emp); return p ? cleanName(p.name) : (emp ? 'Emp ' + emp : '—'); };
const setting = (k, d = []) => (S.settings && S.settings[k]) || d;
const closureLabel = k => ({ account_opened: 'Account opened', rejected: 'Rejected', not_feasible: 'Not feasible' }[k] || '');

/* ───────── IndexedDB outbox ───────── */
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('daura', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('outbox', mode); const st = t.objectStore('outbox');
      const out = fn(st); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
    });
  },
  put(item) { return this.tx('readwrite', st => st.put(item)); },
  del(id) { return this.tx('readwrite', st => st.delete(id)); },
  all() { return this.tx('readonly', st => st.getAll()); }
};

const isNetErr = e => !navigator.onLine || /Failed to fetch|NetworkError|network|Load failed|timed? ?out|fetch/i.test((e && (e.message || e.error)) || '');

/* Send one visit (new or edited) with its people and photos. Safe to repeat: every step can be retried. */
async function pushVisit(item) {
  const v = item.visit;
  if (item.isNew && !item.inserted) {
    const { error } = await sb.from('visits').insert({ id: item.id, ...v, visitor: v.visitor || (S.who.me && S.who.me.emp_id) });
    if (error && error.code !== '23505') throw error;
    item.inserted = true;
  } else if (!item.isNew && !item.updated) {
    const { entity_id, assignment_id, visitor, ...rest } = v;
    const { data, error } = await sb.from('visits').update(rest).eq('id', item.id).select('id');
    if (error) throw error;
    if (!data || !data.length) throw { message: 'LOCKED', hint: 'This visit can no longer be edited. It may have been verified.' };
    item.updated = true;
  }
  if (!item.jointDone) {
    let r = await sb.from('visit_joint').delete().eq('visit_id', item.id); if (r.error) throw r.error;
    if (item.joint && item.joint.length) {
      r = await sb.from('visit_joint').insert(item.joint.map(e => ({ visit_id: item.id, emp_id: e }))); if (r.error) throw r.error;
    }
    item.jointDone = true;
  }
  for (const p of (item.removePhotos || [])) {
    if (p.done) continue;
    await sb.storage.from('photos').remove([p.path]);
    const r = await sb.from('visit_photos').delete().eq('id', p.id); if (r.error) throw r.error;
    p.done = true;
  }
  for (const p of (item.addPhotos || [])) {
    if (p.done) continue;
    const path = `${item.id}/${p.id}.jpg`;
    const up = await sb.storage.from('photos').upload(path, p.blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error && !/exists|Duplicate/i.test(up.error.message || '')) throw up.error;
    const r = await sb.from('visit_photos').upsert({ id: p.id, visit_id: item.id, path, bytes: p.blob.size, source: p.source,
      taken_at: p.taken_at || null, lat: p.lat ?? null, lng: p.lng ?? null }, { onConflict: 'id', ignoreDuplicates: true });
    if (r.error) throw r.error;
    p.done = true;
  }
}

/* Try now; without signal, keep it on the phone. Returns 'sent' or 'queued'. Other errors are thrown. */
async function submitVisit(item) {
  try {
    await pushVisit(item);
    await idb.del(item.id).catch(() => {});
    return 'sent';
  } catch (e) {
    if (isNetErr(e)) { item.error = null; item.savedAt = new Date().toISOString(); await idb.put(item); return 'queued'; }
    throw e;
  }
}

let flushing = false;
async function flushOutbox() {
  if (flushing || !sb || !S.who || S.who.state !== 'linked') return;
  flushing = true;
  let sent = 0;
  try {
    for (const item of await idb.all()) {
      try { await pushVisit(item); await idb.del(item.id); sent++; }
      catch (e) { if (isNetErr(e)) break; item.error = errText(e); await idb.put(item); }
    }
  } catch (e) { /* IndexedDB unavailable */ }
  flushing = false;
  if (sent) { toast(`${sent} saved visit${sent > 1 ? 's' : ''} sent`); if (S.tab === 'visits') viewVisits(); }
}
window.addEventListener('online', () => flushOutbox());
