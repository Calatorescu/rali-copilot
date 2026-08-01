// RALI 2 · geo.js — geometrie pură: distanțe, proiecție pe traseu, fuziune de odometru.
//
// Piesa centrală e PROIECȚIA PE POLILINIE: odată ce traseul există ca geometrie
// (înregistrat la recunoaștere), poziția GPS se traduce direct în „kilometrul de
// traseu" — și tot driftul de odometru dispare ca și clasă de probleme.
// Capcana rezolvată aici: drumurile dus-întors (Bâlea!) — același asfalt apare de
// două ori în polilinie, deci căutarea e MONOTONĂ: într-o fereastră în jurul ultimei
// poziții cunoscute pe traseu, nu global.

const R_EARTH = 6371000; // m

export function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// Proiecție locală plată (suficientă la scara metrilor dintre fix-uri)
function toXY(refLat) {
  const kx = Math.cos(refLat * Math.PI / 180) * 111320; // m per grad lng
  const ky = 110574;                                    // m per grad lat
  return (lat, lng) => [lng * kx, lat * ky];
}

// Construiește o urmă navigabilă din puncte {lat, lng}: păstrează doar punctele la
// ≥ minStepM unul de altul (zgomotul staționar nu îngroașă polilinia) și calculează
// distanța cumulativă. Întoarce { pts: [{lat,lng,cum}], totalM }.
export function buildTrace(points, minStepM = 6) {
  const pts = [];
  let cum = 0;
  for (const p of points) {
    if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
    if (!pts.length) { pts.push({ lat: p.lat, lng: p.lng, cum: 0 }); continue; }
    const prev = pts[pts.length - 1];
    const d = haversineM(prev.lat, prev.lng, p.lat, p.lng);
    if (d < minStepM) continue;
    if (d > 500) continue;              // gaură GPS — nu tragem linii peste ea
    cum += d;
    pts.push({ lat: p.lat, lng: p.lng, cum });
  }
  return { pts, totalM: cum };
}

// Proiectează poziția pe urmă, într-o fereastră monotonă.
//  lastCumM  — ultima poziție cunoscută pe traseu (m); căutarea acoperă
//              [lastCumM − back, lastCumM + fwd] — implicit puțin înapoi, mult înainte.
//  corridorM — cât de departe de asfalt acceptăm fix-ul (peste → null, ești în afara urmei).
// Întoarce { cumM, offM } sau null.
export function projectOnTrace(trace, lat, lng, lastCumM, { backM = 250, fwdM = 900, corridorM = 45 } = {}) {
  const pts = trace.pts;
  if (!pts || pts.length < 2) return null;
  const xy = toXY(pts[0].lat);
  const [px, py] = xy(lat, lng);
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (b.cum < lastCumM - backM) continue;
    if (a.cum > lastCumM + fwdM) break;
    const [ax, ay] = xy(a.lat, a.lng);
    const [bx, by] = xy(b.lat, b.lng);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) continue;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    const off = Math.hypot(px - qx, py - qy);
    const cum = a.cum + t * (b.cum - a.cum);
    if (!best || off < best.offM) best = { cumM: cum, offM: off };
  }
  if (!best || best.offM > corridorM) return null;
  return best;
}

// ── Odometru fuzionat — un singur loc, o singură regulă ──────────────────────
// Combină viteza Doppler (bună mereu, chiar cu poziție împrăștiată) cu haversine
// (verifică subraportarea vitezei). Lecțiile din aplicația veche, ca lege, nu ca petice:
//  • staționar doar când AMBELE surse sunt de acord;
//  • precizia slabă taie doar haversine, nu integrarea vitezei;
//  • gaură de fix → ultima viteză validă, până la 30 s.
export function makeOdometer() {
  let last = null;      // { lat, lng, t, spdMs }
  return {
    reset() { last = null; },
    // fix: { lat, lng, tMs, speedMs|null, accM|null } → metri de adăugat
    step(fix) {
      const spdOk = fix.speedMs != null && isFinite(fix.speedMs) && fix.speedMs >= 0;
      let inc = 0;
      if (last) {
        const dt = (fix.tMs - last.t) / 1000;
        const hav = haversineM(last.lat, last.lng, fix.lat, fix.lng);
        const accBad = fix.accM != null && fix.accM > 60;
        const stationary = spdOk ? (fix.speedMs < 0.55 && hav < 4) : (hav < 4);
        if (!stationary && dt > 0 && dt < 30) {
          if (spdOk) inc = fix.speedMs * dt;
          else if (!accBad && hav < 500) inc = hav;
          else if (last.spdMs != null) inc = last.spdMs * dt;
          if (spdOk && !accBad && hav < 500 && hav > inc * 2 + 10) inc = hav; // viteza minte
        }
      }
      last = { lat: fix.lat, lng: fix.lng, t: fix.tMs, spdMs: spdOk ? fix.speedMs : (last ? last.spdMs : null) };
      return inc;
    }
  };
}

// diferență unghiulară semnată, -180..180 (pentru detecția de viraje fără geometrie)
export function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
