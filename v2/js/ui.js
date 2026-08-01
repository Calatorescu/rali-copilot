// RALI 2 · ui.js — cockpitul: un singur ecran care se transformă singur.
//
// Randarea e o funcție pură de (stare, plan) → DOM. Nicio logică de cursă aici —
// mașina de stări decide, ecranul doar arată. În teste, ui e un obiect nul.

import { fmtHMS } from './time.js';

const $ = id => document.getElementById(id);

export function makeUi() {
  return {
    render(M, plan) {
      const st = $('cp-state');
      const states = { PREP: 'PREGĂTIRE', LIAISON: 'LEGĂTURĂ', STAGED: 'LA LINIE',
                       RT_RUN: 'PROBĂ', DAY_END: 'FINAL DE ZI' };
      st.textContent = states[M.state] || M.state;
      st.className = 'cp-state s-' + M.state;

      $('cp-km').textContent = M.routeKm.toFixed(2);
      $('cp-spd').textContent = Math.round(M.speedKmh);

      const rtEl = $('cp-rt'), navEl = $('cp-nav');
      if (M.state === 'RT_RUN' && M.rt) {
        rtEl.classList.remove('hidden'); navEl.classList.add('compact');
        const dev = M.rt.frozen != null ? M.rt.frozen : (M.rt.lastDev || 0);
        const a = Math.abs(dev);
        const el = $('cp-dev');
        el.textContent = (dev >= 0 ? '+' : '−') + a.toFixed(1);
        el.className = 'cp-dev ' + (a <= 3 ? 'ok' : a <= 10 ? 'warn' : 'bad');
        $('cp-dev-lbl').textContent = M.rt.frozen != null
          ? 'FINISH — NU OPRI LÂNGĂ TABELĂ'
          : (dev >= 0 ? 'SECUNDE ÎN URMĂ' : 'SECUNDE ÎN AVANS');
        $('cp-target').textContent = `${Math.round(M.speedKmh)} / ${M.rt.def.kmh}`;
      } else {
        rtEl.classList.add('hidden'); navEl.classList.remove('compact');
      }

      // următorul box
      const b = plan.boxes[M.nextBoxIdx];
      if (b) {
        const dM = Math.max(0, (b.sumKm - M.routeKm) * 1000);
        $('cp-next-dist').textContent = dM >= 1000 ? (dM / 1000).toFixed(1) + ' km' : Math.round(dM) + ' m';
        $('cp-next-dir').textContent = dirGlyph(b);
        $('cp-next-com').textContent = (b.comment || '').split('/')[0].trim();
        $('cp-next-box').textContent = 'box ' + (b.num != null ? b.num : '?');
      } else {
        $('cp-next-dist').textContent = '—'; $('cp-next-dir').textContent = '🏁';
        $('cp-next-com').textContent = 'final de leg'; $('cp-next-box').textContent = '';
      }
      const b2 = plan.boxes[M.nextBoxIdx + 1];
      $('cp-after').textContent = b2
        ? `apoi: ${dirGlyph(b2)} la ${b2.sumKm.toFixed(2)} km` : '';

      // probele — bara de jos
      $('cp-rts').textContent = plan.rts.map(r =>
        M.results[r.name] != null ? `${r.name} ✓${M.results[r.name]}` :
        (plan.rts[M.rtIdx] === r && M.state === 'RT_RUN') ? `▶${r.name}` : r.name
      ).join('  ');

      // debrief după probă
      const deb = $('cp-debrief');
      if (M.lastDebrief && M.state !== 'RT_RUN') {
        deb.classList.remove('hidden');
        deb.textContent = `${M.lastDebrief.name}: ${M.lastDebrief.pts} pct · ` +
          (M.lastDebrief.lines[0] || 'curat');
      } else deb.classList.add('hidden');
    }
  };
}

function dirGlyph(b) {
  const g = { 'ÎNAINTE': '↑', 'STÂNGA': '←', 'DREAPTA': '→', 'STÂNGA-T': '↰', 'DREAPTA-T': '↱',
    'GIRATORIU-1': '①', 'GIRATORIU-2': '②', 'GIRATORIU-3': '③', 'GIRATORIU-4': '④', 'STOP-CFR': '⛔' };
  const f = { 'TC': '🏁⏱', 'RT_START_AUTO': '🏁', 'RT_START_STANDING': '🏁❄', 'RT_FINISH': '🔲', 'PARKING': '🅿', 'EV': '🔌' };
  return (g[b.dir] || '•') + (b.flag ? ' ' + (f[b.flag] || '') : '');
}

// ceasul din header — ora RALIULUI, nu a telefonului
export function startHeaderClock(clock) {
  setInterval(() => { const e = $('cp-clock'); if (e) e.textContent = fmtHMS(clock.rally()); }, 500);
}
