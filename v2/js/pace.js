// RALI 2 · pace.js — matematica regularității, pură și testabilă.
//
// Trei responsabilități:
//  1. timpul ideal pe segmente cu schimbări de medie (compus corect);
//  2. devierea + viteza de recuperare pe fereastră scurtă, plafonată;
//  3. BANCA DE TIMP — partea predictivă: devierea se poate măsura ORIUNDE pe probă,
//     deci ținta nu e „zero la finish", ci „zero peste tot". Când urmează o zonă în
//     care fizic nu poți ține media (giratoriu, sat — știute din recunoaștere),
//     singura apărare e să iei avans exact cât vei pierde acolo. Copilotul uman de
//     top face asta din instinct; aici o facem din date.

// segments: [{ fromKm, kmh }] sortate; timp ideal (s) pentru primii `km` kilometri
export function idealTimeS(km, segments) {
  if (!segments || !segments.length) return 0;
  let t = 0;
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i].fromKm;
    const b = i + 1 < segments.length ? segments[i + 1].fromKm : Infinity;
    const v = Math.max(1, segments[i].kmh);
    const span = Math.min(km, b) - a;
    if (span <= 0) break;
    t += (span / v) * 3600;
  }
  return t;
}

export function speedAt(km, segments) {
  let v = segments.length ? segments[0].kmh : 0;
  for (const s of segments) { if (km >= s.fromKm) v = s.kmh; else break; }
  return v;
}

// deviere: + = în urmă (prea lent), − = în avans
export function deviationS(elapsedS, distKm, segments) {
  return elapsedS - idealTimeS(distKm, segments);
}

// Viteza care recuperează devierea în fereastra `winKm`, plafonată la ±30% din medie —
// întinsă pe tot restul probei ar presupune că nu există cronometrări intermediare.
export function recoverySpeed(devS, distKm, totalKm, segments, winKm = 0.5) {
  const remaining = totalKm - distKm;
  if (remaining <= 0.001) return null;
  const v = speedAt(distKm, segments);
  if (v <= 0) return null;
  const w = Math.min(winKm, remaining);
  const idealW = (w / v) * 3600;
  const tAvail = idealW - devS;
  let out = tAvail > 1 ? (w * 3600) / tAvail : v * 1.3;
  out = Math.max(v * 0.7, Math.min(v * 1.3, out));
  return { kmh: out, winM: Math.round(w * 1000) };
}

// ── Zonele lente, învățate din recunoaștere ──────────────────────────────────
// Din urma de recunoaștere (viteza reală a șoferului, metru cu metru) extragem
// zonele în care N-A PUTUT merge — sub un prag față de media impusă. Ele devin
// harta pierderilor previzibile de pe probă.
// samples: [{ cumM, kmh }] de la recunoaștere. Întoarce [{ fromM, toM, kmh }].
export function slowZones(samples, targetKmh, { factor = 0.85, minLenM = 40 } = {}) {
  const thr = targetKmh * factor;
  const zones = [];
  let cur = null;
  for (const s of samples) {
    if (s.kmh < thr && s.kmh > 1) {
      if (!cur) cur = { fromM: s.cumM, toM: s.cumM, sum: 0, n: 0 };
      cur.toM = s.cumM; cur.sum += s.kmh; cur.n++;
    } else if (cur) {
      if (cur.toM - cur.fromM >= minLenM) zones.push({ fromM: cur.fromM, toM: cur.toM, kmh: cur.sum / cur.n });
      cur = null;
    }
  }
  if (cur && cur.toM - cur.fromM >= minLenM) zones.push({ fromM: cur.fromM, toM: cur.toM, kmh: cur.sum / cur.n });
  return zones;
}

// Cât timp voi PIERDE inevitabil în zona lentă (față de media impusă)?
export function zoneLossS(zone, targetKmh) {
  const lenKm = (zone.toM - zone.fromM) / 1000;
  const tIdeal = (lenKm / targetKmh) * 3600;
  const tReal = (lenKm / Math.max(1, zone.kmh)) * 3600;
  return Math.max(0, tReal - tIdeal);
}

// Sfatul de bancă: dacă în următorii `lookaheadM` metri e o zonă lentă cu pierdere
// ≥ 1.5 s, spune cât avans trebuie luat ACUM. Întoarce { bankS, inM } sau null.
// posM/zonele sunt în metri DE PROBĂ (0 = startul probei).
export function bankingAdvice(posM, targetKmh, zones, { lookaheadM = 600, minBankS = 1.5 } = {}) {
  for (const z of zones) {
    if (z.fromM <= posM) continue;
    if (z.fromM - posM > lookaheadM) break;
    const loss = zoneLossS(z, targetKmh);
    if (loss >= minBankS) return { bankS: Math.round(loss * 10) / 10, inM: Math.round(z.fromM - posM) };
  }
  return null;
}

// ── Profilul devierii, pentru debrief ────────────────────────────────────────
// log: [{ distKm, devS }] pe parcursul probei → felii de `sliceM` cu delta devierii
// în fiecare felie. „Unde am pierdut" devine o listă, nu o impresie.
export function devProfile(log, totalKm, sliceM = 250) {
  const n = Math.max(1, Math.ceil((totalKm * 1000) / sliceM));
  const slices = Array.from({ length: n }, (_, i) => ({
    fromM: i * sliceM, toM: Math.min((i + 1) * sliceM, totalKm * 1000), deltaS: 0
  }));
  let prev = null;
  for (const p of log) {
    if (prev) {
      const idx = Math.min(n - 1, Math.floor((p.distKm * 1000) / sliceM));
      slices[idx].deltaS += p.devS - prev.devS;
    }
    prev = p;
  }
  for (const s of slices) s.deltaS = Math.round(s.deltaS * 10) / 10;
  return slices;
}

// top-K felii vinovate, pentru vocea de debrief
export function worstSlices(profile, k = 2) {
  return [...profile]
    .filter(s => Math.abs(s.deltaS) >= 0.5)
    .sort((a, b) => Math.abs(b.deltaS) - Math.abs(a.deltaS))
    .slice(0, k);
}

// Punctele de eficiență (Sibiu, art. 6.3.2): km − mult×Wh/km + baterie
export function efficiencyPoints(km, whPerKm, batteryKwh, mult = 1) {
  return km - mult * whPerKm + batteryKwh;
}
