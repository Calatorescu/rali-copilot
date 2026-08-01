// RALI 2 · learn.js — aplicația te învață pe tine.
//
// Modelul șoferului, v1: LATENȚA — câte secunde trec între anunțul „acum" și manevra
// executată efectiv (detectată din viraj). Media alunecătoare a acestei întârzieri
// mută anunțurile exact cât ai TU nevoie, nu cât e scris într-o constantă.
// Se hrănește din jurnal: evenimente {type:'cue', boxNum, t} și {type:'turn_done', boxNum, t}.

export function makeDriverModel(saved = {}) {
  let lat = saved.latencyS != null ? saved.latencyS : 1.2;   // start rezonabil
  let n = saved.n || 0;
  const pending = new Map();   // boxNum → t anunț

  return {
    cueGiven(boxNum, tMs) { pending.set(boxNum, tMs); if (pending.size > 8) pending.delete(pending.keys().next().value); },
    turnDone(boxNum, tMs) {
      const t0 = pending.get(boxNum);
      if (t0 == null) return null;
      pending.delete(boxNum);
      const d = (tMs - t0) / 1000;
      if (d < 0 || d > 12) return null;          // gunoiul nu intră în model
      // medie alunecătoare cu greutate mică — modelul se mișcă lent, nu tresare
      lat = n < 3 ? (lat * n + d) / (n + 1) : lat * 0.85 + d * 0.15;
      n++;
      return d;
    },
    // cu cât înainte (în metri, la viteza dată) trebuie tras anunțul „acum"
    leadM(kmh) { return Math.round((kmh / 3.6) * lat); },
    latencyS: () => Math.round(lat * 100) / 100,
    toJSON() { return { latencyS: lat, n }; }
  };
}
