// RALI 2 · learn.js — aplicația te învață pe tine.
//
// Modelul șoferului, v1: LATENȚA — câte secunde trec între anunțul „acum" și manevra
// executată efectiv (detectată din viraj). Media alunecătoare a acestei întârzieri
// mută anunțurile exact cât ai TU nevoie, nu cât e scris într-o constantă.
// Se hrănește din jurnal: evenimente {type:'cue', boxNum, t} și {type:'turn_done', boxNum, t}.

// CÂT POATE FI LATENȚA, în secunde. Plaja e a unui OM care aude „dreapta acum" și
// pune mâna pe volan: sub 0,3 s nu există reacție, peste 4 s nu mai e reacție, e altceva.
//
// Măsurat în tura Tresor (04.08.2026, 16:26-16:39): anunțurile „acum" au plecat cu
// 32-124 m înainte de box, adică o latență implicită de 5,3-9,0 s (mediana 7,7) — de
// șase ori startul de 1,2 s. Cauza: `turnDone` nu măsoară reacția pilotului, ci momentul
// în care DETECTORUL s-a hotărât că a văzut virajul — GPS la ~6 s + confirmare pe 2,5 s
// de direcție stabilă. Fereastra veche accepta orice sub 12 s, deci modelul a înghițit
// întârzierea propriului detector și a mutat „acum" cu peste 100 m înaintea manevrei.
// Un „acum" rostit la 120 m de viraj nu e o anticipare, e o informație falsă.
const LAT_MIN_S = 0.3, LAT_MAX_S = 4;
const inPlaja = s => Math.min(LAT_MAX_S, Math.max(LAT_MIN_S, s));

export function makeDriverModel(saved = {}) {
  // și ce s-a salvat pe telefon se aduce în plajă: modelul stricat de pe teren (7-9 s)
  // altfel ar fi avut nevoie de ~10 ture ca să coboare singur, prin media alunecătoare
  let lat = inPlaja(saved.latencyS != null ? saved.latencyS : 1.2);
  let n = saved.n || 0;
  const pending = new Map();   // boxNum → t anunț

  return {
    cueGiven(boxNum, tMs) { pending.set(boxNum, tMs); if (pending.size > 8) pending.delete(pending.keys().next().value); },
    turnDone(boxNum, tMs) {
      const t0 = pending.get(boxNum);
      if (t0 == null) return null;
      pending.delete(boxNum);
      const d = (tMs - t0) / 1000;
      // Ce nu e reacție de om nu intră în model. Vechea limită (12 s) lăsa înăuntru
      // întârzierea detectorului de viraje și umfla anticiparea până la 124 m (vezi sus).
      if (d < LAT_MIN_S || d > LAT_MAX_S) return null;
      // medie alunecătoare cu greutate mică — modelul se mișcă lent, nu tresare
      lat = inPlaja(n < 3 ? (lat * n + d) / (n + 1) : lat * 0.85 + d * 0.15);
      n++;
      return d;
    },
    // cu cât înainte (în metri, la viteza dată) trebuie tras anunțul „acum"
    leadM(kmh) { return Math.round((kmh / 3.6) * lat); },
    latencyS: () => Math.round(lat * 100) / 100,
    toJSON() { return { latencyS: lat, n }; }
  };
}
