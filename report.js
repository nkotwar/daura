/* TASC Connect · presentable PDF reports for the admin and viewers (Dashboard → Share & export → Make a report).
   Two presets on one engine:
     · Executive report: one-page summary, branch and institution-type tables, officers, success stories, photo gallery,
       pending annexure and a note on the data.
     · Visit dossier: every visit with its details and photos, grouped by branch, type or officer (proof of visits).
   Real PDF text (searchable, small), IBM Plex Sans embedded so ₹ prints. Numbers come from dashModel, so they match the Dashboard. */

const RP = {
  ink: [20, 32, 51], muted: [91, 107, 128], faint: [138, 151, 168], line: [220, 226, 234], zebra: [247, 249, 251], tint: [243, 245, 248],
  acc: [20, 108, 192], ok: [18, 128, 92], bad: [194, 65, 45], warn: [168, 106, 15], mute: [180, 190, 204], red: [200, 16, 46], white: [255, 255, 255]
};
const RP_W = 210, RP_H = 297, RP_M = 14, RP_CW = RP_W - RP_M * 2;   // A4 portrait, mm

/* ───────── small helpers ───────── */
const rpRs = n => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
const rpMask = m => { m = String(m || '').replace(/\D/g, ''); return m.length >= 6 ? m.slice(0, 2) + 'x'.repeat(m.length - 4) + m.slice(-2) : (m ? 'xxxx' : ''); };
const rpAcct = a => { a = String(a || '').trim(); return a.length > 4 ? 'XXXX' + a.slice(-4) : a; };
const rpDay = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const rpWhen = d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const rpB64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };

async function rpFonts(doc) {
  const get = async f => rpB64(await (await fetch('fonts/' + f, { cache: 'force-cache' })).arrayBuffer());
  const [r, b] = await Promise.all([get('plex-Regular.ttf'), get('plex-SemiBold.ttf')]);
  doc.addFileToVFS('plex-r.ttf', r); doc.addFont('plex-r.ttf', 'Plex', 'normal');
  doc.addFileToVFS('plex-b.ttf', b); doc.addFont('plex-b.ttf', 'Plex', 'bold');
}

/* A photo, cropped to fill w×h (mm), as a JPEG data URL. px = pixels on the long side. */
async function rpImg(url, w, h, px) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const k = px / Math.max(w, h), cw = Math.round(w * k), ch = Math.round(h * k);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const s = Math.max(cw / bmp.width, ch / bmp.height), dw = bmp.width * s, dh = bmp.height * s;
  c.getContext('2d').drawImage(bmp, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  if (bmp.close) bmp.close();
  return c.toDataURL('image/jpeg', 0.78);
}
async function rpStatic(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); res(c.toDataURL('image/png')); }; i.onerror = () => res(null); i.src = src; });
}

/* ───────── what goes into a report ───────── */
function rpData(M, D, o) {
  const inRange = v => (!o.from || localDay(v.visited_at) >= o.from) && (!o.to || localDay(v.visited_at) <= o.to);
  const vis = M.vis.filter(v => inRange(v) && v.status !== 'returned' && (!o.verifiedOnly || v.status === 'verified'));
  const staff = e => S.dir.get(e) || {};
  // business by branch and by type
  const brBiz = new Map(), tyBiz = new Map();
  const add = (m, k, v) => { const c = m.get(k) || { opened: 0, mobilised: 0, interested: 0, potential: 0 }; if (v.closure === 'account_opened') { c.opened++; c.mobilised += +v.mobilised_rs || 0; }
    if (v.outcome === 'Interested' || v.outcome === 'Follow-up needed' || v.closure === 'account_opened') c.interested++; c.potential += +v.potential_rs || 0; m.set(k, c); };
  M.vis.forEach(v => { add(brBiz, v.visitor_branch, v); add(tyBiz, v.entity.type, v); });
  const branches = M.byBranch.filter(b => b.total || (brBiz.get(b.code) || {}).opened).map(b => ({ ...b, ...(brBiz.get(b.code) || { opened: 0, mobilised: 0 }) }));
  const types = M.byType.map(t => ({ ...t, ...(tyBiz.get(t.t) || { opened: 0, mobilised: 0, interested: 0, potential: 0 }) }));
  // officers
  const offBiz = new Map(); M.vis.forEach(v => { const c = offBiz.get(v.visitor) || { opened: 0, mobilised: 0 }; if (v.closure === 'account_opened') { c.opened++; c.mobilised += +v.mobilised_rs || 0; } offBiz.set(v.visitor, c); });
  const offs = M.byOff.map(x => ({ ...x, ...(offBiz.get(x.emp) || { opened: 0, mobilised: 0 }) }));
  const leaders = offs.filter(x => x.visited).sort((a, b) => b.visited - a.visited || b.mobilised - a.mobilised || pct(b.visited, b.total) - pct(a.visited, a.total)).slice(0, 10);
  const laggards = offs.filter(x => x.overdue).sort((a, b) => b.overdue - a.overdue || Math.max(...b.pending.map(r => r.late)) - Math.max(...a.pending.map(r => r.late))).slice(0, 10);
  // positive outcomes
  const positive = M.vis.filter(v => v.outcome === 'Interested' || v.outcome === 'Follow-up needed' || v.closure === 'account_opened');
  const posPlaces = new Set(positive.map(v => v.entity_id)).size;
  // success stories: accounts opened (largest mobilised first), then the biggest potential
  const photosOf = id => all('photos').filter(p => p.visit_id === id).sort((a, b) => (a.source === 'capture' ? 0 : 1) - (b.source === 'capture' ? 0 : 1) || (a.created_at || '').localeCompare(b.created_at || ''));
  const stories = vis.filter(v => v.closure === 'account_opened').sort((a, b) => (+b.mobilised_rs || 0) - (+a.mobilised_rs || 0))
    .concat(vis.filter(v => !v.closure && v.outcome === 'Interested').sort((a, b) => (+b.potential_rs || 0) - (+a.potential_rs || 0))).slice(0, 6);
  // gallery: newest live photos, one per visit
  const seen = new Set(), gallery = [];
  vis.slice().sort((a, b) => (b.visited_at || '').localeCompare(a.visited_at || '')).forEach(v => { if (gallery.length >= 12 || seen.has(v.entity_id)) return; const p = photosOf(v.id)[0]; if (p) { seen.add(v.entity_id); gallery.push({ v, p }); } });
  // exceptions
  const overdue = M.rows.filter(r => r.st === 'overdue').sort((a, b) => b.late - a.late);
  const lateLogged = vis.filter(v => v.logged_at && v.visited_at && (new Date(v.logged_at) - new Date(v.visited_at)) > 864e5);
  const noGeo = vis.filter(v => v.lat == null && !photosOf(v.id).some(p => p.lat != null));
  return { vis, branches, types, leaders, laggards, positive, posPlaces, stories, gallery, overdue, lateLogged, noGeo, photosOf, staff };
}

