/* TASC Connect · navigation feel.
   1. Swipe left/right inside a tab to move between its sections (To do · My visits · Places …).
   2. Back button: closes an open panel → returns to the first section → returns to the first tab → asks before closing TASC Connect. */

/* ───────── sections as one continuous strip ─────────
   All sections of a tab sit side by side. The strip follows your finger 1:1, the neighbour slides in,
   and on release it snaps with momentum. Neighbours are loaded ahead of time so they are ready to show. */
function mountPager(host, panes, activeId, onChange) {
  let i = Math.max(0, panes.findIndex(p => p.id === activeId));
  host.innerHTML = `<div class="seg seg-scroll pseg">${panes.map((p, k) => `<button data-pi="${k}" data-pid="${p.id}" class="${k === i ? 'on' : ''}">${p.label}<span class="segn" id="${p.badge || ''}"></span></button>`).join('')}</div>
    <div class="pager"><div class="track">${panes.map(p => `<section class="pane" data-pane="${p.id}"></section>`).join('')}</div></div>`;
  const pager = $('.pager', host), track = $('.track', host), els = $$('.pane', host), btns = $$('.pseg button', host), seg = $('.pseg', host);
  const loaded = new Map();
  const load = k => {
    if (k < 0 || k >= panes.length) return Promise.resolve();
    if (loaded.has(k)) return loaded.get(k);
    els[k].innerHTML = '<div class="spin"></div>';
    const p = Promise.resolve().then(() => panes[k].draw(els[k])).catch(e => { els[k].innerHTML = `<div class="empty"><p>${esc(errText(e))}</p></div>`; loaded.delete(k); });
    loaded.set(k, p);
    return p;
  };
  // Every section is laid out all the time; the strip is clipped to the height of the one on show,
  // so a swipe only moves things (no re-layout mid-gesture).
  const padB = () => parseFloat(getComputedStyle(pager).paddingBottom) || 0;
  const fit = () => { pager.style.height = (els[i].offsetHeight + padB()) + 'px'; };
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => fit()); els.forEach(el => ro.observe(el)); }
  const headH = () => ($('#top').getBoundingClientRect().height || 56) + 8;
  // If you have scrolled down, the neighbours are shifted down to line up with what is on screen.
  const prepare = () => {
    const shift = Math.max(0, headH() - pager.getBoundingClientRect().top);
    els.forEach((el, k) => { el.style.transform = k === i || !shift ? '' : `translate3d(0,${shift}px,0)`; });
    return shift;
  };
  const settle = (shift) => {
    const top = pager.getBoundingClientRect().top;
    els.forEach(el => { el.style.transform = ''; });
    fit();
    if (shift) window.scrollTo({ top: window.scrollY + top - headH(), behavior: 'instant' });
  };
  const place = (px, anim) => {
    track.style.transition = anim ? 'transform .3s cubic-bezier(.2,.85,.25,1)' : 'none';
    track.style.transform = `translate3d(calc(${-i * 100}% + ${px}px),0,0)`;
  };
  const centreTab = (k, smooth) => {   // scroll the section bar sideways only, never the page
    const b = btns[k]; if (!seg || seg.scrollWidth <= seg.clientWidth) return;
    seg.scrollTo({ left: b.offsetLeft - (seg.clientWidth - b.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
  };
  const goTo = (k, fromDrag) => {
    k = Math.max(0, Math.min(panes.length - 1, k));
    const shift = fromDrag != null ? fromDrag : prepare();
    const changed = k !== i; i = k;
    btns.forEach((b, n) => b.classList.toggle('on', n === k));
    load(k);
    requestAnimationFrame(() => place(0, true));
    clearTimeout(goTo._t);
    goTo._t = setTimeout(() => { settle(changed ? shift : 0); centreTab(k, true); load(k - 1); load(k + 1); }, 320);
    if (changed) onChange(panes[k].id);
  };
  // first show: this section, then its neighbours straight after, so they are ready before you swipe
  place(0, false); fit(); onChange(panes[i].id); centreTab(i, false);
  load(i).then(() => { fit(); return Promise.all([load(i - 1), load(i + 1)]); });
  btns.forEach((b, k) => b.onclick = () => goTo(k));
  // Redraw the sections already loaded, keeping what is on screen until the new content is ready.
  host._pager = {
    ids: panes.map(p => p.id).join(','),
    go: id => { const k = panes.findIndex(p => p.id === id); if (k >= 0 && k !== i) goTo(k); },
    refresh: () => Promise.all([...loaded.keys()].map(k => Promise.resolve().then(() => panes[k].draw(els[k])).catch(() => {}))).then(fit)
  };

  // finger tracking
  let sx = 0, sy = 0, st = 0, dx = 0, lock = null, shift = 0, raf = 0, on = false;
  const blocked = t => t.closest('.chips, .tbl, input, textarea, select, .pgrid, .scrim');
  pager.addEventListener('touchstart', e => {
    on = e.touches.length === 1 && !blocked(e.target);
    if (!on) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = performance.now(); dx = 0; lock = null;
  }, { passive: true });
  pager.addEventListener('touchmove', e => {
    if (!on) return;
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (!lock && (Math.abs(x) > 8 || Math.abs(y) > 8)) {
      lock = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
      if (lock === 'x') { shift = prepare(); load(i - 1); load(i + 1); }
    }
    if (lock !== 'x') return;
    const edge = (x > 0 && i === 0) || (x < 0 && i === panes.length - 1);
    dx = edge ? x / 3 : x;                                        // rubber band at the ends
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(dx, false); });
  }, { passive: true });
  const end = () => {
    if (!on) return; on = false;
    if (lock !== 'x') return;
    cancelAnimationFrame(raf); raf = 0;
    const w = pager.clientWidth, v = dx / Math.max(1, performance.now() - st);   // px per ms
    let k = i;
    if (dx < -w * 0.22 || (v < -0.35 && dx < -20)) k = i + 1;
    else if (dx > w * 0.22 || (v > 0.35 && dx > 20)) k = i - 1;
    goTo(k, shift);
  };
  pager.addEventListener('touchend', end, { passive: true });
  pager.addEventListener('touchcancel', end, { passive: true });
}

