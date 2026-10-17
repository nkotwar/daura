/* Daura · photos: shrink on the phone, read GPS/time from uploaded photos, stamp live photos.
   Visually lossless: 1600 px on the long side, JPEG quality 0.82 → about 200–350 KB each. */

const PHOTO_MAX = 4;
const PHOTO_EDGE = 1600;
const PHOTO_Q = 0.82;

/* Current position. Resolves to {lat, lng, acc} or null (denied / unavailable / timeout). */
function getPosition(timeout = 15000) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }),
      err => res(err && err.code === 1 ? { denied: true } : null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

/* Minimal EXIF reader: GPS latitude/longitude and DateTimeOriginal from a JPEG. */
async function readExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return {};
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off); const size = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if ((marker & 0xFF00) !== 0xFF00) break;
      off += 2 + size;
    }
  } catch (e) { /* not a readable JPEG */ }
  return {};
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
  const out = {};
  const ifd = (o, fn) => { const n = u16(o); for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; fn(u16(e), e); } };
  const rat = o => { const a = u32(o), b = u32(o + 4); return b ? a / b : 0; };
  const ascii = (e) => { const cnt = u32(e + 4); const p = cnt > 4 ? u32(e + 8) : e + 8; let s = ''; for (let i = 0; i < cnt - 1; i++) s += String.fromCharCode(v.getUint8(t + p + i)); return s; };
  let gpsOff = 0, exifOff = 0;
  ifd(u32(4), (tag, e) => { if (tag === 0x8825) gpsOff = u32(e + 8); if (tag === 0x8769) exifOff = u32(e + 8); });
  if (exifOff) ifd(exifOff, (tag, e) => { if (tag === 0x9003) out.when = ascii(e); });
  if (gpsOff) {
    const g = {};
    ifd(gpsOff, (tag, e) => {
      if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(v.getUint8(t + e + 8));
      if (tag === 2 || tag === 4) { const p = u32(e + 8); g[tag] = rat(p) + rat(p + 8) / 60 + rat(p + 16) / 3600; }
    });
    if (g[2] && g[4]) { out.lat = +(g[2] * (g[1] === 'S' ? -1 : 1)).toFixed(6); out.lng = +(g[4] * (g[3] === 'W' ? -1 : 1)).toFixed(6); }
  }
  if (out.when) { const m = out.when.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/); out.when = m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : null; }
  return out;
}

/* Shrink (and optionally stamp) an image file → { blob, w, h } */
async function processPhoto(file, stamp) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a photo Daura can read.')); i.src = URL.createObjectURL(file); });
  }
  const sw = bmp.width, sh = bmp.height, k = Math.min(1, PHOTO_EDGE / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0, w, h);
  if (stamp) drawStamp(x, w, h, stamp);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', PHOTO_Q));
  if (bmp.close) bmp.close();
  return { blob, w, h };
}

/* The band at the bottom of a live photo: place · person · time · coordinates. */
function drawStamp(x, w, h, s) {
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.032));
  const lines = [s.place, `${s.person} · ${s.when}`, s.coords].filter(Boolean);
  const pad = Math.round(fs * 0.7), lh = Math.round(fs * 1.35);
  const bandH = pad * 2 + lh * lines.length;
  x.fillStyle = 'rgba(10,20,35,0.62)'; x.fillRect(0, h - bandH, w, bandH);
  x.fillStyle = '#D20838'; x.fillRect(0, h - bandH, Math.round(fs * 0.3), bandH);
  x.textBaseline = 'top';
  lines.forEach((t, i) => {
    x.font = `${i === 0 ? 600 : 400} ${i === 0 ? Math.round(fs * 1.08) : fs}px "IBM Plex Sans", system-ui, sans-serif`;
    x.fillStyle = i === 0 ? '#FFFFFF' : 'rgba(255,255,255,0.9)';
    let txt = t; while (x.measureText(txt).width > w - pad * 3 && txt.length > 4) txt = txt.slice(0, -2);
    if (txt !== t) txt = txt.slice(0, -1) + '…';
    x.fillText(txt, pad * 1.6, h - bandH + pad + i * lh);
  });
  x.font = `600 ${Math.round(fs * 0.8)}px "IBM Plex Sans", system-ui, sans-serif`;
  x.fillStyle = 'rgba(255,255,255,0.75)'; x.textAlign = 'right';
  x.fillText('Daura · via PDUDAIRO', w - pad, h - bandH + pad);
  x.textAlign = 'left';
}

const fmtCoords = p => p && p.lat != null ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.acc ? ' ±' + p.acc + ' m' : ''}` : '';

/* Short-lived links to view private photos (10 minutes). */
const URLS = new Map();   // path → { url, until }
async function signedUrls(paths) {
  const now = Date.now(), m = {}, need = [];
  paths.forEach(p => { const c = URLS.get(p); if (c && c.until > now) m[p] = c.url; else need.push(p); });
  if (need.length) {
    const { data, error } = await sb.storage.from('photos').createSignedUrls(need, 600);
    if (error) throw error;
    (data || []).forEach(d => { if (d.signedUrl) { m[d.path] = d.signedUrl; URLS.set(d.path, { url: d.signedUrl, until: now + 540000 }); } });
  }
  return m;
}
