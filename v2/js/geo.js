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
        // Pragul de „stă pe loc" crește cu imprecizia fixului (02.08, tura 3): la stop,
        // GPS-ul tremură cu ordinul preciziei (4-16 m între fixuri), iar pragul fix de
        // 4 m lăsa tremurul să intre ca distanță prin ramura „viteza minte" — +141 m
        // adunați în bucla cu opriri, corectați abia de snapul pe viraj.
        const zgomot = Math.max(4, (fix.accM != null ? fix.accM : 10) * 1.2);
        const stationary = spdOk ? (fix.speedMs < 0.55 && hav < zgomot) : (hav < zgomot);
        if (!stationary && dt > 0 && dt < 30) {
          if (spdOk) inc = fix.speedMs * dt;
          else if (!accBad && hav < 500) inc = hav;
          else if (last.spdMs != null) inc = last.spdMs * dt;
          // „viteza minte" cere mișcare peste zgomotul plauzibil, nu doar peste 10 m
          if (spdOk && !accBad && hav < 500 && hav > inc * 2 + Math.max(10, zgomot)) inc = hav;
        }
      }
      last = { lat: fix.lat, lng: fix.lng, t: fix.tMs, spdMs: spdOk ? fix.speedMs : (last ? last.spdMs : null) };
      return inc;
    }
  };
}