/* ───────── the engine ───────── */
async function makeReport(M, D, f, o, progress = () => {}) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  progress('Preparing…');
  await rpFonts(doc);
  const emblem = await rpStatic('cbi-emblem.png'), logo = await rpStatic('icon-192.png');
  const R = rpData(M, D, o);
  const N = M.n, today = M.today;
  const camp = f.camp ? (D.camps.find(c => c.id === f.camp) || {}).name : (D.camps.length === 1 ? D.camps[0].name : 'All campaigns');
  const scope = [camp, f.type || 'All institution types', f.branch ? M.bname.get(f.branch) : 'All branches'].join(' · ')
    + (o.from || o.to ? ` · Visits ${o.from ? rpDay(o.from) : 'start'} to ${o.to ? rpDay(o.to) : 'today'}` : '');
  const asOf = rpWhen(new Date().toISOString());
  const title = o.preset === 'dossier' ? 'Visit dossier' : 'Status report';

  /* drawing primitives */
  let y = RP_M;
  const font = (w = 'normal', s = 9, c = RP.ink) => { doc.setFont('Plex', w); doc.setFontSize(s); doc.setTextColor(...c); };
  const text = (t, x, yy, opt = {}) => { font(opt.w, opt.s, opt.c); doc.text(String(t), x, yy, { align: opt.a || 'left', maxWidth: opt.max, baseline: 'alphabetic' }); };
  const fill = (c) => doc.setFillColor(...c), stroke = (c) => doc.setDrawColor(...c);
  const rect = (x, yy, w, h, c, r = 0) => { fill(c); r ? doc.roundedRect(x, yy, w, h, r, r, 'F') : doc.rect(x, yy, w, h, 'F'); };
  const rule = (yy, c = RP.line, w = 0.2) => { stroke(c); doc.setLineWidth(w); doc.line(RP_M, yy, RP_W - RP_M, yy); };
  const wrap = (t, w, s = 9) => { font('normal', s); return doc.splitTextToSize(String(t || ''), w); };
  const header = () => {
    if (logo) doc.addImage(logo, 'PNG', RP_M, 9, 7, 7);
    text(`TASC Connect · ${title}`, RP_M + 9, 14, { w: 'bold', s: 9 });
    text(scope, RP_W - RP_M, 14, { s: 7.5, c: RP.muted, a: 'right', max: 110 });
    rect(RP_M, 18, RP_CW, 0.6, RP.red);
    y = 25;
  };
  const newPage = () => { doc.addPage(); header(); };
  const room = h => { if (y + h > RP_H - 16) { newPage(); return true; } return false; };
  const h2 = (t, sub, need = 16) => { room(need); text(t, RP_M, y + 5, { w: 'bold', s: 12.5 }); if (sub) text(sub, RP_W - RP_M, y + 5, { s: 7.5, c: RP.muted, a: 'right' }); y += 9; };
  const chip = (t, x, yy, c, bg) => { font('bold', 7); const w = doc.getTextWidth(t) + 4; rect(x, yy - 3.4, w, 4.6, bg, 1.2); text(t, x + 2, yy, { w: 'bold', s: 7, c }); return w; };
  const bar = (x, yy, w, h, frac, c) => { rect(x, yy, w, h, RP.line, h / 2); if (frac > 0) rect(x, yy, Math.max(h, w * Math.min(1, frac)), h, c, h / 2); };

  /* table: cols [{h, w, a:'r'|'l', fmt?(row)=>string, bar?(row)=>frac, c?(row)=>color}] */
  const table = (cols, rows, opt = {}) => {
    const rh = opt.rh || 6.2, head = () => { rect(RP_M, y, RP_CW, 7, RP.tint); let x = RP_M; cols.forEach(c => { text(c.h, c.a === 'r' ? x + c.w - 2 : x + 2, y + 4.7, { w: 'bold', s: 7.5, c: RP.muted, a: c.a === 'r' ? 'right' : 'left' }); x += c.w; }); y += 7; };
    head();
    rows.forEach((r, i) => {
      if (room(rh + (opt.total ? rh : 0))) head();
      const tot = opt.total && i === rows.length - 1;
      if (tot) rule(y, RP.ink, 0.35); else if (i % 2) rect(RP_M, y, RP_CW, rh, RP.zebra);
      let x = RP_M;
      cols.forEach(c => {
        const v = c.fmt(r);
        if (c.bar && !tot) { const fr = c.bar(r); bar(x + 2, y + rh / 2 - 1, c.w - 14, 2, fr, fr >= 0.75 ? RP.ok : fr >= 0.4 ? RP.acc : RP.warn); text(v, x + c.w - 2, y + rh - 1.9, { s: 8, a: 'right', w: 'bold' }); }
        else text(v, c.a === 'r' ? x + c.w - 2 : x + 2, y + rh - 1.9, { s: 8, w: tot || c.b ? 'bold' : 'normal', c: c.c ? c.c(r) : RP.ink, a: c.a === 'r' ? 'right' : 'left', max: c.w - 3 });
        x += c.w;
      });
      y += rh;
    });
    rule(y, RP.line); y += 4;
  };

  /* photos: thumbnails for small boxes, the original for big ones */
  const cache = new Map();
  const photo = async (p, x, yy, w, h) => {
    const big = Math.max(w, h) > 48, key = p.id + (big ? 'b' : 's');
    try {
      if (!cache.has(key)) {
        const urls = big ? await signedUrls([p.path]) : await signedThumbs([p.path]);
        cache.set(key, await rpImg(urls[p.path], w, h, big ? 900 : 420));
      }
      doc.addImage(cache.get(key), 'JPEG', x, yy, w, h, key, 'FAST');
    } catch (e) { rect(x, yy, w, h, RP.tint); text('Photo not available', x + w / 2, yy + h / 2, { s: 7, c: RP.faint, a: 'center' }); }
    stroke(RP.line); doc.setLineWidth(0.2); doc.rect(x, yy, w, h);
  };

  /* ═══════════ first page: title + at a glance ═══════════ */
  if (emblem) doc.addImage(emblem, 'PNG', RP_M, 12, 17, 17);
  text('Institutional Visits (TASC) Campaign', RP_M + 21, 19.5, { w: 'bold', s: 17 });
  text(`${title} · Regional Office, Udaipur · Central Bank of India`, RP_M + 21, 26, { s: 9.5, c: RP.muted });
  rect(RP_M, 33, RP_CW, 0.8, RP.red);
  text(scope, RP_M, 39.5, { s: 8.5, c: RP.muted, max: 130 });
  text(`As of ${asOf}`, RP_W - RP_M, 39.5, { s: 8.5, c: RP.muted, a: 'right' });
  y = 45;

  // headline numbers
  const cov = pct(M.visited, N.total), onTimeP = pct(M.onTime, M.delays.length);
  const tiles = [[String(N.total), 'Places allotted', RP.ink], [`${M.visited}`, `Visited · ${cov}% coverage`, RP.ok], [String(N.verified), 'Reports verified', RP.ok], [`${onTimeP}%`, 'Visited on time', RP.acc],
    [String(N.overdue), 'Visits overdue', N.overdue ? RP.bad : RP.ink], [String(M.biz.opened), `Accounts opened${M.biz.accounts ? ` · ${M.biz.accounts} a/c` : ''}`, RP.ok], [inrShort(M.biz.mobilised), 'Amount mobilised', RP.ok], [inrShort(M.biz.potential), 'Business potential found', RP.acc]];
  const tw = (RP_CW - 9) / 4;
  tiles.forEach(([v, l, c], i) => { const x = RP_M + (i % 4) * (tw + 3), yy = y + Math.floor(i / 4) * 21; rect(x, yy, tw, 18, RP.tint, 2); text(v, x + 4, yy + 9, { w: 'bold', s: 15, c }); text(l, x + 4, yy + 14.5, { s: 7.3, c: RP.muted, max: tw - 6 }); });
  y += 45;

  // what stands out (written from the numbers)
  const brs = R.branches.filter(b => !b.ro && b.total >= 3);
  const best = brs.slice().sort((a, b) => pct(b.visited, b.total) - pct(a.visited, a.total) || b.visited - a.visited).slice(0, 2);
  const worst = brs.filter(b => b.overdue).sort((a, b) => b.overdue - a.overdue).slice(0, 2);
  const tyBest = R.types.filter(t => t.visited).sort((a, b) => pct(b.opened, b.visited) - pct(a.opened, a.visited))[0];
  const lines = [
    `${M.visited} of ${N.total} allotted places visited (${cov}%); ${N.verified} reports verified by the Regional Office${N.submitted ? `, ${N.submitted} awaiting verification` : ''}.`,
    best.length ? `Highest coverage: ${best.map(b => `${b.name} (${pct(b.visited, b.total)}%)`).join(' and ')}.` + (worst.length ? ` Most overdue: ${worst.map(b => `${b.name} (${b.overdue})`).join(' and ')}.` : '') : '',
    M.biz.opened ? `${M.biz.opened} institution${M.biz.opened > 1 ? 's' : ''} opened accounts with us, mobilising ${rpRs(M.biz.mobilised)}${tyBest && tyBest.opened ? `. Best conversion: ${tyBest.t} (${pct(tyBest.opened, tyBest.visited)}% of places visited)` : ''}.` : `Positive response at ${R.posPlaces} places so far; no accounts opened yet.`,
    N.overdue ? `${N.overdue} visit${N.overdue > 1 ? 's are' : ' is'} overdue; by how long: ${M.ageing.filter(a => a.n).map(a => `${a.l} ${a.n}`).join(', ')}.` : 'No visit is overdue.'
  ].filter(Boolean);
  rect(RP_M, y, RP_CW, 6 + lines.reduce((s, l) => s + wrap(l, RP_CW - 12, 9).length * 4.4, 0), RP.zebra, 2);
  text('What stands out', RP_M + 4, y + 5.2, { w: 'bold', s: 8, c: RP.acc }); y += 9;
  lines.forEach(l => { const ws = wrap(l, RP_CW - 12, 9); rect(RP_M + 4.5, y - 2.2, 1.2, 1.2, RP.acc); ws.forEach((w, k) => text(w, RP_M + 8, y + k * 4.4, { s: 9 })); y += ws.length * 4.4; });
  y += 6;

  // progress bar
  h2('Where the allotted visits stand');
  let bx = RP_M; [[N.verified, RP.ok], [N.submitted, RP.acc], [N.notdue, RP.mute], [N.hold, RP.warn], [N.overdue, RP.bad]].forEach(([n, c]) => { if (!n || !N.total) return; const w = n / N.total * RP_CW; rect(bx, y, w, 6, c); bx += w; });
  y += 11;
  [['Verified', N.verified, RP.ok], ['Visited, not yet verified', N.submitted, RP.acc], ['Not yet due', N.notdue, RP.mute], ['On hold', N.hold, RP.warn], ['Overdue', N.overdue, RP.bad]]
    .reduce((x, [l, n, c]) => { rect(x, y - 2.6, 3, 3, c); const t = `${l} ${n}`; text(t, x + 4.5, y, { s: 8 }); font('normal', 8); return x + doc.getTextWidth(t) + 10; }, RP_M);
  y += 8;

  // funnel
  h2('From visit to business');
  const fun = [['Places allotted', N.total], ['Visited', M.visited], ['Positive response', R.posPlaces], ['Account opened', M.biz.opened]];
  fun.forEach(([l, n], i) => {
    const w = N.total ? Math.max(2, n / N.total * (RP_CW - 70)) : 2;
    text(l, RP_M, y + 4.2, { s: 8.5 }); rect(RP_M + 38, y, w, 6, [RP.ink, RP.acc, RP.warn, RP.ok][i], 1);
    text(String(n) + (i ? `  (${pct(n, fun[i - 1][1])}% of previous)` : ''), RP_M + 40 + w, y + 4.3, { s: 8, c: RP.muted });
    y += 8.5;
  });
  y += 3;

  // outcomes, products, banking: three short lists side by side
  room(52);
  const listCol = (x, w, head, rows) => { let yy = y; text(head, x, yy + 4, { w: 'bold', s: 9 }); yy += 8; const mx = Math.max(1, ...rows.map(r => r[1]));
    rows.slice(0, 6).forEach(([l, n]) => { text(l.length > 30 ? l.slice(0, 29) + '…' : l, x, yy + 3, { s: 7.6 }); bar(x, yy + 4.5, w - 10, 1.8, n / mx, RP.acc); text(String(n), x + w, yy + 6.2, { s: 7.6, a: 'right', w: 'bold' }); yy += 7.5; }); return yy; };
  const cw3 = (RP_CW - 10) / 3;
  const y1 = listCol(RP_M, cw3, 'Outcome of visits', M.outcomes.length ? M.outcomes : [['—', 0]]);
  const y2 = listCol(RP_M + cw3 + 5, cw3, 'Products discussed', M.products.length ? M.products : [['—', 0]]);
  const y3 = listCol(RP_M + (cw3 + 5) * 2, cw3, 'Institutions bank with', M.banking.concat(M.otherBanks.slice(0, 3).map(([b, n]) => ['  ' + b, n])));
  y = Math.max(y1, y2, y3) + 4;

  if (o.preset !== 'dossier') {
    /* ═══════════ branches and institution types ═══════════ */
    newPage();
    h2('Branch-wise progress', 'Allotted to staff of each branch', 45);
    const tot = R.branches.reduce((t, b) => ({ name: 'Total', total: t.total + b.total, visited: t.visited + b.visited, verified: t.verified + b.verified, overdue: t.overdue + b.overdue, opened: t.opened + b.opened, mobilised: t.mobilised + b.mobilised }), { total: 0, visited: 0, verified: 0, overdue: 0, opened: 0, mobilised: 0 });
    table([
      { h: 'Branch', w: 44, fmt: b => b.name },
      { h: 'Allotted', w: 16, a: 'r', fmt: b => String(b.total) },
      { h: 'Visited', w: 16, a: 'r', fmt: b => String(b.visited) },
      { h: 'Coverage', w: 32, a: 'r', fmt: b => pct(b.visited, b.total) + '%', bar: b => b.total ? b.visited / b.total : 0 },
      { h: 'Verified', w: 16, a: 'r', fmt: b => String(b.verified) },
      { h: 'Overdue', w: 16, a: 'r', fmt: b => b.overdue ? String(b.overdue) : '–', c: b => b.overdue ? RP.bad : RP.faint },
      { h: 'A/c opened', w: 20, a: 'r', fmt: b => b.opened ? String(b.opened) : '–', c: b => b.opened ? RP.ok : RP.faint },
      { h: 'Mobilised', w: 22, a: 'r', fmt: b => b.mobilised ? inrShort(b.mobilised) : '–' }
    ], R.branches.concat([tot]), { total: true });

    h2('By type of institution', 'Which institutions respond best', 45);
    table([
      { h: 'Type of institution', w: 46, fmt: t => t.t },
      { h: 'Allotted', w: 18, a: 'r', fmt: t => String(t.total) },
      { h: 'Coverage', w: 32, a: 'r', fmt: t => pct(t.visited, t.total) + '%', bar: t => t.total ? t.visited / t.total : 0 },
      { h: 'Positive', w: 18, a: 'r', fmt: t => String(t.interested) },
      { h: 'A/c opened', w: 18, a: 'r', fmt: t => String(t.opened), c: t => t.opened ? RP.ok : RP.faint },
      { h: 'Conversion', w: 16, a: 'r', fmt: t => t.visited ? pct(t.opened, t.visited) + '%' : '–' },
      { h: 'Potential', w: 14, a: 'r', fmt: t => t.potential ? inrShort(t.potential) : '–' }
    ], R.types);
    text('Conversion = accounts opened ÷ places visited. Positive = interested, follow-up needed or account opened.', RP_M, y, { s: 7, c: RP.faint }); y += 6;

    /* ═══════════ officers ═══════════ */
    h2('Officers with the most visits completed', '', 45);
    table([
      { h: 'Officer', w: 50, fmt: x => x.name, b: true },
      { h: 'Branch', w: 36, fmt: x => x.branch },
      { h: 'Allotted', w: 18, a: 'r', fmt: x => String(x.total) },
      { h: 'Visited', w: 18, a: 'r', fmt: x => String(x.visited + x.own) },
      { h: 'Avg delay', w: 20, a: 'r', fmt: x => x.delayN ? (x.delaySum / x.delayN).toFixed(1) + ' d' : '–' },
      { h: 'A/c opened', w: 20, a: 'r', fmt: x => x.opened ? String(x.opened) : '–', c: x => x.opened ? RP.ok : RP.faint },
      { h: 'Mobilised', w: 20, a: 'r', fmt: x => x.mobilised ? inrShort(x.mobilised) : '–' }
    ], R.leaders);
    if (R.laggards.length) {
      h2('Officers with the most visits overdue', '', 45);
      table([
        { h: 'Officer', w: 50, fmt: x => x.name, b: true },
        { h: 'Branch', w: 36, fmt: x => x.branch },
        { h: 'Allotted', w: 18, a: 'r', fmt: x => String(x.total) },
        { h: 'Visited', w: 18, a: 'r', fmt: x => String(x.visited) },
        { h: 'Overdue', w: 20, a: 'r', fmt: x => String(x.overdue), c: () => RP.bad },
        { h: 'Oldest delay', w: 40, a: 'r', fmt: x => Math.max(...x.pending.map(r => r.late)) + ' days' }
      ], R.laggards);
    }

    /* ═══════════ success stories ═══════════ */
    if (R.stories.length) {
      newPage();
      h2('Success stories', 'Accounts opened, then the strongest leads');
      const cw = (RP_CW - 6) / 2, ph = 44, th = 36;
      for (let i = 0; i < R.stories.length; i++) {
        const v = R.stories[i], x = RP_M + (i % 2) * (cw + 6);
        if (i % 2 === 0) room(ph + th + 2);
        const yy = y, p = R.photosOf(v.id)[0];
        progress(`Success stories ${i + 1} / ${R.stories.length}`);
        if (p && o.photos !== 'none') await photo(p, x, yy, cw, ph); else { rect(x, yy, cw, ph, RP.tint); text('No photo', x + cw / 2, yy + ph / 2, { s: 8, c: RP.faint, a: 'center' }); }
        let ty = yy + ph + 5;
        const st = v.closure === 'account_opened' ? ['Account opened', RP.ok, [221, 243, 228]] : ['Interested', RP.acc, [222, 236, 250]];
        chip(st[0], x, ty, st[1], st[2]); ty += 5.5;
        wrap(v.entity.name, cw, 10).slice(0, 2).forEach(l => { text(l, x, ty, { w: 'bold', s: 10 }); ty += 4.6; });
        text(`${v.entity.type} · ${branchName(v.visitor_branch)} · ${rpDay(v.visited_at)}`, x, ty, { s: 7.6, c: RP.muted }); ty += 4.5;
        const met = [v.person_name, v.person_designation].filter(Boolean).join(', ');
        const got = v.closure === 'account_opened' ? `${rpRs(v.mobilised_rs)} mobilised${(v.account_numbers || []).length ? ` · ${v.account_numbers.length} account${v.account_numbers.length > 1 ? 's' : ''}` : ''}` : (v.potential_rs ? `Potential ${rpRs(v.potential_rs)}` : '');
        if (got) { text(got, x, ty, { w: 'bold', s: 8.6, c: st[1] }); ty += 4.4; }
        wrap(`Visited by ${cleanName(personName(v.visitor))}${met ? ` · met ${met}` : ''}`, cw, 7.6).slice(0, 2).forEach(l => { text(l, x, ty, { s: 7.6 }); ty += 3.8; }); ty += 0.6;
        if (v.remarks || v.closure_note) wrap(v.closure_note || v.remarks, cw, 7.6).slice(0, 2).forEach(l => { text(l, x, ty, { s: 7.6, c: RP.muted }); ty += 3.8; });
        if (i % 2 === 1 || i === R.stories.length - 1) y = yy + ph + th + 2;
      }
    }

    /* ═══════════ photo gallery ═══════════ */
    if (R.gallery.length && o.photos !== 'none') {
      newPage();
      h2('From the field', 'Latest live photos, one per place');
      const gw = (RP_CW - 8) / 3, gh = gw * 0.75;
      for (let i = 0; i < R.gallery.length; i++) {
        const { v, p } = R.gallery[i], x = RP_M + (i % 3) * (gw + 4);
        if (i % 3 === 0 && i) y += gh + 13;
        if (i % 3 === 0 && y + gh + 13 > RP_H - 16) newPage();
        progress(`Photos ${i + 1} / ${R.gallery.length}`);
        await photo(p, x, y, gw, gh);
        text(v.entity.name.length > 38 ? v.entity.name.slice(0, 37) + '…' : v.entity.name, x, y + gh + 4, { w: 'bold', s: 7.4 });
        text(`${branchName(v.visitor_branch)} · ${rpDay(v.visited_at)}`, x, y + gh + 7.8, { s: 6.8, c: RP.muted });
      }
      y += gh + 14;
    }
  }

  /* ═══════════ visit details (the dossier, or an annexure) ═══════════ */
  if (o.preset === 'dossier' || o.annexVisits) {
    newPage();
    const key = { branch: v => branchName(v.visitor_branch) || '—', type: v => v.entity.type, officer: v => cleanName(personName(v.visitor)) }[o.groupBy || 'branch'];
    const groups = new Map();
    R.vis.slice().sort((a, b) => key(a).localeCompare(key(b)) || (a.visited_at || '').localeCompare(b.visited_at || '')).forEach(v => { const k = key(v); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); });
    h2(o.preset === 'dossier' ? 'Visit details' : 'Annexure A · Visit details', `${R.vis.length} visit${R.vis.length === 1 ? '' : 's'} · grouped by ${o.groupBy || 'branch'}`);
    let done = 0;
    for (const [g, vs] of groups) {
      room(30);
      rect(RP_M, y, RP_CW, 7.5, RP.ink, 1.5); text(g, RP_M + 3, y + 5.2, { w: 'bold', s: 9.5, c: RP.white }); text(`${vs.length} visit${vs.length > 1 ? 's' : ''}`, RP_W - RP_M - 3, y + 5.2, { s: 8, c: RP.white, a: 'right' }); y += 11;
      for (const v of vs) {
        progress(`Visits ${++done} / ${R.vis.length}`);
        const ps = o.photos === 'none' ? [] : R.photosOf(v.id).slice(0, o.photos === 'best' ? 1 : 4);
        const kv = [
          ['Visited', `${rpWhen(v.visited_at)}${v.logged_at && new Date(v.logged_at) - new Date(v.visited_at) > 864e5 ? ` (reported ${Math.floor((new Date(v.logged_at) - new Date(v.visited_at)) / 864e5)} d later)` : ''}`],
          ['Officer', cleanName(personName(v.visitor)) + (all('joint').filter(j => j.visit_id === v.id).length ? ' with ' + all('joint').filter(j => j.visit_id === v.id).map(j => cleanName(personName(j.emp_id))).join(', ') : '') + ` · ${branchName(v.visitor_branch)}`],
          ['Person met', [v.person_name, v.person_designation].filter(Boolean).join(', ') + (o.contacts && v.person_mobile ? ` · ${v.person_mobile}` : v.person_mobile ? ` · ${rpMask(v.person_mobile)}` : '') || '—'],
          ['Outcome', [v.outcome, v.closure && closureLabel(v.closure)].filter(Boolean).join(' · ') + (v.next_step ? ` · Next: ${v.next_step}${v.followup_on ? ' on ' + rpDay(v.followup_on) : ''}` : '') || '—'],
          ['Banks with', { us: 'Our bank', other: 'Other bank' + (v.other_bank ? ': ' + v.other_bank : ''), none: 'None / not known' }[v.banking_with] || '—'],
          ['Business', [v.potential_rs ? 'Potential ' + rpRs(v.potential_rs) : '', v.mobilised_rs ? 'Mobilised ' + rpRs(v.mobilised_rs) : '', (v.account_numbers || []).length ? `A/c ${v.account_numbers.slice(0, 4).map(rpAcct).join(', ')}${v.account_numbers.length > 4 ? ` +${v.account_numbers.length - 4}` : ''}` : ''].filter(Boolean).join(' · ') || '—'],
          ['Products', (v.products || []).join(', ') || '—'],
          ['Location', v.lat != null ? `${(+v.lat).toFixed(5)}, ${(+v.lng).toFixed(5)}${v.accuracy_m ? ' ±' + v.accuracy_m + ' m' : ''} (live GPS)` : 'Not recorded']
        ];
        const PW = ps.length ? 66 : 0, IW = RP_CW - 8 - (PW ? PW + 4 : 0) - 24;   // photo panel on the right, details on the left
        const rem = v.remarks || v.closure_note ? wrap(v.remarks || v.closure_note, IW, 7.8) : [];
        const kvH = kv.reduce((s, [, t]) => s + Math.max(1, wrap(t, IW, 7.8).length) * 3.7, 0) + (rem.length ? rem.length * 3.7 + 1.5 : 0);
        const cell = ps.length === 1 ? [PW, PW * 0.75] : [(PW - 2) / 2, (PW - 2) / 2 * 0.75];
        const phH = !ps.length ? 0 : ps.length <= 2 ? cell[1] : cell[1] * 2 + 2;
        const H = 15.5 + Math.max(kvH, phH) + 4;
        room(H);
        const y0 = y;
        stroke(RP.line); doc.setLineWidth(0.25); doc.roundedRect(RP_M, y0, RP_CW, H, 2, 2, 'S');
        const st = v.status === 'verified' ? ['Verified', RP.ok, [221, 243, 228]] : ['Not yet verified', RP.warn, [255, 241, 214]];
        font('bold', 7); const sw = doc.getTextWidth(st[0]) + 4, vw = doc.getTextWidth(`Visit ${v.visit_no}`) + 4;
        text(v.entity.name, RP_M + 4, y0 + 6.5, { w: 'bold', s: 10, max: RP_CW - 16 - sw - vw });
        chip(st[0], RP_W - RP_M - 4 - sw, y0 + 6.3, st[1], st[2]);
        chip(`Visit ${v.visit_no}`, RP_W - RP_M - 6 - sw - vw, y0 + 6.3, RP.muted, RP.tint);
        text(`${v.entity.type}${v.entity.area ? ' · ' + v.entity.area : ''}`, RP_M + 4, y0 + 10.6, { s: 7.4, c: RP.muted });
        y = y0 + 15.5;
        kv.forEach(([k, t]) => { text(k, RP_M + 4, y, { s: 7.3, c: RP.muted }); const ws = wrap(t, IW, 7.8); ws.forEach((l, i) => text(l, RP_M + 28, y + i * 3.7, { s: 7.8 })); y += Math.max(1, ws.length) * 3.7; });
        if (rem.length) { y += 1.5; text('Remarks', RP_M + 4, y, { s: 7.3, c: RP.muted }); rem.forEach((l, i) => text(l, RP_M + 28, y + i * 3.7, { s: 7.8, c: RP.ink })); y += rem.length * 3.7; }
        if (v.lat != null) { font('normal', 7.2); doc.setTextColor(...RP.acc); doc.textWithLink('Open in Maps', RP_M + 4, y0 + H - 3, { url: `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}` }); }
        if (ps.length) {
          const px = RP_W - RP_M - 4 - PW, py = y0 + 13;
          for (let i = 0; i < ps.length; i++) await photo(ps[i], px + (ps.length === 1 ? 0 : (i % 2) * (cell[0] + 2)), py + (ps.length === 1 ? 0 : Math.floor(i / 2) * (cell[1] + 2)), cell[0], cell[1]);
        }
        y = y0 + H + 4;
      }
    }
  }

  /* ═══════════ pending and exceptions ═══════════ */
  if (o.exceptions && R.overdue.length) {
    newPage();
    h2(o.preset === 'dossier' ? 'Pending visits' : 'Annexure B · Pending visits', `${R.overdue.length} overdue as of ${rpDay(today)}`);
    table([
      { h: 'Branch', w: 34, fmt: r => (R.staff(r.a.assignee).branch || '—') },
      { h: 'Officer', w: 46, fmt: r => cleanName(R.staff(r.a.assignee).name || 'Emp ' + r.a.assignee) },
      { h: 'Place', w: 70, fmt: r => r.a.entity.name },
      { h: 'Due', w: 16, a: 'r', fmt: r => shortDay(r.a.scheduled_on) },
      { h: 'Delay', w: 16, a: 'r', fmt: r => r.late + ' d', c: () => RP.bad }
    ], R.overdue.slice().sort((a, b) => (R.staff(a.a.assignee).branch || '').localeCompare(R.staff(b.a.assignee).branch || '') || b.late - a.late), { rh: 5.6 });
    if (R.lateLogged.length) { h2('Reports submitted more than a day after the visit', `${R.lateLogged.length}`);
      table([{ h: 'Place', w: 80, fmt: v => v.entity.name }, { h: 'Officer', w: 50, fmt: v => cleanName(personName(v.visitor)) }, { h: 'Visited', w: 26, a: 'r', fmt: v => rpDay(v.visited_at) }, { h: 'Reported', w: 26, a: 'r', fmt: v => rpDay(v.logged_at) }], R.lateLogged, { rh: 5.6 }); }
  }

  /* ═══════════ about this report ═══════════ */
  room(42); y += 4;
  rule(y); y += 6;
  text('About this report', RP_M, y, { w: 'bold', s: 9 }); y += 5;
  [`Generated by TASC Connect on ${asOf}. Figures are as of that moment and match the TASC Connect Dashboard for the same filters.`,
   'Every visit is reported in the app by the visiting officer with live, geotagged photos: the photo carries the place, officer, time and GPS location stamped on it at the moment it was taken. "Verified" means the Regional Office has checked the report.',
   `Coverage = places visited ÷ places allotted. On time = visited on or before the allotted date. ${o.verifiedOnly ? 'Only verified visits are included in the visit details.' : 'Visits not yet verified are included and labelled.'} ${o.contacts ? '' : 'Mobile numbers and account numbers are partly hidden.'}`
  ].forEach(p => { wrap(p, RP_CW, 7.6).forEach(l => { text(l, RP_M, y, { s: 7.6, c: RP.muted }); y += 3.7; }); y += 1.5; });

  /* page numbers, footer, sample mark */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    rule(RP_H - 11, RP.line);
    text('Central Bank of India · Regional Office, Udaipur · via PDUDAIRO', RP_M, RP_H - 6.5, { s: 7, c: RP.faint });
    text(`Page ${i} of ${pages}`, RP_W - RP_M, RP_H - 6.5, { s: 7, c: RP.faint, a: 'right' });
    if (o.sample) {
      doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.08 })); font('bold', 46, RP.bad);
      const t = 'SAMPLE · TEST DATA', w = doc.getTextWidth(t), a = 35 * Math.PI / 180;
      doc.text(t, RP_W / 2 - w / 2 * Math.cos(a), RP_H / 2 + w / 2 * Math.sin(a), { angle: 35 });
      doc.restoreGraphicsState();
      text('Sample made with test data: names, places and figures are not real.', RP_W / 2, RP_H - 2.5, { s: 6.5, c: RP.bad, a: 'center' }); }
  }
  progress('Finishing…');
  const blob = doc.output('blob');
  const name = `TASC-Connect-${o.preset === 'dossier' ? 'visit-dossier' : 'status-report'}-${todayISO()}.pdf`;
  const day = rpDay(today);
  const textMsg = `*TASC Connect · ${o.preset === 'dossier' ? 'Visit dossier' : 'Status report'}* (${day})\n`
    + `Institutional Visits (TASC) Campaign, Regional Office Udaipur\n`
    + `Allotted ${N.total} · Visited ${M.visited} (${cov}%) · Verified ${N.verified} · Overdue ${N.overdue}\n`
    + `Accounts opened ${M.biz.opened} · Mobilised ${rpRs(M.biz.mobilised)}\n\nDetails in the attached PDF.\n– Regional Office, Udaipur`;
  return { blob, name, text: textMsg, kind: 'PDF', mime: 'application/pdf', title: `TASC Connect · ${title}`, pages };
}

