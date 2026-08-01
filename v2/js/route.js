// RALI 2 · route.js — modelul traseului: boxuri + geometrie + planul probelor.
//
// Un traseu are două straturi care se leagă între ele:
//  • BOXURILE din roadbook (km oficial, direcție, flag) — autoritatea de conținut;
//  • URMA din recunoaștere (geometrie GPS + mostre de viteză) — autoritatea de poziție.
// Legarea: la recunoaștere, șoferul marchează boxuri din mers („sunt la box 12") —
// fiecare marcaj devine o ancoră (kmOficial ↔ metriPeUrmă). Între ancore, maparea e
// liniară. Cu 3-4 ancore pe leg, kilometrul oficial se citește direct din poziție.

import { slowZones } from './pace.js';

export const TURN_DIRS = new Set(['STÂNGA', 'DREAPTA', 'STÂNGA-T', 'DREAPTA-T',
  'GIRATORIU-1', 'GIRATORIU-2', 'GIRATORIU-3', 'GIRATORIU-4']);

export function legKey(b) {
  const d = typeof b.day === 'number' ? b.day : '?';
  const l = typeof b.leg === 'number' ? b.leg : '?';
  return `${d}|${l}`;
}

// Sanitizarea ieșirii din scanare — granița de încredere (răspunsul AI = conținut
// extern derivat dintr-o poză a unui document tipărit de altcineva).
const DIR_OK = new Set([...TURN_DIRS, 'ÎNAINTE', 'STOP-CFR']);
const FLAG_OK = new Set(['TC', 'RT_START_AUTO', 'RT_START_STANDING', 'RT_FINISH', 'PARKING', 'EV']);

export function sanitizeBoxes(raw) {
  const num = v => {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
    return typeof n === 'number' && isFinite(n) ? n : null;
  };
  const out = (Array.isArray(raw) ? raw : []).map(b => ({
    day: num(b.day), leg: num(b.leg), page: num(b.page), num: num(b.num),
    sumKm: num(b.sumKm), sectionKm: num(b.sectionKm),
    dir: DIR_OK.has(b.dir) ? b.dir : null,
    flag: FLAG_OK.has(b.flag) ? b.flag : null,
    comment: typeof b.comment === 'string' ? b.comment.slice(0, 120) : ''
  })).filter(b => b.sumKm !== null);
  out.sort((a, b) => a.sumKm - b.sumKm);
  return out;
}

// Probele, detectate din flag-uri; viteza din comentariu dacă organizatorul a scris-o.
export function detectRts(boxes, savedSpeeds = {}) {
  const rts = [];
  for (let i = 0; i < boxes.length; i++) {
    const f = boxes[i].flag;
    if (f !== 'RT_START_AUTO' && f !== 'RT_START_STANDING') continue;
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[j].flag === 'RT_FINISH') {
        const dist = boxes[j].sumKm - boxes[i].sumKm;
        if (dist > 0.05 && dist < 60) {
          const key = `${boxes[i].num}_${Math.round(boxes[i].sumKm * 100)}`;
          const m = String(boxes[i].comment || '').match(/(\d+(?:[.,]\d+)?)\s*km\s*\/?\s*h/i);
          rts.push({
            name: 'RT' + (rts.length + 1), key,
            startIdx: i, finishIdx: j,
            startKm: boxes[i].sumKm, finishKm: boxes[j].sumKm,
            distKm: Math.round(dist * 100) / 100,
            type: f === 'RT_START_STANDING' ? 'standing' : 'auto',
            kmh: savedSpeeds[key] != null ? savedSpeeds[key]
               : (m ? parseFloat(m[1].replace(',', '.')) : null)
          });
        }
        break;
      }
    }
  }
  return rts;
}

// ── Ancorele recunoaștere ↔ roadbook ────────────────────────────────────────
// anchors: [{ officialKm, traceM }] sortate după traceM, strict crescătoare pe ambele axe.
export function makeAnchorMap(anchors) {
  const A = [...anchors].sort((a, b) => a.traceM - b.traceM)
    .filter((a, i, arr) => i === 0 || (a.traceM > arr[i - 1].traceM && a.officialKm > arr[i - 1].officialKm));
  return {
    anchors: A,
    // metri pe urmă → km oficial (liniar între ancore; în afara lor, extrapolat cu
    // panta segmentului vecin — scara locală reală, nu presupunerea 1:1)
    officialKm(traceM) {
      if (!A.length) return traceM / 1000;
      if (A.length === 1) return A[0].officialKm + (traceM - A[0].traceM) / 1000;
      let i = 0;
      while (i < A.length - 2 && traceM > A[i + 1].traceM) i++;
      const a = A[i], b = A[i + 1];
      const f = (traceM - a.traceM) / (b.traceM - a.traceM);
      return a.officialKm + f * (b.officialKm - a.officialKm);
    },
    traceM(officialKm) {
      if (!A.length) return officialKm * 1000;
      if (A.length === 1) return A[0].traceM + (officialKm - A[0].officialKm) * 1000;
      let i = 0;
      while (i < A.length - 2 && officialKm > A[i + 1].officialKm) i++;
      const a = A[i], b = A[i + 1];
      const f = (officialKm - a.officialKm) / (b.officialKm - a.officialKm);
      return a.traceM + f * (b.traceM - a.traceM);
    }
  };
}

// Zonele lente ale unei probe, în metri DE PROBĂ, din mostrele de recunoaștere.
// samples: [{ cumM, kmh }] pe TOATĂ urma; rt are startKm/finishKm oficiali.
export function rtSlowZones(rt, samples, anchorMap, targetKmh) {
  if (!samples || !samples.length || !anchorMap || targetKmh == null) return [];
  const fromM = anchorMap.traceM(rt.startKm);
  const toM = anchorMap.traceM(rt.finishKm);
  const inRt = samples.filter(s => s.cumM >= fromM && s.cumM <= toM)
    .map(s => ({ cumM: s.cumM - fromM, kmh: s.kmh }));
  return slowZones(inRt, targetKmh);
}

// Planul zilei: totul, gata de dat mașinii de stări.
export function buildPlan(boxes, savedSpeeds, recon /* {trace, samples, anchors} | null */) {
  const rts = detectRts(boxes, savedSpeeds);
  const anchorMap = recon && recon.anchors && recon.anchors.length
    ? makeAnchorMap(recon.anchors) : null;
  for (const rt of rts) {
    rt.zones = (recon && anchorMap && rt.kmh != null)
      ? rtSlowZones(rt, recon.samples, anchorMap, rt.kmh) : [];
  }
  return {
    boxes, rts,
    trace: recon ? recon.trace : null,
    samples: recon ? recon.samples : null,
    anchorMap,
    totalKm: boxes.length ? boxes[boxes.length - 1].sumKm : 0
  };
}