/* ───────── back button ───────── */
const NAV = { armed: false };
function armBack() {
  if (NAV.armed) return;
  NAV.armed = true;
  history.replaceState({ daura: 'base' }, '');
  history.pushState({ daura: 'app' }, '');
}
window.addEventListener('popstate', async () => {
  if (!NAV.armed) return;
  const keep = () => history.pushState({ daura: 'app' }, '');
  // 1. an open panel closes
  if ($('#layer .scrim')) { closeSheet(); keep(); return; }
  // not inside the app (sign-in screens): let the phone go back normally
  if (!S.who || !$('#tabs') || $('#tabs').hidden) { NAV.armed = false; history.back(); return; }
  // 2. back to the first section of this tab
  const btns = $$('.seg button', TV());
  if (btns.length && !btns[0].classList.contains('on')) { btns[0].click(); keep(); return; }
  // 3. back to the first tab
  const first = TABS.filter(t => t.show())[0].id;
  if (S.tab !== first) { show(first); keep(); return; }
  // 4. ask before closing
  keep();
  if (await confirmSheet('Close TASC Connect?', 'Anything waiting to send stays saved on this phone.', 'Close')) {
    NAV.armed = false;
    try { window.close(); } catch (e) { /* not allowed here */ }
    history.back();                       // step off the app's extra history entry: the next back press leaves TASC Connect
    setTimeout(() => toast('Press back once more to close'), 300);
  }
});
// Using the app again after cancelling the exit puts the back-button handling back in place.
document.addEventListener('click', () => { if (!NAV.armed && S.who && $('#tabs') && !$('#tabs').hidden) armBack(); }, true);

/* ───────── pull down at the top to sync (as in Hazri): the CBI emblem drops from the header,
   arms with a small buzz, spins while one quiet sync runs, then the screen updates in place. ───────── */
(function pull() {
  const el = $('#ptr');
  const MAX = 110, ARM = 64;
  let y0 = 0, x0 = 0, pulling = false, armed = false, busy = false, d = 0;
  const can = () => !busy && !!S.who && S.who.state === 'linked' && !$('#tabs').hidden && !$('#layer .scrim') && (window.scrollY || document.documentElement.scrollTop) <= 0;
  const place = (shown, spin) => {
    const top = $('#top').getBoundingClientRect().bottom;
    el.style.top = (top - 44) + 'px';
    el.style.transform = `translateY(${shown}px) rotate(${spin}deg) scale(${armed ? 1.08 : 1})`;
    el.style.opacity = Math.min(1, shown / 40);
  };
  const reset = () => { el.classList.remove('spin'); el.style.transition = 'transform .25s ease, opacity .25s ease'; place(0, 0); el.style.opacity = 0; setTimeout(() => { el.style.transition = ''; }, 260); };
  addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || !can() || !e.target.closest('#main, #top')) { pulling = false; return; }
    const t = e.touches[0]; y0 = t.clientY; x0 = t.clientX; pulling = true; armed = false; d = 0;
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (!pulling) return;
    const t = e.touches[0], dy = t.clientY - y0, dx = t.clientX - x0;
    if (d === 0 && (dy <= 0 || Math.abs(dx) > dy)) { pulling = false; return; }   // not a downward pull (a swipe, or a scroll)
    d = Math.max(0, dy);
    const shown = Math.min(MAX, d * .5);
    const was = armed; armed = shown >= ARM;
    if (armed && !was) { try { navigator.vibrate && navigator.vibrate(10); } catch (err) { /* no vibration */ } }
    place(shown, shown * 3);
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (!pulling) return; pulling = false;
    if (!armed) { reset(); return; }
    busy = true; armed = false;
    el.style.transition = 'transform .2s ease'; place(ARM, 0); el.classList.add('spin');
    const t0 = Date.now();
    S.cache.people = null;
    let r = null;
    try { [r] = await Promise.all([syncAndRefresh(), flushOutbox(), checkForUpdate()]); }
    catch (err) { toast(isNetErr(err) ? 'No internet. Showing what is saved on this phone.' : errText(err)); }
    if (!r || !r.changed) { if (VIEWS[S.tab]) VIEWS[S.tab](); }   // nothing new: still redraw (e.g. due dates roll over)
    await new Promise(r => setTimeout(r, Math.max(0, 650 - (Date.now() - t0))));
    busy = false; reset();
  }, { passive: true });
})();
