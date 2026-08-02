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

export function legLabel(key) {
  const [d, l] = String(key).split('|');
  if (d === '?' && l === '?') return 'fără antet';
  return (d !== '?' ? `Ziua ${d} · ` : '') + (l !== '?' ? `Leg ${l}` : 'leg necunoscut');
}

// Gruparea pe leg-uri — lecția plătită de v1 și pierdută la rescrierea v2 (audit, #1):
// numerotarea boxurilor ȘI kilometrajul REPORNESC la fiecare leg (măsurat pe Reșița:
// Leg 2 are boxurile 28-36 la 7-8 km, Leg 3 are 28-30 la 35-36 km). Sortate global pe
// sumKm, două leg-uri ies împletite: probele se împerechează între leg-uri, totalKm e
// al altui leg, iar aplicația conduce pe un traseu care nu există. Planul se face pe
// UN SINGUR leg; grupurile de aici alimentează selectorul și trecerea la leg-ul următor.
export function groupByLeg(boxes) {
  const map = new Map();
  for (const b of (Array.isArray(boxes) ? boxes : [])) {
    const k = legKey(b);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(b);
  }
  const rank = k => { const [d, l] = String(k).split('|');
    return [d === '?' ? 1e6 : +d, l === '?' ? 1e6 : +l]; };
  return [...map.entries()]
    .sort((a, z) => { const ra = rank(a[0]), rz = rank(z[0]); return ra[0] - rz[0] || ra[1] - rz[1]; })
    .map(([key, list]) => ({
      key, label: legLabel(key),
      boxes: [...list].sort((a, b) => a.sumKm - b.sumKm)
    }));
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

// ── Verificatorul de roadbook (propunerea 1 din audit, 02.08.2026) ──────────
// Erorile scanării se prind PARCAT, nu la 40 km/h: primul test de teren a eșuat
// din distanțe greșite pe care nimeni nu le-a verificat înainte de plecare.
// Primește TOATE boxurile scanate; verifică fiecare leg separat.
export function verifyRoadbook(allBoxes) {
  const probleme = [];
  const grupuri = groupByLeg(allBoxes);
  for (const g of grupuri) {
    const b = g.boxes, unde = g.label;
    // km-ul trebuie să crească strict — dubluri sau regresii = boxuri citite greșit
    for (let i = 1; i < b.length; i++) {
      const sec = b[i].sumKm - b[i - 1].sumKm;
      if (sec <= 0)
        probleme.push(`${unde}: boxurile ${b[i - 1].num} și ${b[i].num} au același km (${b[i].sumKm}) sau merg înapoi`);
      else if (sec > 8)
        probleme.push(`${unde}: salt de ${sec.toFixed(1)} km între boxurile ${b[i - 1].num} și ${b[i].num} — pagină lipsă?`);
    }
    // numerele de box: o gaură în serie = o pagină sau un rând nescanat
    const nums = b.map(x => x.num).filter(n => n != null);
    for (let i = 1; i < nums.length; i++) {
      const gol = nums[i] - nums[i - 1];
      if (gol > 1) probleme.push(`${unde}: lipsesc boxurile ${nums[i - 1] + 1}–${nums[i] - 1} (între ${nums[i - 1]} și ${nums[i]})`);
      else if (gol < 0) probleme.push(`${unde}: boxul ${nums[i]} vine după ${nums[i - 1]} — numerotare încurcată`);
    }
    // box mut: fără direcție și fără flag — scanarea n-a înțeles căsuța
    for (const x of b) {
      if (!x.dir && !x.flag) probleme.push(`${unde}: boxul ${x.num} n-are nici direcție, nici semn — verifică pagina`);
    }
    // probele: fiecare START își are FINISH-ul?
    let deschise = 0;
    for (const x of b) {
      if (x.flag === 'RT_START_AUTO' || x.flag === 'RT_START_STANDING') deschise++;
      else if (x.flag === 'RT_FINISH') {
        if (deschise === 0) probleme.push(`${unde}: FINISH de probă (box ${x.num}) fără START înaintea lui`);
        else deschise--;
      }
    }
    if (deschise > 0) probleme.push(`${unde}: ${deschise} probă/e cu START fără FINISH`);
    // Un leg fără nicio probă sau fără TC de final e aproape sigur o scanare parțială —
    // exact cazul din 02.08: doar pagina 1 intrase (4 boxuri, 0 probe, 0,35 km) și
    // seria de numere 1-4 era „corectă", deci nimic nu urla. De-acum urlă asta.
    if (b.length >= 2) {
      if (!b.some(x => x.flag === 'RT_START_AUTO' || x.flag === 'RT_START_STANDING'))
        probleme.push(`${unde}: NICIO probă în ${b.length} boxuri — sigur au intrat toate paginile?`);
      if (b[b.length - 1].flag !== 'TC' && b[b.length - 1].flag !== 'PARKING')
        probleme.push(`${unde}: ultimul box (${b[b.length - 1].num}) nu e TC/parcare — lipsește finalul?`);
    }
  }
  return { probleme, legs: grupuri.map(g => ({ key: g.key, label: g.label, boxuri: g.boxes.length })) };
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
