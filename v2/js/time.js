// RALI 2 · time.js — ceasul raliului, fundația întregii aplicații.
//
// O singură sursă de timp, cu două fețe:
//  • mono()  — monoton (performance.now), pentru durate: cronometrul probei nu sare
//              când telefonul își corectează ceasul prin NTP.
//  • rally() — ceasul OFICIAL al raliului (perete + offset măsurat la TC), pentru
//              orare: plecări, TC-uri, „unde ar trebui să fiu acum".
// Tot restul aplicației primește ceasul prin injecție — testele îl înlocuiesc cu unul
// sintetic și pot rula o zi de raliu în milisecunde.

export function makeClock({ now = () => Date.now(), mono = null } = {}) {
  // în browser mono = performance.now; în teste se injectează unul controlat
  const monoFn = mono || (typeof performance !== 'undefined'
    ? () => performance.now()
    : () => now());
  let offsetMs = 0;   // oficial − telefon; se măsoară o dată, la primul TC

  return {
    mono: () => monoFn(),
    wall: () => now(),
    rally: () => now() + offsetMs,
    getOffsetMs: () => offsetMs,
    setOffsetMs(ms) { offsetMs = Number(ms) || 0; },
    // „ceasul oficial arată HH:MM:SS chiar acum" → calculează offsetul singur
    calibrateFromOfficial(h, m, s = 0) {
      const t = new Date(now());
      t.setHours(h, m, s, 0);
      offsetMs = t.getTime() - now();
      return offsetMs;
    }
  };
}

// „HH:MM[:SS]" → ms de perete pentru AZI (sau mâine, dacă ora a trecut de mult).
// Întoarce epoch în CEASUL RALIULUI — comparabil cu clock.rally().
export function parseRallyTime(str, clock) {
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const base = new Date(clock.rally());
  base.setHours(+m[1], +m[2], +(m[3] || 0), 0);
  let t = base.getTime();
  if (t < clock.rally() - 60 * 60 * 1000) t += 24 * 60 * 60 * 1000; // demult trecută → mâine
  return t;
}

export function fmtHMS(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// ══ ȘTAMPILA TC ȘI NUMĂRĂTOAREA SPRE STARTURILE PROBELOR (v44) ══════════════
// REGULA DE CONCURS, buletinul de la Sibiu (07.08.2026): probele cu self-start pornesc
// la un DECALAJ FIX față de începerea unui Time Control — TR 1 la 24 de minute după
// TC 1, TR 2 la 80, TR 3 la 131. Cronometrul probei curge de la TC+decalaj INDIFERENT
// dacă mașina e la linie: întârzierea la linia de start e penalizare directă, nu timp
// pierdut care se poate recupera pe probă.
//
// Aplicația NU are de unde ști singură când a început TC-ul — nu e în telefonul ei, e
// mâna arbitrului pe ștampilă. Deci omul apasă un buton exact atunci, o dată, iar de
// acolo încolo toate orele de start se calculează singure. Tot ce urmează e aritmetică
// pură pe momentul ăla: nicio ghicitoare, nicio pornire automată de cronometru.
export const PRAGURI_START_S = [300, 60, 15, 0];

// mm:ss, cu minutele NEplafonate la 99 — decalajul lui TR 3 e de 131 de minute
export function fmtMMSS(sec) {
  const s = Math.max(0, Math.floor(sec));    // floor, nu round: nu promitem timp inexistent
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Probele cu decalaj, cu ora lor de start socotită din ștampilă. Funcție pură.
// `rts` = probele planului (poartă `startDupaTc: {tc, minutes}` de la v38);
// `stampilaMs` = ora de perete a apăsării, în ceasul raliului; `acumMs` = acum.
// Probele FĂRĂ decalaj (TR 4 și TR 5 azi, start din mers) nu apar deloc — pentru ele
// nu există nicio oră de calculat.
export function starturiDinStampila(rts, stampilaMs, acumMs) {
  if (stampilaMs == null) return [];
  const out = [];
  for (const r of (Array.isArray(rts) ? rts : [])) {
    const t = r && r.startDupaTc;
    if (!t || typeof t.minutes !== 'number' || !isFinite(t.minutes)) continue;
    const oraMs = stampilaMs + t.minutes * 60000;
    const ramasS = (oraMs - acumMs) / 1000;
    out.push({
      name: r.name || 'probă', tc: t.tc || null, minutes: t.minutes, oraMs, ramasS,
      // culoarea: verde cât mai e mult, galben sub 5 minute, roșu sub un minut
      stare: ramasS <= 0 ? 'trecut' : ramasS <= 60 ? 'rosu' : ramasS <= 300 ? 'galben' : 'verde'
    });
  }
  out.sort((a, b) => a.oraMs - b.oraMs);
  return out;
}

// Linia de pe ecran. `ora` adaugă și ora de perete a startului — în panoul de pregătire,
// unde e loc și unde omul își potrivește ceasul; în cockpit rămâne doar numărătoarea.
export function textStart(l, { ora = false } = {}) {
  const cap = l.ramasS > 0
    ? `${l.name} — start în ${fmtMMSS(l.ramasS)}`
    : `${l.name} — start trecut de ${fmtMMSS(-l.ramasS)}`;
  return ora ? `${cap} · ora ${fmtHMS(l.oraMs)}` : cap;
}

// Ce se rostește la fiecare prag. Scurt: pilotul e la volan sau la linie.
export function frazaPragStart(name, pragS) {
  if (pragS === 0) return `${name} — pornește!`;
  if (pragS < 60) return `${name} în ${pragS} secunde.`;
  if (pragS === 60) return `${name} într-un minut.`;
  return `${name} în ${Math.round(pragS / 60)} minute.`;
}
