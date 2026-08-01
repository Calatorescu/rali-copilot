// RALI 2 · gps.js — sursa de poziție ca abstracție: live / replay / sintetic.
//
// Decizia de arhitectură care schimbă tot: aplicația nu vorbește NICIODATĂ direct cu
// navigator.geolocation — primește o „sursă" cu aceeași interfață, oricare ar fi ea.
//  • live      — GPS-ul telefonului, cu watchdog și repornire;
//  • replay    — un jurnal înregistrat, redat 1:1 sau accelerat (orice bug de teren
//                se reproduce pe birou);
//  • synthetic — o mașină virtuală care „conduce" traseul la viteze date (repetiția-
//                fantomă și testele folosesc exact același drum de cod ca și cursa).
// Fix normalizat: { lat, lng, tMs, speedMs|null, headingDeg|null, accM|null }

export function makeLiveGps({ onFix, onLost, onBack }) {
  let watchId = null, lastFixMs = 0, lostFlag = false, wdId = null;

  function openWatch() {
    try { if (watchId != null) navigator.geolocation.clearWatch(watchId); } catch (e) {}
    watchId = navigator.geolocation.watchPosition(pos => {
      lastFixMs = Date.now();
      if (lostFlag) { lostFlag = false; onBack && onBack(); }
      const c = pos.coords;
      onFix({
        lat: c.latitude, lng: c.longitude, tMs: pos.timestamp,
        speedMs: c.speed != null && isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
        headingDeg: c.heading != null && isFinite(c.heading) ? c.heading : null,
        accM: c.accuracy != null ? c.accuracy : null
      });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 });
  }

  return {
    start() {
      if (!('geolocation' in navigator)) return false;
      openWatch();
      lastFixMs = Date.now();
      // watchdog: fluxul GPS moare tăcut (cameră, suspendare) — fără el, ecranul
      // îngheață cu bulina verde și nimeni nu află. Peste 8 s fără fix: anunță o
      // dată și redeschide watch-ul, cel mult o dată la 8 s.
      wdId = setInterval(() => {
        const age = Date.now() - lastFixMs;
        if (age > 8000) {
          if (!lostFlag) { lostFlag = true; onLost && onLost(); }
          openWatch();
          lastFixMs = Date.now() - 2000;
        }
      }, 2000);
      return true;
    },
    stop() {
      try { if (watchId != null) navigator.geolocation.clearWatch(watchId); } catch (e) {}
      clearInterval(wdId);
    },
    kind: 'live'
  };
}

// Redă fix-uri înregistrate (jurnal type:'fix'), la viteza `rate` (10 = de 10× mai repede).
export function makeReplayGps(fixes, { onFix, rate = 1, timer = { set: setTimeout, clear: clearTimeout } }) {
  let i = 0, tid = null, stopped = false;
  function next() {
    if (stopped || i >= fixes.length) return;
    onFix(fixes[i]);
    const cur = fixes[i], nxt = fixes[i + 1];
    i++;
    if (nxt) tid = timer.set(next, Math.max(0, (nxt.tMs - cur.tMs) / rate));
  }
  return { start() { next(); return true; }, stop() { stopped = true; timer.clear(tid); }, kind: 'replay' };
}

// Mașina virtuală: primește un plan de viteze pe kilometrul de traseu și produce
// fix-uri sintetice de-a lungul urmei (sau pe o linie dreaptă dacă nu există urmă).
// speedPlan(cumM) → km/h dorit în punctul respectiv.
export function makeSyntheticGps({ trace = null, speedPlan, stepMs = 1000, onFix, onDone,
                                   timer = { set: setTimeout, clear: clearTimeout }, t0 = 0 }) {
  let cumM = 0, t = t0, tid = null, stopped = false;
  function posAt(m) {
    if (!trace || !trace.pts || trace.pts.length < 2) {
      return { lat: 45.0 + m / 111320, lng: 21.0 };   // linie dreaptă spre nord
    }
    const pts = trace.pts;
    if (m >= pts[pts.length - 1].cum) return pts[pts.length - 1];
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].cum < m) i++;
    const a = pts[i], b = pts[i + 1];
    const f = (m - a.cum) / Math.max(1e-6, b.cum - a.cum);
    return { lat: a.lat + f * (b.lat - a.lat), lng: a.lng + f * (b.lng - a.lng) };
  }
  function tick() {
    if (stopped) return;
    const kmh = Math.max(0, speedPlan(cumM));
    const ms = kmh / 3.6;
    cumM += ms * (stepMs / 1000);
    t += stepMs;
    const p = posAt(cumM);
    onFix({ lat: p.lat, lng: p.lng, tMs: t, speedMs: ms, headingDeg: null, accM: 8 });
    const end = trace && trace.totalM ? cumM >= trace.totalM + 50 : false;
    if (end) { onDone && onDone(); return; }
    tid = timer.set(tick, 0 /* simulare: cât de repede poate */);
  }
  return {
    start() { tick(); return true; },
    stop() { stopped = true; timer.clear(tid); },
    kind: 'synthetic',
    get cumM() { return cumM; }
  };
}