// ── CALIBRAREA ODOMETRULUI — dovada, nu prima impresie ───────────────────────
// Roadbook-ul e o riglă: între două boxuri confirmate fizic, distanța oficială e
// adevărul, iar ce-a măsurat GPS-ul e măsurătoarea. Raportul lor ar fi eroarea
// sistematică a odometrului — DACĂ rigla ar fi exactă și măsurătoarea curată.
//
// Ce s-a întâmplat pe 04.08.2026, măsurat în jurnal, Leg 1 al ultimei ture:
//   segment box 4→8:  oficial 2,634 km · măsurat 2,678 km → raport 0,9836 (−1,6%)
//   segment box 8→12: oficial 2,282 km · măsurat 2,211 km → raport 1,0321 (+3,2%)
// Versiunea veche aplica factorul de la PRIMA măsurătoare (dinMasuratori:1 în jurnal).
// Deci pe segmentul următor s-a mers cu −1,6%, exact acolo unde eroarea era de semn
// OPUS: cele două s-au adunat, iar la oprirea fizică pe boxul 12 (5,43 oficial) poziția
// arăta 5,34 — 90 m lipsă, corectați manual cu +92 m.
//
// Un odometru nu-și schimbă eroarea sistematică cu 4,9 puncte procentuale de la un
// kilometru la altul. Împrăștierea aia e ZGOMOT: km-ii „oficiali" ai roadbook-ului de
// test vin dintr-un lanț GPS și au ±40-70 m pe segment, adică ±1,6…3,2% pe 2,3-2,6 km.
// Toate cele CINCI perechi de segmente din jurnalul zilei arată la fel (0,984/1,006 ·
// 1,015/0,994 · 1,006/1,052 · 0,967/1,017 · 0,973/0,991): semne care se bat cap în cap.
//
// De-aceea calibratorul nu mai crede o măsurătoare, ci o dovadă:
//  • minim 2 segmente și minim 2 km cumulați — un segment singur nu are cu ce fi comparat;
//  • media e ponderată cu lungimea (sumă oficial / sumă măsurat — un segment de 2,6 km
//    cântărește cât trebuie față de unul de 0,6);
//  • abaterea se aplică doar dacă IESE DIN ZGOMOT: |medie − 1| > 2 × marja de eroare a
//    mediei (împrăștierea segmentelor / √n). Cu segmente care se contrazic, marja e mare
//    și factorul rămâne 1 — corect, fiindcă nu s-a măsurat nimic. Cu o eroare reală,
//    consecventă pe mai multe segmente, împrăștierea e mică și factorul trece;
//  • schimbarea per măsurătoare e plafonată, iar plafonul CREȘTE cu dovada: 0,5% la a
//    doua măsurătoare, 1% la a treia, 1,5% la a patra. O eroare reală de 4%, consecventă,
//    e prinsă în cinci segmente; saltul de azi (0,984 → 1,006 dintr-un pas, adică 2,2
//    puncte procentuale pe a doua măsurătoare) ar cere cinci segmente care se confirmă.
export function makeCalibrator(opts = {}) {
  const O = { minSegmente: 2, minKm: 2, minSegKm: 0.5, plajaSegment: 0.15,
              pasMax: 0.005, limita: 0.1, pragMinim: 0.003, k: 2, ...opts };
  const seg = [];
  let factor = 1;

  function statistica() {
    const sumO = seg.reduce((a, s) => a + s.oficial, 0);
    const sumM = seg.reduce((a, s) => a + s.masurat, 0);
    const medie = sumM > 0 ? sumO / sumM : 1;
    // împrăștierea segmentelor în jurul mediei, ponderată tot cu lungimea măsurată,
    // cu corecția de eșantion (n−1) — cu 2 segmente, estimarea „populație" ar minți
    // în jos exact acolo unde contează
    let v = 0;
    if (seg.length > 1) {
      for (const s of seg) v += (s.masurat / sumM) * (s.raport - medie) ** 2;
      v *= seg.length / (seg.length - 1);
    }
    const imprastiere = Math.sqrt(v);
    return { n: seg.length, kmOficial: sumO, kmMasurat: sumM, medie, imprastiere,
             marja: O.k * imprastiere / Math.sqrt(seg.length) };
  }

  return {
    get factor() { return factor; },
    get segmente() { return seg.length; },
    stare() { return { ...statistica(), factor }; },
    // oficial/masurat în km. Întoarce ce s-a întâmplat, ca să intre în jurnal.
    adauga(oficial, masurat) {
      if (!(masurat >= O.minSegKm) || !(oficial >= O.minSegKm))
        return { stare: 'scurt', oficial, masurat };
      const raport = oficial / masurat;
      if (raport < 1 - O.plajaSegment || raport > 1 + O.plajaSegment)
        return { stare: 'refuzat', raport, oficial, masurat };   // snap greșit, nu odometru
      seg.push({ oficial, masurat, raport });
      const st = statistica();
      const info = { raport, oficial, masurat, ...st };
      if (st.n < O.minSegmente)
        return { stare: 'asteapta', motiv: 'un singur segment măsurat', ...info };
      if (st.kmOficial < O.minKm)
        return { stare: 'asteapta', motiv: `doar ${st.kmOficial.toFixed(2)} km cumulați`, ...info };
      const abatere = Math.abs(st.medie - 1);
      if (abatere < O.pragMinim)
        return { stare: 'asteapta', motiv: 'odometrul e destul de bun', ...info };
      if (abatere <= st.marja)
        return { stare: 'asteapta', motiv: 'segmentele se contrazic — e zgomot, nu eroare', ...info };
      const tinta = Math.max(1 - O.limita, Math.min(1 + O.limita, st.medie));
      const pas = O.pasMax * (st.n - 1);       // plafonul crește cu numărul de segmente
      factor = Math.max(factor - pas, Math.min(factor + pas, tinta));
      return { stare: 'aplicat', factor, tinta, pas,
               plafonat: Math.abs(tinta - factor) > 1e-9, ...info };
    }
  };
}

// diferență unghiulară semnată, -180..180 (pentru detecția de viraje fără geometrie)
export function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }

// Azimutul de la un punct la altul, 0..360 (0 = nord, 90 = est).
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) -
            Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

// Primul punct de pe urmă, pornind de la `fromCumM`, aflat la cel puțin `strM` metri
// în LINIE DREAPTĂ de punctul de plecare. Comparația corectă pentru „încotro pleacă
// traseul": aceeași depărtare ca a mașinii, deci aceeași bucată de drum — nu contează
// dacă între timp drumul a cotit de trei ori. Întoarce null dacă urma se termină înainte.
export function traceAheadPoint(trace, fromCumM, strM) {
  const pts = trace && trace.pts;
  if (!pts || pts.length < 2) return null;
  let i = 0;
  while (i < pts.length - 1 && pts[i].cum < fromCumM) i++;
  const a = pts[i];
  for (let j = i + 1; j < pts.length; j++) {
    if (haversineM(a.lat, a.lng, pts[j].lat, pts[j].lng) >= strM)
      return { from: a, to: pts[j] };
  }
  return null;
}

// „nord-est" etc. — direcția spusă cu voce tare, nu în grade
export function directieRo(deg) {
  const nume = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-vest', 'vest', 'nord-vest'];
  return nume[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
