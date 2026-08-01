// RALI 2 · debrief.js — după fiecare probă, povestea, nu doar cifra.
//
// Din jurnalul probei (deviere metru cu metru) iese: rezultatul, feliile în care s-a
// pierdut/câștigat, și o frază de spus cu voce tare. La Reșița, o singură astfel de
// frază după TR1 ar fi valorat 300 de puncte la TR4.

import { devProfile, worstSlices } from './pace.js';
import { secRo } from './voice.js';

export function makeDebrief(rt, log /* [{distKm, devS}] */, finalDevS) {
  const profile = devProfile(log, rt.distKm);
  const worst = worstSlices(profile, 2);
  const pts = Math.round(Math.abs(finalDevS) * 10) / 10;

  const lines = worst.map(s => {
    const dirTxt = s.deltaS > 0 ? 'pierdut (prea lent)' : 'câștigat avans (prea rapid)';
    return `${s.fromM}-${s.toM} m: ${s.deltaS > 0 ? '+' : ''}${s.deltaS.toFixed(1)} s ${dirTxt}`;
  });

  let voiceTxt = `${rt.name}: ${secRo(pts)} puncte.`;
  if (worst.length && Math.abs(worst[0].deltaS) >= 1) {
    const s = worst[0];
    voiceTxt += s.deltaS > 0
      ? ` Cel mai mult ai pierdut între ${s.fromM} și ${s.toM} de metri — acolo ai fost lent.`
      : ` Între ${s.fromM} și ${s.toM} de metri ai luat avans — acolo ai fost rapid.`;
  }

  return { name: rt.name, pts, finalDevS: Math.round(finalDevS * 10) / 10, profile, worst, lines, voiceTxt };
}