/* ───────── the options sheet ───────── */
function askReport(M, f, D) {
  const body = openSheet('Make a report', `
    <p class="muted" style="margin-top:0">A PDF to present: follows the Type and Branch filters above.</p>
    <label class="f">Report</label>
    <div class="chips" id="rp-k"><button class="chip on" data-k="exec">Status report</button><button class="chip" data-k="dossier">Visit dossier</button></div>
    <p class="hint" id="rp-kh"></p>
    <div class="g2"><div><label class="f" for="rp-from">Visits from</label><input class="input" type="date" id="rp-from"></div>
      <div><label class="f" for="rp-to">to</label><input class="input" type="date" id="rp-to" max="${todayISO()}"></div></div>
    <label class="f" for="rp-ph">Photos</label>
    <select class="input" id="rp-ph"><option value="best">Best photo of each visit</option><option value="all">All photos (up to 4)</option><option value="none">No photos</option></select>
    <div id="rp-gw"><label class="f" for="rp-g">Group visits by</label>
    <select class="input" id="rp-g"><option value="branch">Branch</option><option value="type">Type of institution</option><option value="officer">Officer</option></select></div>
    <label class="item" style="cursor:pointer"><div class="grow"><div class="t">Include Udaipur RO</div></div><input type="checkbox" id="rp-ro" style="width:22px;height:22px"></label>
    <label class="item" style="cursor:pointer"><div class="grow"><div class="t">Only verified visits</div></div><input type="checkbox" id="rp-ver" style="width:22px;height:22px"></label>
    <label class="item" style="cursor:pointer"><div class="grow"><div class="t">Pending visits annexure</div></div><input type="checkbox" id="rp-ex" checked style="width:22px;height:22px"></label>
    <label class="item" style="cursor:pointer"><div class="grow"><div class="t">Show full mobile numbers</div><div class="s">Off: partly hidden, as the PDF may be forwarded</div></div><input type="checkbox" id="rp-ct" style="width:22px;height:22px"></label>
    <p class="hint" id="rp-est"></p>
    <button class="btn block" id="rp-go">Make PDF</button>`);
  let kind = 'exec';
  const val = () => ({ preset: kind, from: $('#rp-from', body).value || null, to: $('#rp-to', body).value || null, photos: $('#rp-ph', body).value, groupBy: $('#rp-g', body).value,
    verifiedOnly: $('#rp-ver', body).checked, exceptions: $('#rp-ex', body).checked, contacts: $('#rp-ct', body).checked, ro: $('#rp-ro', body).checked });
  const est = () => {
    const o = val(), m = o.ro ? M : dashModel(D, { ...f, noRO: true });
    const R = rpData(m, D, o), ph = o.photos === 'none' ? 0 : o.preset === 'dossier' ? R.vis.reduce((s, v) => s + Math.min(o.photos === 'best' ? 1 : 4, R.photosOf(v.id).length), 0) : R.gallery.length + R.stories.length;
    $('#rp-kh', body).textContent = kind === 'exec' ? 'Summary, branch and institution-type tables, officers, success stories and field photos. 4–8 pages.' : 'Every visit with its details and photos, as proof of visits.';
    $('#rp-gw', body).hidden = kind !== 'dossier';
    $('#rp-est', body).textContent = `${o.preset === 'dossier' ? R.vis.length + ' visits · ' : ''}${ph} photo${ph === 1 ? '' : 's'} · about ${Math.max(1, Math.round((ph * (o.preset === 'dossier' ? 30 : 70) + 150) / 1024 * 10) / 10)} MB`;
  };
  $$('[data-k]', body).forEach(b => b.onclick = () => { kind = b.dataset.k; $$('[data-k]', body).forEach(x => x.classList.toggle('on', x === b)); est(); });
  $$('input,select', body).forEach(i => i.onchange = est);
  est();
  $('#rp-go', body).onclick = async () => {
    const b = $('#rp-go', body); b.disabled = true;
    const o = val(), m = o.ro ? M : dashModel(D, { ...f, noRO: true });
    let out;
    try { out = await makeReport(m, D, f, o, t => { b.textContent = t; }); }
    catch (e) { toast(errText(e)); b.disabled = false; b.textContent = 'Make PDF'; return; }
    shareReady(out);
  };
}
