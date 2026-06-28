'use strict';

// ══════════════════════════════════════════════════════════════
//  BUILD + DIAGNOSTIC GLOBAL DE ERORI
//  Orice eroare JS necapturată e afișată pe ecran (cu numărul versiunii),
//  ca să putem diagnostica pe telefon fără consolă de developer.
// ══════════════════════════════════════════════════════════════
const BUILD = 'v11';
function showFatal(msg) {
  let b = document.getElementById('fatal-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'fatal-banner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
      'background:#ff3b30;color:#fff;font:12px/1.4 sans-serif;padding:8px;' +
      'white-space:pre-wrap;word-break:break-word;';
    (document.body || document.documentElement).appendChild(b);
  }
  b.textContent = 'BUILD ' + BUILD + ' • EROARE: ' + msg;
}
window.addEventListener('error', e =>
  showFatal((e.message || 'eroare') + '  @' + String(e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e =>
  showFatal('promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const S = {
  gps: { watchId: null, speed: 0, accuracy: null, altitude: null, heading: null, lat: null, lng: null },
  chrono: { running: false, startMs: null, accumulated: 0, raf: null },
  rt: {
    active: false, finishing: false, targetSpd: 40, totalDist: 2.0, type: 'auto',
    startMs: null, distKm: 0, lastPos: null, tickId: null,
    segments: [{ from: 0, speed: 40 }], distFactor: 1, voiceThresh: 3, segAnnounced: {}
  },
  road: {
    boxes: (() => { try { return JSON.parse(ls('rali_road') || '[]'); } catch(e) { return []; } })(),
    active: false, legDistKm: 0, lastPos: null,
    nextIdx: 0, tickId: null, announced: {}
  },
  presets: (() => { try { return JSON.parse(ls('rali_presets') || 'null') || DEFAULT_PRESETS(); } catch(e) { return DEFAULT_PRESETS(); } })(),
  tc: { targetMs: null, tickId: null, announced: {} },
  pen: (() => { try { return JSON.parse(ls('rali_pen') || '{}'); } catch(e) { return {}; } })(),
  voice: { rtLastMs: 0, rtLastDev: null, paceOut: false },
  rec: { obj: null, listening: false, cancelled: false },
  chat: { busy: false },
  cfg: {
    apiKey: ls('rali_key') || '',
    model:  ls('rali_model') || 'claude-haiku-4-5-20251001',
    theme:  ls('rali_theme') || 'dark'
  }
};

function DEFAULT_PRESETS() {
  return [
    { name: 'RT1', spd: 46.8, dist: 7.32, type: 'auto',     spd2: null, changeKm: null },
    { name: 'RT2', spd: 44.8, dist: 8.89, type: 'standing', spd2: null, changeKm: null },
    { name: 'RT3', spd: 34.6, dist: 6.26, type: 'standing', spd2: null, changeKm: null },
    { name: 'RT4', spd: 24.3, dist: 5.74, type: 'standing', spd2: null, changeKm: null },
    { name: 'RT5', spd: 40.0, dist: 7.49, type: 'standing', spd2: null, changeKm: null },
    { name: 'RT6', spd: 30.0, dist: 13.0, type: 'standing', spd2: 45.0, changeKm: 3.06 }
  ];
}

function ls(k, v) {
  if (v !== undefined) { localStorage.setItem(k, v); return v; }
  return localStorage.getItem(k);
}

// ══════════════════════════════════════════════════════════════
//  GPS
// ══════════════════════════════════════════════════════════════
function gpsInit() {
  if (!window.isSecureContext) {
    gpsDot('off');
    gpsStatus('GPS-ul cere conexiune securizată (HTTPS). Deschide aplicația printr-o adresă https://, nu http:// sau fișier local.', false);
    return;
  }
  if (!navigator.geolocation) {
    gpsDot('off');
    gpsStatus('Acest browser nu oferă geolocație.', false);
    return;
  }
  gpsDot('searching');
  // Promptul de locație e fiabil DOAR la un gest al utilizatorului (tap), nu automat
  // la încărcare — mai ales într-un PWA. Așa că pornim watch-ul automat doar dacă
  // permisiunea e deja acordată; altfel cerem un tap explicit pe „Activează GPS".
  const q = navigator.permissions?.query?.({ name: 'geolocation' });
  if (!q) {
    // Permissions API indisponibil: încercăm direct, dar lăsăm și butonul ca plasă de siguranță
    gpsStatus('Dacă vitezometrul rămâne pe 0, apasă „Activează GPS" și permite locația.', true);
    startWatch();
    return;
  }
  q.then(p => {
    const handle = () => {
      if (p.state === 'granted') {
        gpsStatus('📡 Caut semnal GPS… (sub cer liber)', false);
        startWatch();
      } else if (p.state === 'denied') {
        gpsDot('off');
        gpsStatus('Permisiunea de locație e refuzată. Apasă 🔒 lângă adresă → Locație → Permite, apoi butonul de mai jos.', true, true);
      } else {
        gpsStatus('Apasă „Activează GPS" și permite locația ca să pornești vitezometrul.', true);
      }
    };
    handle();
    p.onchange = handle; // dacă acorzi permisiunea din setări, pornește singur
  }).catch(() => { gpsStatus('Apasă „Activează GPS" pentru a porni locația.', true); });
}

function startWatch() {
  if (S.gps.watchId != null) navigator.geolocation.clearWatch(S.gps.watchId);
  S.gps.watchId = navigator.geolocation.watchPosition(gpsOk, gpsErr,
    { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 });
}

function gpsOk(pos) {
  const c = pos.coords;
  S.gps.speed    = c.speed != null ? c.speed * 3.6 : calcSpeed(pos);
  S.gps.accuracy = c.accuracy;
  S.gps.altitude = c.altitude;
  S.gps.heading  = c.heading;
  S.gps.lat      = c.latitude;
  S.gps.lng      = c.longitude;
  gpsDot('active');
  gpsStatus(null);
  renderSpeed();
  if (S.rt.active)   rtGpsTick(pos);
  if (S.road.active) navGpsTick(pos);
}

let _prevPos = null, _prevT = null;
function calcSpeed(pos) {
  if (_prevPos && _prevT) {
    const dt = (pos.timestamp - _prevT) / 1000;
    if (dt > 0.1) {
      const d = haversine(
        _prevPos.coords.latitude, _prevPos.coords.longitude,
        pos.coords.latitude,      pos.coords.longitude);
      const spd = (d / dt) * 3600;
      _prevPos = pos; _prevT = pos.timestamp;
      return spd;
    }
  }
  _prevPos = pos; _prevT = pos.timestamp;
  return S.gps.speed;
}

function gpsErr(e) {
  console.warn('GPS:', e.code, e.message);
  if (e.code === 3) {
    // TIMEOUT — semnal slab, dar watch-ul rămâne activ; rămânem în „căutare"
    gpsDot('searching');
    gpsStatus('Semnal GPS slab — caut fix… (sub cer liber, nu sub copertină)', false);
    return;
  }
  gpsDot('off');
  if (e.code === 1) {
    gpsStatus('Permisiunea de locație e refuzată. Apasă 🔒 lângă adresă → Locație → Permite, apoi butonul de mai jos.', true, true);
  } else if (e.code === 2) {
    gpsStatus('Poziție indisponibilă. Verifică dacă locația e pornită pe telefon (GPS / „Locație" în setări).', true, true);
  } else {
    gpsStatus('Eroare GPS: ' + e.message, true, true);
  }
}

// Afișează/ascunde caseta de status GPS. msg=null => ascunde.
// isError=true colorează chenarul roșu (eroare); altfel e neutru (info/căutare).
function gpsStatus(msg, showRetry, isError) {
  const box = document.getElementById('gps-status');
  if (!box) return;
  if (!msg) { box.classList.add('hidden'); return; }
  document.getElementById('gps-status-txt').textContent = msg;
  document.getElementById('btn-gps-retry').style.display = showRetry ? '' : 'none';
  box.classList.toggle('err', !!isError);
  box.classList.remove('hidden');
}

// Reîncearcă: getCurrentPosition declanșează promptul de permisiune dacă e în „prompt"
function gpsRetry() {
  gpsDot('searching');
  gpsStatus('Caut semnal…', false);
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => { gpsOk(pos); startWatch(); },
    gpsErr,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function gpsDot(s) {
  const d = document.getElementById('gps-dot');
  d.className = 'gps-dot' + (s === 'active' ? ' active' : s === 'searching' ? ' searching' : '');
}

function renderSpeed() {
  const spd = Math.round(S.gps.speed);
  document.getElementById('speed-val').textContent = spd;
  el('m-accuracy').textContent = S.gps.accuracy != null ? `±${Math.round(S.gps.accuracy)} m` : '—';
  el('m-altitude').textContent = S.gps.altitude != null ? `${Math.round(S.gps.altitude)} m` : '—';
  el('m-heading').textContent  = S.gps.heading  != null ? `${Math.round(S.gps.heading)}°`  : '—';
}

// ══════════════════════════════════════════════════════════════
//  HAVERSINE
// ══════════════════════════════════════════════════════════════
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ══════════════════════════════════════════════════════════════
//  CHRONO
// ══════════════════════════════════════════════════════════════
function chronoToggle() {
  const btn = el('btn-chrono-toggle');
  if (S.chrono.running) {
    S.chrono.accumulated += Date.now() - S.chrono.startMs;
    S.chrono.running = false;
    cancelAnimationFrame(S.chrono.raf);
    btn.textContent = 'START';
    btn.className = 'btn btn-pri';
  } else {
    S.chrono.startMs = Date.now();
    S.chrono.running = true;
    btn.textContent = 'STOP';
    btn.className = 'btn btn-danger';
    chronoFrame();
  }
}

function chronoReset() {
  cancelAnimationFrame(S.chrono.raf);
  S.chrono.running = false;
  S.chrono.startMs = null;
  S.chrono.accumulated = 0;
  el('btn-chrono-toggle').textContent = 'START';
  el('btn-chrono-toggle').className = 'btn btn-pri';
  el('chrono-disp').textContent = '00:00.0';
}

function chronoFrame() {
  const tot = S.chrono.accumulated + (S.chrono.running ? Date.now() - S.chrono.startMs : 0);
  el('chrono-disp').textContent = fmtChrono(tot / 1000);
  if (S.chrono.running) S.chrono.raf = requestAnimationFrame(chronoFrame);
}

function fmtChrono(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const d = Math.floor((s % 1) * 10);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}.${d}`;
  return `${pad(m)}:${pad(sec)}.${d}`;
}

function fmtSec(s) {
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = Math.floor(abs % 60);
  if (m > 0) return `${m}:${pad(sec)}`;
  return `${sec}`;
}

function pad(n) { return n.toString().padStart(2, '0'); }

// Durată cu unitate corectă: "3:00 min" peste un minut, "45 sec" sub
function fmtSecU(s) {
  return Math.abs(s) >= 60 ? `${fmtSec(s)} min` : `${fmtSec(s)} sec`;
}

// ══════════════════════════════════════════════════════════════
//  RT — SETUP (model pe segmente de medie)
// ══════════════════════════════════════════════════════════════
// Un RT e o listă de segmente { from: km_start, speed: km/h }, primul de la 0.
// Vechiul model (o viteză, eventual o schimbare la mijloc) e doar cazul cu 1-2 segmente.

// Citește segmentele din UI: viteza de bază (rt-spd) + rândurile de schimbări (#rt-segs).
function rtReadSegments() {
  const base = parseFloat(el('rt-spd').value) || 40;
  const segs = [{ from: 0, speed: base }];
  el('rt-segs').querySelectorAll('.seg-row').forEach(row => {
    const km = parseFloat(row.querySelector('.seg-km').value);
    const sp = parseFloat(row.querySelector('.seg-spd').value);
    if (km > 0 && sp > 0) segs.push({ from: km, speed: sp });
  });
  segs.sort((a, b) => a.from - b.from);
  return segs;
}

// Timp ideal (secunde) pentru a parcurge `dist` km pe segmentele date.
function segIdealTime(dist, segs) {
  let t = 0;
  for (let i = 0; i < segs.length; i++) {
    const from = segs[i].from;
    const to = (i + 1 < segs.length) ? segs[i + 1].from : Infinity;
    if (dist <= from) break;
    t += (Math.min(dist, to) - from) * 3600 / segs[i].speed;
  }
  return t;
}

// Viteza țintă activă la distanța `dist`.
function segPhaseSpeed(dist, segs) {
  let s = segs[0].speed;
  for (const seg of segs) if (dist >= seg.from - 1e-9) s = seg.speed;
  return s;
}

// Adaugă un rând de schimbare de medie în editor.
function rtAddSegRow(km, spd) {
  const row = document.createElement('div');
  row.className = 'seg-row';
  row.innerHTML =
    '<input type="number" class="seg-km"  placeholder="la km" min="0.01" step="0.01" inputmode="decimal">' +
    '<input type="number" class="seg-spd" placeholder="km/h"  min="1"    step="0.1"  inputmode="decimal">' +
    '<button class="btn btn-danger btn-sm seg-del" type="button">✕</button>';
  if (km  != null) row.querySelector('.seg-km').value  = km;
  if (spd != null) row.querySelector('.seg-spd').value = spd;
  row.querySelector('.seg-km').addEventListener('input', rtPreview);
  row.querySelector('.seg-spd').addEventListener('input', rtPreview);
  row.querySelector('.seg-del').addEventListener('click', () => { row.remove(); rtPreview(); });
  el('rt-segs').appendChild(row);
  rtPreview();
}

// Calibrare odometru: din ce-a arătat app-ul vs distanța reală a secțiunii etalon.
function rtCalibrate() {
  const measured = parseFloat(prompt('Câți km a ARĂTAT aplicația pe secțiunea de probă?'));
  if (!measured || measured <= 0) return;
  const real = parseFloat(prompt('Câți km are REAL secțiunea (din roadbook)?'));
  if (!real || real <= 0) return;
  const corr = (real / measured - 1) * 100;
  el('rt-distcorr').value = corr.toFixed(1);
  ls('rali_distcorr', corr.toFixed(1));
  alert(`Corecție distanță setată: ${corr >= 0 ? '+' : ''}${corr.toFixed(1)}%`);
}

function rtPreview() {
  const dst  = parseFloat(el('rt-dst').value) || 2;
  const segs = rtReadSegments();
  const total = segIdealTime(dst, segs);
  const half  = segIdealTime(dst / 2, segs);
  let html = `Timp ideal total: <strong>${fmtSecU(total)}</strong>&nbsp;&nbsp;La 50%: ${fmtSecU(half)}`;
  if (segs.length > 1) {
    html += '<br>' + segs.slice(1).map(s => `↻ ${s.from.toFixed(2)} km → ${s.speed} km/h`).join(' &nbsp;·&nbsp; ');
  }
  el('rt-preview').innerHTML = html;
}

function rtStart() {
  S.rt.totalDist = parseFloat(el('rt-dst').value) || 2;
  S.rt.type      = document.querySelector('input[name="rt-type"]:checked').value;
  S.rt.segments  = rtReadSegments();
  S.rt.targetSpd = S.rt.segments[0].speed;
  S.rt.distFactor = 1 + ((parseFloat(el('rt-distcorr').value) || 0) / 100);
  ls('rali_distcorr', String(parseFloat(el('rt-distcorr').value) || 0));
  S.rt.voiceThresh = Math.max(1, parseFloat(el('rt-voicethr').value) || 3);
  ls('rali_voicethr', String(S.rt.voiceThresh));
  S.rt.segAnnounced = {};
  S.rt.startMs   = Date.now();
  S.rt.distKm    = 0;
  S.rt.lastPos   = S.gps.lat ? { lat: S.gps.lat, lng: S.gps.lng } : null;
  S.rt.active    = true;
  S.rt.finishing = false;

  el('rt-setup').classList.add('hidden');
  el('rt-live').classList.remove('hidden');
  el('rt-badge').classList.remove('hidden');
  el('s-phase-row').classList.toggle('hidden', S.rt.segments.length <= 1);

  S.rt.tickId = setInterval(rtRender, 250);
  S.voice.rtLastMs = 0; S.voice.rtLastDev = null; S.voice.paceOut = false;
  const startType = S.rt.type === 'standing' ? 'standing start' : 'start';
  const nChg = S.rt.segments.length - 1;
  const chgTxt = nChg > 0 ? `, cu ${nChg} ${nChg === 1 ? 'schimbare' : 'schimbări'} de medie` : '';
  speak(`RT pornit — ${S.rt.targetSpd} km pe oră — ${startType}${chgTxt}`);
  vibrate([30]);
}

function rtStop() {
  S.rt.active = false; S.rt.finishing = false;
  clearInterval(S.rt.tickId);
  el('rt-live').classList.add('hidden');
  el('rt-setup').classList.remove('hidden');
  el('rt-badge').classList.add('hidden');
  vibrate([50, 50, 50]);
}

// ══════════════════════════════════════════════════════════════
//  RT — GPS TICK
// ══════════════════════════════════════════════════════════════
function rtGpsTick(pos) {
  if (!S.rt.active) return;
  const acc = pos.coords.accuracy;
  if (acc && acc > 60) return; // skip noisy fix

  const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  if (S.rt.lastPos) {
    const d = haversine(S.rt.lastPos.lat, S.rt.lastPos.lng, cur.lat, cur.lng);
    if (d < 0.5) S.rt.distKm += d * (S.rt.distFactor || 1); // calibrare + sanity cap
  }
  S.rt.lastPos = cur;
}

// ══════════════════════════════════════════════════════════════
//  RT — RENDER
// ══════════════════════════════════════════════════════════════
function rtRender() {
  if (!S.rt.active) return;

  const segs     = S.rt.segments;
  const elapsedS = (Date.now() - S.rt.startMs) / 1000;
  const dist     = S.rt.distKm;
  const total    = S.rt.totalDist;

  const idealS   = segIdealTime(dist, segs);             // timp ideal pt dist parcursă
  const devS     = elapsedS - idealS;                    // + = în urmă, - = în avans
  const remaining = Math.max(0, total - dist);
  const pct      = Math.min(100, (dist / total) * 100);
  const phaseSpd = segPhaseSpeed(dist, segs);            // viteza țintă acum

  // Required speed to recover deviation on remaining segment
  let reqSpd = null;
  if (remaining > 0.001) {
    const remIdealS = segIdealTime(total, segs) - idealS;
    const remActualS = remIdealS - devS;
    reqSpd = remActualS > 1 ? (remaining * 3600) / remActualS : null;
  }

  // Voice: anunță fiecare schimbare de medie la trecerea pragului ei
  for (let i = 1; i < segs.length; i++) {
    if (!S.rt.segAnnounced[i] && dist >= segs[i].from - 0.05) {
      S.rt.segAnnounced[i] = true;
      speak(`Schimbare viteză — ${segs[i].speed} km pe oră`);
      vibrate([60, 40, 60]);
    }
  }

  // Deviation display
  const absD = Math.abs(devS);
  const sign = devS >= 0 ? '+' : '−';
  const arrow = devS >= 0 ? '▲' : '▼';   // ▲ = în urmă (mai repede), ▼ = în avans (mai lent)
  el('dev-num').textContent = sign + absD.toFixed(1);
  el('dev-lbl').textContent = devS >= 0 ? `${arrow} secunde în urmă` : `${arrow} secunde în avans`;

  const cls = absD <= 5 ? 'ok' : absD <= 15 ? 'warn' : 'bad';
  el('dev-num').className = `dev-num ${cls}`;
  el('dev-box').className = `dev-box ${cls}`;

  // Alert vibrations at thresholds (gate: max 1x per second window)
  if (absD > 15 && Math.floor(elapsedS) % 10 === 0 && (elapsedS % 10) < 0.3) vibrate([100]);

  // Stats
  el('s-elapsed').textContent  = fmtSec(elapsedS) + ' s';
  el('s-ideal').textContent    = fmtSec(idealS) + ' s';
  el('s-dist').textContent     = dist.toFixed(3) + ' km';
  el('s-rem').textContent      = remaining.toFixed(3) + ' km';
  if (segs.length > 1) el('s-phase').textContent = phaseSpd.toFixed(1) + ' km/h';

  if (remaining < 0.01) {
    el('s-reqspd').textContent = 'FINISH';
    el('s-reqspd').style.color = 'var(--green)';
  } else if (reqSpd === null) {
    el('s-reqspd').textContent = 'IMPOSIBIL ⚠';
    el('s-reqspd').style.color = 'var(--red)';
  } else {
    el('s-reqspd').textContent = reqSpd.toFixed(1) + ' km/h';
    el('s-reqspd').style.color = '';
  }

  el('prog-fill').style.width  = pct + '%';
  el('prog-pct').textContent   = Math.round(pct) + '%';

  // Voce de pace: anunță la trecerea pragului (imediat), apoi repetă la ~8s cât ești
  // în afara pragului; când revii sub prag, confirmă „în pace". Pragul e reglabil.
  const nowMs = Date.now();
  const thr = S.rt.voiceThresh || 3;
  if (elapsedS > 5) {
    if (absD > thr) {
      const justCrossed = !S.voice.paceOut;
      if (justCrossed || nowMs - S.voice.rtLastMs > 8000) {
        const dir = devS > 0 ? 'în urmă' : 'în avans';
        const action = devS > 0
          ? (absD > 15 ? 'mult mai repede' : absD > 7 ? 'mai repede' : 'ușor mai repede')
          : (absD > 15 ? 'mult mai lent'   : absD > 7 ? 'mai lent'   : 'ușor mai lent');
        const spdStr = reqSpd ? `, ${Math.round(reqSpd)} km pe oră` : '';
        speakIfIdle(`${Math.round(absD)} secunde ${dir}, ${action}${spdStr}`);
        S.voice.rtLastMs = nowMs; S.voice.paceOut = true;
      }
    } else if (S.voice.paceOut) {
      S.voice.paceOut = false; S.voice.rtLastMs = nowMs;
      speakIfIdle('În pace.');
    }
  }

  // Auto-stop when done (guard against repeat calls every 250ms)
  if (pct >= 100 && dist >= total - 0.01 && !S.rt.finishing) {
    S.rt.finishing = true;
    speak('Finish RT.');
    setTimeout(() => { if (S.rt.active) { S.rt.finishing = false; rtStop(); } }, 1500);
  }
}

// ══════════════════════════════════════════════════════════════
//  VISION — camera + Claude multimodal
// ══════════════════════════════════════════════════════════════
function openCamera(onData) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.capture = 'environment';
  inp.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
  inp.onchange = () => {
    document.body.removeChild(inp);
    const file = inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onData(reader.result.split(',')[1], file.type);
    reader.readAsDataURL(file);
  };
  document.body.appendChild(inp);
  inp.click();
}

async function callClaudeVision(b64, mime, textPrompt, maxTok, sysPrompt, modelOverride) {
  const key = S.cfg.apiKey;
  if (!key) throw new Error('Adaugă API Key în SETĂRI.');
  const body = {
    model: modelOverride || S.cfg.model,
    max_tokens: maxTok || 300,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text: textPrompt }
      ]
    }]
  };
  if (sysPrompt) body.system = sysPrompt;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `HTTP ${res.status}`);
  }
  const j = await res.json();
  return j.content[0].text.trim();
}

async function rtScan() {
  if (!S.cfg.apiKey) { alert('Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    const btn = el('btn-rt-scan');
    const sta = el('rt-scan-status');
    btn.textContent = '⏳ Analizez...';
    btn.disabled = true;
    sta.className = 'scan-status';
    sta.style.color = 'var(--dim)';
    sta.textContent = '';
    try {
      const raw = await callClaudeVision(b64, mime,
        `Ești copilotul de raliu. Analizează roadbook-ul din fotografie și extrage parametrii RT (Regularity Test).
Returnează DOAR JSON valid, fără alt text:
{"speed": 40.0, "distance": 5.74, "start": "standing", "changes": [{"km": 3.06, "speed": 45.0}], "note": "RT 4"}
- speed = viteza medie impusă inițială în km/h (număr zecimal)
- distance = distanța totală RT în km (număr zecimal)
- start = "standing" (start din loc, simbol cu fulg/snowflake) sau "auto" (start din mers)
- changes = lista schimbărilor de medie pe parcurs: la ce km se schimbă și noua viteză. [] dacă viteza e constantă.
- note = identificator scurt (ex: "RT 4", "TR 1")
Dacă nu identifici un parametru cu siguranță, pune null (sau [] pentru changes).`, 300);

      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error('Format neașteptat');
      const d = JSON.parse(match[0]);

      if (d.speed != null)    el('rt-spd').value = d.speed;
      if (d.distance != null) el('rt-dst').value = d.distance;
      if (d.start === 'standing') document.querySelector('input[name="rt-type"][value="standing"]').checked = true;
      if (d.start === 'auto')     document.querySelector('input[name="rt-type"][value="auto"]').checked     = true;
      el('rt-segs').innerHTML = '';
      (Array.isArray(d.changes) ? d.changes : []).forEach(c => {
        if (c && c.km > 0 && c.speed > 0) rtAddSegRow(c.km, c.speed);
      });
      rtPreview();

      const spd = d.speed    != null ? `${d.speed} km/h` : '? km/h';
      const dst = d.distance != null ? `${d.distance} km` : '? km';
      const stt = d.start === 'standing' ? 'standing start' : d.start === 'auto' ? 'auto-start' : '?';
      sta.textContent = `✓ ${d.note ? d.note + ': ' : ''}${spd} · ${dst} · ${stt}`;
      sta.style.color = 'var(--green)';
    } catch (e) {
      sta.textContent = `✗ ${e.message}`;
      sta.style.color = 'var(--red)';
    } finally {
      btn.disabled = false;
      btn.textContent = '📷 Scanează roadbook';
    }
  });
}

async function chatPhoto() {
  if (S.chat.busy) return;
  if (!S.cfg.apiKey) { addMsg('bot', 'Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    const txt = el('chat-in').value.trim();
    el('chat-in').value = '';
    addMsg('user', '📷' + (txt ? ' ' + txt : ' [foto]'));
    addTyping();
    S.chat.busy = true;
    el('btn-chat-photo').disabled = true;
    try {
      const ctx = rtContext();
      const prompt = [ctx, txt || 'Analizează fotografia și spune-mi ce e relevant pentru ralie.'].filter(Boolean).join('\n');
      const reply = await callClaudeVision(b64, mime, prompt, 400, SYSTEM);
      removeTyping();
      addMsg('bot', reply);
    } catch (e) {
      removeTyping();
      addMsg('bot', `Eroare: ${e.message}`);
    } finally {
      S.chat.busy = false;
      el('btn-chat-photo').disabled = false;
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  SPEECH (Web Speech API — fără API calls)
// ══════════════════════════════════════════════════════════════
const DIR_ARROW = {
  'ÎNAINTE':'↑', 'STÂNGA':'←', 'DREAPTA':'→',
  'STÂNGA-T':'↰', 'DREAPTA-T':'↱',
  'GIRATORIU-1':'①', 'GIRATORIU-2':'②', 'GIRATORIU-3':'③', 'GIRATORIU-4':'④',
  'STOP-CFR':'⛔', 'TC':'🏁', 'RT_START_AUTO':'⚡', 'RT_START_STANDING':'⚡❄',
  'RT_FINISH':'🏳', 'PARKING':'🅿', 'EV':'🔌'
};
const DIR_VOICE = {
  'ÎNAINTE':'înainte', 'STÂNGA':'stânga', 'DREAPTA':'dreapta',
  'STÂNGA-T':'stânga la T', 'DREAPTA-T':'dreapta la T',
  'GIRATORIU-1':'prima ieșire', 'GIRATORIU-2':'a doua ieșire',
  'GIRATORIU-3':'a treia ieșire', 'GIRATORIU-4':'a patra ieșire',
  'STOP-CFR':'STOP cale ferată'
};

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ro-RO'; u.rate = 1.1; u.volume = 1.0;
  // 50ms delay: Android Chrome drops speak() called immediately after cancel()
  setTimeout(() => window.speechSynthesis.speak(u), 50);
}

function speakIfIdle(text) {
  if (!window.speechSynthesis || window.speechSynthesis.speaking) return;
  speak(text);
}

// ══════════════════════════════════════════════════════════════
//  ROAD NAV — scan roadbook pages + GPS navigation + voice
// ══════════════════════════════════════════════════════════════
const NAV_SCAN_PROMPT = `Ești copilot de raliu. Extrage TOATE boxurile vizibile pe această pagină de roadbook în format JSON array.

COLOANE (stânga→dreapta): Număr box | Sum km (bold) | Sum mile (ignoră) | Section km (bold) | Section mile (ignoră) | Diagrama tulip | Dist to target (ignoră) | Comment text

DIAGRAMA TULIP — interpretează vizual direcția:
"ÎNAINTE"=drept înainte, "STÂNGA"=viraj simplu stânga, "DREAPTA"=viraj simplu dreapta,
"STÂNGA-T"=T-junction viraj stânga, "DREAPTA-T"=T-junction viraj dreapta,
"GIRATORIU-1"/"GIRATORIU-2"/"GIRATORIU-3"/"GIRATORIU-4"=ieșirea 1/2/3/4 din sens giratoriu,
"STOP-CFR"=trecere cale ferată cu oprire

ICOANE DEASUPRA DIAGRAMEI → câmpul "flag":
steag+ceas (fără fulg de nea)="RT_START_AUTO" | steag+ceas+fulg de nea="RT_START_STANDING"
dreptunghi+steag="RT_FINISH" | ceas+steag mare="TC" | P mare="PARKING" | fulger/priză="EV"
Waypoint normal fără icoane speciale: flag=null

Format de returnare — DOAR JSON array valid, fără alt text:
[{"num":67,"sumKm":19.72,"sectionKm":2.31,"dir":"STÂNGA-T","comment":"Receptie Bar / DJ 582B","flag":"RT_START_AUTO"},...]

Toate boxurile de pe pagină, în ordine crescătoare a numărului.`;

async function navScan() {
  if (!S.cfg.apiKey) { alert('Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    const btn = el('btn-nav-scan');
    const sta = el('nav-scan-status');
    btn.disabled = true; btn.textContent = '⏳ Scanez...';
    sta.className = 'scan-status'; sta.style.color = 'var(--dim)'; sta.textContent = '';
    try {
      const raw = await callClaudeVision(b64, mime, NAV_SCAN_PROMPT, 1000, null, 'claude-sonnet-4-6');
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Format neașteptat');
      const boxes = JSON.parse(match[0]);
      if (!Array.isArray(boxes) || !boxes.length) throw new Error('Niciun box identificat');

      const map = new Map(S.road.boxes.map(b => [`${b.num}_${Math.round(b.sumKm*100)}`, b]));
      boxes.forEach(b => map.set(`${b.num}_${Math.round(b.sumKm*100)}`, b));
      S.road.boxes = Array.from(map.values()).sort((a, b) => a.sumKm - b.sumKm);
      ls('rali_road', JSON.stringify(S.road.boxes));
      navUpdateList();

      sta.textContent = `✓ ${boxes.length} boxuri adăugate — total ${S.road.boxes.length}`;
      sta.style.color = 'var(--green)';
    } catch (e) {
      sta.textContent = `✗ ${e.message}`; sta.style.color = 'var(--red)';
    } finally {
      btn.disabled = false; btn.textContent = '📷 Adaugă pagină roadbook';
    }
  });
}

function navUpdateList() {
  const n = S.road.boxes.length;
  // sumKm poate lipsi (null) dacă scanarea roadbook-ului nu l-a extras pentru un box;
  // fără gardă, .toFixed pe null arunca si bloca tot init-ul (inclusiv GPS-ul).
  const fmtKm = v => (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : '?';
  el('nav-box-count').textContent = n === 0 ? '— niciun box scanat' :
    `${n} boxuri · ${fmtKm(S.road.boxes[0].sumKm)} – ${fmtKm(S.road.boxes[n-1].sumKm)} km`;
  el('btn-nav-start').disabled = n === 0;
}

function navClear() {
  if (!confirm('Ștergi toate boxurile scanate?')) return;
  S.road.boxes = []; ls('rali_road', '[]'); navUpdateList();
}

function navStart() {
  if (!S.road.boxes.length) return;
  S.road.active = true; S.road.legDistKm = 0; S.road.announced = {};
  S.road.lastPos = S.gps.lat ? { lat: S.gps.lat, lng: S.gps.lng } : null;
  // Skip boxes within 80m to avoid voice spam at start
  const firstIdx = S.road.boxes.findIndex(b => b.sumKm > 0.08);
  S.road.nextIdx = firstIdx === -1 ? 0 : firstIdx;
  el('nav-setup').classList.add('hidden');
  el('nav-active').classList.remove('hidden');
  S.road.tickId = setInterval(navRender, 500);
  speak('Navigare pornită.');
}

function navStop() {
  S.road.active = false; clearInterval(S.road.tickId);
  window.speechSynthesis?.cancel();
  el('nav-active').classList.add('hidden');
  el('nav-setup').classList.remove('hidden');
}

function navGpsTick(pos) {
  const acc = pos.coords.accuracy;
  if (acc && acc > 60) return;
  const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  if (S.road.lastPos) {
    const d = haversine(S.road.lastPos.lat, S.road.lastPos.lng, cur.lat, cur.lng);
    if (d < 0.5) S.road.legDistKm += d;
  }
  S.road.lastPos = cur;
}

function navRender() {
  if (!S.road.active) return;
  const dist = S.road.legDistKm;
  el('nav-pos-km').textContent = dist.toFixed(3) + ' km';

  // Advance past already-passed boxes
  while (S.road.nextIdx < S.road.boxes.length &&
         dist > S.road.boxes[S.road.nextIdx].sumKm + 0.08) {
    S.road.nextIdx++;
  }

  const boxes = S.road.boxes;
  const ni = S.road.nextIdx;

  if (ni >= boxes.length) {
    el('nav-dir-next').textContent = 'FINISH LEG'; el('nav-dist-next').textContent = '—';
    el('nav-comment-next').textContent = ''; el('nav-boxnum-next').textContent = '';
    el('nav-after-text').textContent = '—'; return;
  }

  const next = boxes[ni];
  const distToNext = Math.max(0, next.sumKm - dist);
  const arrow  = DIR_ARROW[next.dir]  || next.dir  || '?';
  const fArrow = DIR_ARROW[next.flag] || '';

  el('nav-dist-next').textContent    = distToNext < 0.1 ?
    `${Math.round(distToNext * 1000)} m` : `${distToNext.toFixed(2)} km`;
  el('nav-dir-next').textContent     = arrow + (fArrow ? ' ' + fArrow : '');
  el('nav-comment-next').textContent = next.comment || '';
  el('nav-boxnum-next').textContent  = `Box ${next.num}`;

  if (ni + 1 < boxes.length) {
    const af = boxes[ni + 1];
    el('nav-after-text').textContent =
      `Box ${af.num} · ${af.sectionKm != null ? af.sectionKm.toFixed(2) + ' km' : '?'} · ${DIR_ARROW[af.dir]||af.dir||'?'}` +
      (af.flag ? ' '+DIR_ARROW[af.flag] : '') + (af.comment ? ' · '+af.comment : '');
  } else {
    el('nav-after-text').textContent = '— finish leg —';
  }

  // Voice announcements
  const key = `${next.num}_${Math.round(next.sumKm * 100)}`;
  const voice = DIR_VOICE[next.dir] || next.dir || 'manevra';
  const flag  = next.flag;

  if (distToNext <= 0.35 && !S.road.announced[key + 'w']) {
    S.road.announced[key + 'w'] = true;
    const m = Math.round(distToNext * 1000);
    let txt = `Pregătire — ${voice} în ${m} metri`;
    if (flag === 'TC')   txt = `Time Control în ${m} metri — pregătește time card`;
    else if (flag === 'RT_START_AUTO' || flag === 'RT_START_STANDING')
      txt = `Start RT în ${m} metri`;
    else if (flag === 'RT_FINISH') txt = `Finish RT în ${m} metri`;
    else if (flag === 'STOP-CFR')  txt = `ATENȚIE — cale ferată în ${m} metri — vei opri`;
    else if (flag === 'EV')        txt = `Stație de încărcare în ${m} metri`;
    else if (flag === 'PARKING')   txt = `Parcare în ${m} metri`;
    if (flag === 'EV') vibrate([40, 30, 40, 30, 40]);
    speak(txt);
  } else if (distToNext <= 0.08 && !S.road.announced[key + 'n']) {
    S.road.announced[key + 'n'] = true;
    let txt = voice;
    if (flag === 'TC')   txt = 'Time Control — oprește și ștampilează';
    else if (flag === 'RT_START_STANDING') txt = 'START RT — standing start';
    else if (flag === 'RT_START_AUTO')     txt = 'START RT';
    else if (flag === 'RT_FINISH')         txt = 'FINISH RT';
    else if (flag === 'STOP-CFR')          txt = 'STOP — cale ferată';
    else if (flag === 'EV')                txt = 'Stație de încărcare';
    else if (flag === 'PARKING')           txt = 'Parcare';
    speak(txt);
  }
}

// ══════════════════════════════════════════════════════════════
//  CLAUDE API
// ══════════════════════════════════════════════════════════════
const SYSTEM = `Ești RALI, copilotul virtual al lui Andreas Suciu la Transilvania eCLASIC 2026 (regularitate 100% electric, A.R.E.S. Championship).
Mașina: Tesla Model Y Juniper AWD Long Range — 82 kWh, consum munte ~20 kWh/100 km, autonomie munte 280-320 km la 100%.
Regularitate: 1 punct = 1 secundă deviere. TC = time control cu ștampilă (300 pct dacă blochezi alt echipaj). RT = test timed — menții viteză medie.
Formula RT: timp ideal (s) = (km × 3600) ÷ viteză medie. Deviere + = în urmă. Deviere - = în avans.
Rezultat Reșița 2026 (etapa 1): loc 14/22, 339.7 pct — TR4 pierdut (viteze mici <30 km/h, mers instinctiv prea repede).
Calendar: Sibiu 6-8 aug | Sinaia 11-12 sep | Iași-Chișinău 9-10 oct | Christmas Tour 4-5 dec.
Răspunde în română, SCURT (max 3 rânduri). Direcțiile cu MAJUSCULE. Calculezi calm, nu panicăm.`;

function rtContext() {
  if (!S.rt.active) return '';
  const el_ = (Date.now() - S.rt.startMs) / 1000;
  const idealS = (S.rt.distKm * 3600) / S.rt.targetSpd;
  const dev = el_ - idealS;
  return `[RT activ: ${S.rt.targetSpd} km/h țintă, deviere ${dev>=0?'+':''}${dev.toFixed(1)}s, `+
         `distanță ${S.rt.distKm.toFixed(3)}/${S.rt.totalDist} km, viteză GPS ${Math.round(S.gps.speed)} km/h]`;
}

async function callClaude(msg) {
  const key = S.cfg.apiKey;
  if (!key) return 'Adaugă Claude API Key în tab-ul SETĂRI.';
  const context = rtContext();
  const full = context ? context + '\n\n' + msg : msg;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: S.cfg.model,
      max_tokens: 280,
      system: SYSTEM,
      messages: [{ role: 'user', content: full }]
    })
  });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `HTTP ${res.status}`);
  }
  const j = await res.json();
  return j.content[0].text.trim();
}

// ══════════════════════════════════════════════════════════════
//  CHAT UI
// ══════════════════════════════════════════════════════════════
function addMsg(role, text) {
  const wrap = el('chat-msgs');
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'msg-me' : 'msg-bot'}`;
  const bub = document.createElement('span');
  bub.className = 'bubble';
  bub.textContent = text;
  div.appendChild(bub);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function addTyping() {
  const wrap = el('chat-msgs');
  const div = document.createElement('div');
  div.id = 'typing';
  div.className = 'msg msg-bot';
  div.innerHTML = '<span class="bubble typing-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function removeTyping() { document.getElementById('typing')?.remove(); }

async function sendChat() {
  if (S.chat.busy) return;
  const input = el('chat-in');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  addMsg('user', msg);
  addTyping();
  S.chat.busy = true;
  el('btn-send').disabled = true;
  try {
    const reply = await callClaude(msg);
    removeTyping();
    addMsg('bot', reply);
  } catch (e) {
    removeTyping();
    addMsg('bot', `Eroare: ${e.message}`);
  } finally {
    S.chat.busy = false;
    el('btn-send').disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
//  WAKE LOCK
// ══════════════════════════════════════════════════════════════
let _wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    el('wake-icon').classList.add('on');
    _wakeLock.addEventListener('release', () => {
      el('wake-icon').classList.remove('on');
      // re-acquire when tab becomes visible again
    });
  } catch (_) {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquireWakeLock();
});

// ══════════════════════════════════════════════════════════════
//  RT PRESETS
// ══════════════════════════════════════════════════════════════
function renderPresets() {
  const row = el('preset-row');
  row.innerHTML = '';
  S.presets.forEach((p, i) => {
    const chip = document.createElement('button');
    chip.className = 'preset-chip';
    const nChg = p.changes ? p.changes.length : (p.spd2 ? 1 : 0);
    const chgTxt = nChg ? `+${nChg}` : '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;                       // textContent: fără injecție HTML
    const pxSpan = document.createElement('span');
    pxSpan.className = 'px';
    pxSpan.textContent = `${p.spd}${chgTxt}·${p.dist}km`;
    chip.append(nameSpan, pxSpan);

    let lpFired = false, lp;
    chip.addEventListener('click', () => {
      if (lpFired) { lpFired = false; return; }           // suprimă click după long-press
      applyPreset(i);
    });
    chip.addEventListener('contextmenu', e => { e.preventDefault(); lpFired = true; deletePreset(i); });
    chip.addEventListener('touchstart', () => {
      lpFired = false;
      lp = setTimeout(() => { lpFired = true; deletePreset(i); }, 700);
    }, { passive: true });
    chip.addEventListener('touchend', () => clearTimeout(lp));
    chip.addEventListener('touchmove', () => clearTimeout(lp), { passive: true });
    row.appendChild(chip);
  });
  const add = document.createElement('button');
  add.className = 'preset-chip preset-add';
  add.textContent = '+ salvează';
  add.addEventListener('click', savePreset);
  row.appendChild(add);
}

function applyPreset(i) {
  const p = S.presets[i];
  el('rt-spd').value = p.spd;
  el('rt-dst').value = p.dist;
  document.querySelector(`input[name="rt-type"][value="${p.type}"]`).checked = true;
  // Schimbările pot veni din formatul nou (changes[]) sau cel vechi (spd2/changeKm).
  el('rt-segs').innerHTML = '';
  const changes = p.changes || (p.spd2 && p.changeKm ? [{ km: p.changeKm, speed: p.spd2 }] : []);
  changes.forEach(c => rtAddSegRow(c.km, c.speed));
  rtPreview();
  vibrate([20]);
}

function savePreset() {
  const name = prompt('Nume preset (ex: RT1):');
  if (!name) return;
  const segs = rtReadSegments();
  S.presets.push({
    name: name.trim().slice(0, 8),
    spd: segs[0].speed,
    dist: parseFloat(el('rt-dst').value) || 2,
    type: document.querySelector('input[name="rt-type"]:checked').value,
    changes: segs.slice(1).map(s => ({ km: s.from, speed: s.speed }))
  });
  ls('rali_presets', JSON.stringify(S.presets));
  renderPresets();
}

function deletePreset(i) {
  if (!confirm(`Ștergi presetul "${S.presets[i].name}"?`)) return;
  S.presets.splice(i, 1);
  ls('rali_presets', JSON.stringify(S.presets));
  renderPresets();
}

// ══════════════════════════════════════════════════════════════
//  TC DEPARTURE COUNTDOWN
// ══════════════════════════════════════════════════════════════
function tcSet() {
  const v = el('tc-time').value;
  if (!v) { alert('Pune ora de plecare.'); return; }
  const parts = v.split(':').map(Number);
  const now = new Date();
  const t = new Date();
  t.setHours(parts[0], parts[1], parts[2] || 0, 0);
  if (t.getTime() < now.getTime() - 1000) t.setDate(t.getDate() + 1); // dacă a trecut, mâine
  S.tc.targetMs = t.getTime();
  S.tc.announced = {};
  clearInterval(S.tc.tickId);
  S.tc.tickId = setInterval(tcTick, 200);
  speak(`Countdown setat pentru ora ${parts[0]} ${pad(parts[1])}`);
}

function tcSyncPlus1() {
  // plecare la minutul rotund următor; dacă e sub 20s, sare la cel de după
  const t = new Date();
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  if (t.getTime() - Date.now() < 20000) t.setMinutes(t.getMinutes() + 1);
  S.tc.targetMs = t.getTime();
  S.tc.announced = {};
  el('tc-time').value = `${pad(t.getHours())}:${pad(t.getMinutes())}:00`;
  clearInterval(S.tc.tickId);
  S.tc.tickId = setInterval(tcTick, 200);
  vibrate([20]);
}

function tcStop() {
  clearInterval(S.tc.tickId);
  S.tc.targetMs = null;
  el('tc-display').textContent = '--:--';
  el('tc-display').className = 'cd-display';
}

function tcTick() {
  if (!S.tc.targetMs) return;
  const remMs = S.tc.targetMs - Date.now();
  const rem = remMs / 1000;
  const disp = el('tc-display');

  if (rem <= 0) {
    disp.textContent = 'GO!';
    disp.className = 'cd-display go';
    if (!S.tc.announced.go) { S.tc.announced.go = true; speak('Pleacă! GO!'); vibrate([200, 80, 200]); }
    if (rem < -3) tcStop();
    return;
  }

  const m = Math.floor(rem / 60);
  const s = Math.floor(rem % 60);
  disp.textContent = `${m}:${pad(s)}`;
  disp.className = 'cd-display' + (rem <= 5 ? ' now' : rem <= 30 ? ' soon' : '');

  // Anunțuri vocale
  const sec = Math.ceil(rem);
  const marks = { 60:'60 secunde', 30:'30 secunde', 10:'10 secunde', 5:'5', 4:'4', 3:'3', 2:'2', 1:'1' };
  if (marks[sec] && !S.tc.announced[sec] && rem <= sec && rem > sec - 0.25) {
    S.tc.announced[sec] = true;
    speak(marks[sec]);
    if (sec <= 5) vibrate([80]);
  }
}

// ══════════════════════════════════════════════════════════════
//  BATTERY CALCULATOR
// ══════════════════════════════════════════════════════════════
const BATT_KWH = 82;
function battCalc() {
  const now  = parseFloat(el('batt-now').value)  || 0;
  const km   = parseFloat(el('batt-km').value)   || 0;
  const cons = parseFloat(el('batt-cons').value) || 20;
  const kwhNeed = km * cons / 100;
  const pctNeed = (kwhNeed / BATT_KWH) * 100;
  const pctEnd  = now - pctNeed;
  const out = el('batt-out');

  let cls, msg, voice;
  if (pctEnd >= 15) {
    cls = 'var(--green)';
    msg = `Finish estimat la <span class="big" style="color:${cls}">${pctEnd.toFixed(0)}%</span> — OK, peste buffer-ul de 15%.`;
    voice = `Baterie suficientă. Finish estimat la ${pctEnd.toFixed(0)} la sută.`;
  } else if (pctEnd >= 5) {
    cls = 'var(--yellow)';
    msg = `Finish estimat la <span class="big" style="color:${cls}">${pctEnd.toFixed(0)}%</span> — sub buffer-ul de 15%. Condu economic, regenerare Hold.`;
    voice = `Atenție. Finish estimat la ${pctEnd.toFixed(0)} la sută, sub buffer. Condu economic.`;
  } else {
    cls = 'var(--red)';
    msg = `Finish estimat la <span class="big" style="color:${cls}">${pctEnd.toFixed(0)}%</span> — INSUFICIENT. Planifică încărcare pe traseu.`;
    voice = `Baterie insuficientă. Finish estimat la ${pctEnd.toFixed(0)} la sută. Recomand încărcare pe traseu.`;
  }
  out.innerHTML = `${msg}<br><span style="color:var(--dim)">Consum estimat: ${kwhNeed.toFixed(1)} kWh (${pctNeed.toFixed(0)}% baterie) pentru ${km} km.</span>`;
  speak(voice);
}

// ══════════════════════════════════════════════════════════════
//  PENALTY TRACKER
// ══════════════════════════════════════════════════════════════
function renderPenalties() {
  const list = el('pen-list');
  list.innerHTML = '';
  let total = 0;
  for (let i = 1; i <= 6; i++) {
    const key = 'RT' + i;
    const val = S.pen[key] != null ? S.pen[key] : '';
    if (val !== '') total += parseFloat(val) || 0;
    const row = document.createElement('div');
    row.className = 'pen-row';
    row.innerHTML = `<span class="lbl">${key}</span>`;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = '0.1'; inp.inputMode = 'decimal';
    inp.placeholder = '—'; inp.value = val;
    inp.addEventListener('input', () => {
      S.pen[key] = inp.value === '' ? null : parseFloat(inp.value);
      ls('rali_pen', JSON.stringify(S.pen));
      updatePenTotal();
    });
    row.appendChild(inp);
    const unit = document.createElement('span');
    unit.style.cssText = 'color:var(--dim);font-size:12px;'; unit.textContent = 'sec';
    row.appendChild(unit);
    list.appendChild(row);
  }
  el('pen-total').textContent = total.toFixed(1) + ' sec';
}

function updatePenTotal() {
  let total = 0;
  for (let i = 1; i <= 6; i++) total += parseFloat(S.pen['RT' + i]) || 0;
  el('pen-total').textContent = total.toFixed(1) + ' sec';
}

function resetPenalties() {
  if (!confirm('Resetezi toate penalizările?')) return;
  S.pen = {}; ls('rali_pen', '{}'); renderPenalties();
}

// ══════════════════════════════════════════════════════════════
//  VOICE INPUT (Speech-to-Text)
// ══════════════════════════════════════════════════════════════
function micToggle() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { addMsg('bot', 'Recunoaștere vocală indisponibilă pe acest browser.'); return; }
  // A doua apăsare = anulează (fără trimitere)
  if (S.rec.listening) { S.rec.cancelled = true; S.rec.obj?.stop(); return; }

  const rec = new SR();
  rec.lang = 'ro-RO'; rec.interimResults = false; rec.maxAlternatives = 1;
  S.rec.obj = rec; S.rec.listening = true; S.rec.cancelled = false;
  el('btn-chat-mic').classList.add('listening');

  rec.onresult = e => {
    const txt = e.results[0][0].transcript;
    el('chat-in').value = txt;
  };
  rec.onerror = () => {};
  rec.onend = () => {
    S.rec.listening = false;
    el('btn-chat-mic').classList.remove('listening');
    if (!S.rec.cancelled && el('chat-in').value.trim()) sendChat();
  };
  try {
    rec.start();
    vibrate([20]);
  } catch (e) {
    S.rec.listening = false;
    el('btn-chat-mic').classList.remove('listening');
  }
}

// ══════════════════════════════════════════════════════════════
//  QUIZ HELPER
// ══════════════════════════════════════════════════════════════
function quizHelper() {
  if (!S.cfg.apiKey) { addMsg('bot', 'Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    addMsg('user', '📸 [quiz time card]');
    addTyping();
    S.chat.busy = true;
    try {
      const reply = await callClaudeVision(b64, mime,
        'Aceasta e o întrebare quiz de pe time card-ul unui raliu. Citește întrebarea și răspunde DIRECT și SCURT cu răspunsul corect. Dacă sunt variante, spune litera + textul.',
        300, SYSTEM);
      removeTyping();
      addMsg('bot', reply);
    } catch (e) {
      removeTyping();
      addMsg('bot', `Eroare: ${e.message}`);
    } finally {
      S.chat.busy = false;
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════════════
const THEME_COLOR = { dark: '#0a0a0a', light: '#f1f1f4', night: '#000000' };
function applyTheme(t) {
  S.cfg.theme = t;
  ls('rali_theme', t);
  if (t === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[t] || '#0a0a0a');
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === t));
}

// ══════════════════════════════════════════════════════════════
//  NAV OFFSET
// ══════════════════════════════════════════════════════════════
function navOffset(meters) {
  S.road.legDistKm = Math.max(0, S.road.legDistKm + meters / 1000);
  // permite re-anunțarea boxurilor după corecție
  S.road.announced = {};
  vibrate([15]);
  if (S.road.active) navRender();
}

// ══════════════════════════════════════════════════════════════
//  UTIL
// ══════════════════════════════════════════════════════════════
function el(id) { return document.getElementById(id); }
function vibrate(pattern) { navigator.vibrate?.(pattern); }

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
function init() {
  // Legările de UI sunt grupate într-un try: dacă vreun element lipsește
  // (ex. HTML vechi din cache), nu mai blocăm pornirea GPS-ului de mai jos.
  try { bindUI(); } catch (err) { showFatal('init/bindUI: ' + err.message); }

  // Critice — rulează indiferent de erorile de mai sus:
  const bt = document.getElementById('build-tag');
  if (bt) bt.textContent = BUILD;
  try { acquireWakeLock(); } catch (_) {}
  try { gpsInit(); } catch (err) { showFatal('gpsInit: ' + err.message); }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }
}

function bindUI() {
  // Tab switching
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      el('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Chrono
  el('btn-chrono-toggle').addEventListener('click', chronoToggle);
  el('btn-chrono-reset').addEventListener('click', chronoReset);
  el('btn-gps-retry')?.addEventListener('click', gpsRetry);

  // RT
  el('rt-spd').addEventListener('input', rtPreview);
  el('rt-dst').addEventListener('input', rtPreview);
  el('rt-distcorr').value = ls('rali_distcorr') || '0';
  el('rt-voicethr').value = ls('rali_voicethr') || '3';
  el('btn-rt-calib').addEventListener('click', rtCalibrate);
  el('btn-rt-addseg').addEventListener('click', () => rtAddSegRow());
  el('btn-rt-start').addEventListener('click', rtStart);
  el('btn-rt-stop').addEventListener('click', rtStop);
  el('btn-rt-savepreset').addEventListener('click', savePreset);
  renderPresets();
  rtPreview();

  // Tools — TC countdown
  el('btn-tc-start').addEventListener('click', tcSet);
  el('btn-tc-sync').addEventListener('click', tcSyncPlus1);
  el('btn-tc-stop').addEventListener('click', tcStop);

  // Tools — battery
  el('btn-batt-calc').addEventListener('click', battCalc);

  // Tools — penalties
  renderPenalties();
  el('btn-pen-reset').addEventListener('click', resetPenalties);

  // Theme
  applyTheme(S.cfg.theme);
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.addEventListener('click', () => applyTheme(b.dataset.theme)));

  // NAV offset
  el('btn-off-m100').addEventListener('click', () => navOffset(-100));
  el('btn-off-m10').addEventListener('click',  () => navOffset(-10));
  el('btn-off-p10').addEventListener('click',  () => navOffset(10));
  el('btn-off-p100').addEventListener('click', () => navOffset(100));

  // Road Nav
  el('btn-nav-scan').addEventListener('click', navScan);
  el('btn-nav-clear').addEventListener('click', navClear);
  el('btn-nav-start').addEventListener('click', navStart);
  el('btn-nav-stop').addEventListener('click', navStop);
  navUpdateList();

  // RT Scan
  el('btn-rt-scan').addEventListener('click', rtScan);

  // Chat
  el('btn-send').addEventListener('click', sendChat);
  el('btn-chat-photo').addEventListener('click', chatPhoto);
  el('btn-chat-mic').addEventListener('click', micToggle);
  el('chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  document.querySelectorAll('.qbtn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.quiz) { quizHelper(); return; }
      el('chat-in').value = b.dataset.p;
      // switch to copilot tab if not already
      document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.nav-btn[data-tab="copilot"]').classList.add('active');
      el('tab-copilot').classList.add('active');
      sendChat();
    });
  });

  // Settings
  el('api-key').value    = S.cfg.apiKey;
  el('model-sel').value  = S.cfg.model;

  el('btn-save-key').addEventListener('click', () => {
    S.cfg.apiKey = el('api-key').value.trim();
    ls('rali_key', S.cfg.apiKey);
    const s = el('set-status');
    s.textContent = S.cfg.apiKey ? 'API key salvat ✓' : 'Key șters.';
    setTimeout(() => { s.textContent = ''; }, 2500);
  });

  el('btn-test-voice').addEventListener('click', () => {
    const sta = el('voice-status');
    if (!window.speechSynthesis) {
      sta.textContent = '✗ speechSynthesis indisponibil pe acest browser';
      sta.style.color = 'var(--red)'; return;
    }
    const voices = window.speechSynthesis.getVoices();
    const roVoice = voices.find(v => v.lang.startsWith('ro'));
    sta.style.color = roVoice ? 'var(--green)' : 'var(--yellow)';
    sta.textContent = roVoice
      ? `✓ Voce română găsită: ${roVoice.name}`
      : `⚠ Voce română indisponibilă — folosesc vocea implicită (${voices[0]?.name || '?'})`;
    speak('Test voce copilot raliu. Stânga în 300 metri. Finish RT.');
  });

  el('model-sel').addEventListener('change', () => {
    S.cfg.model = el('model-sel').value;
    ls('rali_model', S.cfg.model);
  });
}

document.addEventListener('DOMContentLoaded', init);
