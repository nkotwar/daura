/* Daura · navigation feel.
   1. Swipe left/right inside a tab to move between its sections (To do · My visits · Places …).
   2. Back button: closes an open panel → returns to the first section → returns to the first tab → asks before closing Daura. */

/* ───────── sections as one continuous strip ─────────
   All sections of a tab sit side by side. The strip follows your finger 1:1, the neighbour slides in,
   and on release it snaps with momentum. Neighbours are loaded ahead of time so they are ready to show. */
function mountPager(host, panes, activeId, onChange) {
  let i = Math.max(0, panes.findIndex(p => p.id === activeId));
  host.innerHTML = `<div class="seg seg-scroll pseg">${panes.map((p, k) => `<button data-pi="${k}" data-pid="${p.id}" class="${k === i ? 'on' : ''}">${p.label}<span class="segn" id="${p.badge || ''}"></span></button>`).join('')}</div>
    <div class="pager"><div class="track">${panes.map(p => `<section class="pane" data-pane="${p.id}"></section>`).join('')}</div></div>`;
  const pager = $('.pager', host), track = $('.track', host), els = $$('.pane', host), btns = $$('.pseg button', host);
  const loaded = new Set();
  const load = k => {
    if (k < 0 || k >= panes.length || loaded.has(k)) return;
    loaded.add(k); els[k].innerHTML = '<div class="spin"></div>';
    Promise.resolve().then(() => panes[k].draw(els[k])).catch(e => { els[k].innerHTML = `<div class="empty"><p>${esc(errText(e))}</p></div>`; loaded.delete(k); });
  };
  const headH = () => ($('#top').getBoundingClientRect().height || 56) + 8;
  // While moving, every pane is shown, and the others are shifted down so their tops line up with the visible area.
  const prepare = () => {
    const top = pager.getBoundingClientRect().top;               // where panes start, relative to the screen
    const shift = Math.max(0, headH() - top);                    // how far the current pane has scrolled under the header
    els.forEach((el, k) => { el.classList.remove('off'); el.style.transform = k === i ? '' : `translateY(${shift}px)`; });
    return shift;
  };
  const settle = (k, shift) => {
    // the new pane was shown shifted down; drop the shift and scroll by the same amount so nothing jumps
    const top = pager.getBoundingClientRect().top;
    els.forEach((el, n) => { el.style.transform = ''; el.classList.toggle('off', n !== k); });
    if (shift) window.scrollTo({ top: window.scrollY + top - headH(), behavior: 'instant' });
  };
  const place = (px, anim) => {
    track.style.transition = anim ? 'transform .32s cubic-bezier(.2,.85,.25,1)' : 'none';
    track.style.transform = `translate3d(calc(${-i * 100}% + ${px}px),0,0)`;
  };
  const goTo = (k, fromDrag) => {
    k = Math.max(0, Math.min(panes.length - 1, k));
    const shift = fromDrag != null ? fromDrag : prepare();
    const changed = k !== i; i = k;
    btns.forEach((b, n) => b.classList.toggle('on', n === k));
    btns[k].scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    load(k);
    place(0, true);
    clearTimeout(goTo._t);
    goTo._t = setTimeout(() => { settle(k, changed ? shift : 0); load(k - 1); load(k + 1); }, 340);
    if (changed) onChange(panes[k].id);
  };
  // first show
  els.forEach((el, n) => el.classList.toggle('off', n !== i));
  place(0, false); load(i); onChange(panes[i].id);
  setTimeout(() => { load(i - 1); load(i + 1); }, 600);
  btns.forEach((b, k) => b.onclick = () => goTo(k));

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
  const btns = $$('#main .seg button');
  if (btns.length && !btns[0].classList.contains('on')) { btns[0].click(); keep(); return; }
  // 3. back to the first tab
  const first = TABS.filter(t => t.show())[0].id;
  if (S.tab !== first) { show(first); keep(); return; }
  // 4. ask before closing
  keep();
  if (await confirmSheet('Close Daura?', 'Anything waiting to send stays saved on this phone.', 'Close')) {
    NAV.armed = false;
    try { window.close(); } catch (e) { /* not allowed here */ }
    history.back();                       // step off the app's extra history entry: the next back press leaves Daura
    setTimeout(() => toast('Press back once more to close'), 300);
  }
});
// Using the app again after cancelling the exit puts the back-button handling back in place.
document.addEventListener('click', () => { if (!NAV.armed && S.who && $('#tabs') && !$('#tabs').hidden) armBack(); }, true);

/* ───────── pull down at the top to refresh the current tab (keeps you where you are) ───────── */
(function pull() {
  let sy = 0, dy = 0, on = false, busy = false;
  const ptr = () => $('#ptr');
  document.addEventListener('touchstart', e => {
    on = !busy && e.touches.length === 1 && window.scrollY <= 0 && !$('#layer .scrim') && !!S.who && !$('#tabs').hidden && !!e.target.closest('#main, #top');
    sy = e.touches[0].clientY; dy = 0; S.ptrX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!on) return;
    dy = e.touches[0].clientY - sy;
    if (Math.abs(e.touches[0].clientX - S.ptrX) > Math.abs(dy)) { on = false; ptr().style.opacity = 0; return; }   // sideways: that's a swipe, not a pull
    if (dy <= 0 || window.scrollY > 0) { ptr().style.opacity = 0; return; }
    const d = Math.min(90, dy * 0.5);
    ptr().style.transition = 'none';
    ptr().style.opacity = Math.min(1, d / 50);
    ptr().style.transform = `translateY(${d - 30}px) rotate(${d * 4}deg)`;
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (!on) return; on = false;
    const p = ptr();
    if (dy * 0.5 < 60) { p.style.transition = 'all .2s'; p.style.opacity = 0; p.style.transform = 'translateY(-30px)'; return; }
    busy = true; p.classList.add('spin'); p.style.transition = 'all .2s'; p.style.transform = 'translateY(30px)';
    S.cache.dash = null; S.cache.entities = null; S.cache.people = null; S.settings = null; S.dir = null;
    try { await Promise.all([VIEWS[S.tab](), checkForUpdate(), flushOutbox()]); } catch (e) { /* the view shows its own error */ }
    p.classList.remove('spin'); p.style.opacity = 0; p.style.transform = 'translateY(-30px)'; busy = false;
  }, { passive: true });
})();
