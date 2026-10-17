/* Daura · navigation feel.
   1. Swipe left/right inside a tab to move between its sections (To do · My visits · Places …).
   2. Back button: closes an open panel → returns to the first section → returns to the first tab → asks before closing Daura. */

/* ───────── swipe between sections ───────── */
(function swipe() {
  let sx = 0, sy = 0, dx = 0, lock = null, el = null, active = false;
  const segBtns = () => $$('#main .seg button');
  const content = () => $('#vbody') || $('#adm');
  const blocked = t => t.closest('.chips, .tbl, .seg, input, textarea, select, .pgrid, .hbars, .scrim, .stack-bar');
  document.addEventListener('touchstart', e => {
    active = false;
    if (e.touches.length !== 1 || $('#layer .scrim') || !segBtns().length || blocked(e.target) || !e.target.closest('#main')) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; lock = null; el = content(); active = !!el;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!active) return;
    dx = e.touches[0].clientX - sx; const dy = e.touches[0].clientY - sy;
    if (!lock && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) lock = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
    if (lock !== 'x') return;
    const btns = segBtns(), i = btns.findIndex(b => b.classList.contains('on'));
    const edge = (dx > 0 && i === 0) || (dx < 0 && i === btns.length - 1);
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx * (edge ? 0.12 : 0.35)}px)`;   // gentle follow; barely moves at the ends
    el.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / 900));
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!active) return; active = false;
    const btns = segBtns(), i = btns.findIndex(b => b.classList.contains('on'));
    const go = lock === 'x' && Math.abs(dx) > 70 ? (dx < 0 ? i + 1 : i - 1) : -1;
    if (go >= 0 && go < btns.length) {
      el.style.transition = 'transform .14s ease-in, opacity .14s ease-in';
      el.style.transform = `translateX(${dx < 0 ? -48 : 48}px)`; el.style.opacity = '0';
      const dir = dx < 0 ? 1 : -1;
      setTimeout(() => { btns[go].click(); slideIn(dir); }, 120);
    } else if (el) {
      el.style.transition = 'transform .2s ease-out, opacity .2s ease-out'; el.style.transform = ''; el.style.opacity = '';
    }
  }, { passive: true });
})();

function slideIn(dir) {
  const el = $('#vbody') || $('#adm'); if (!el) return;
  el.style.transition = 'none'; el.style.transform = `translateX(${dir * 40}px)`; el.style.opacity = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease-out';
    el.style.transform = ''; el.style.opacity = '';
  }));
  const on = $('#main .seg button.on'); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
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
  if (btns.length && !btns[0].classList.contains('on')) { btns[0].click(); slideIn(-1); keep(); return; }
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
    sy = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!on) return;
    dy = e.touches[0].clientY - sy;
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
