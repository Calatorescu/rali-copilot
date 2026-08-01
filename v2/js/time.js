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
