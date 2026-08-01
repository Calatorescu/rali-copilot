// RALI 2 · voice.js — vocea ca dialog: tonuri + cuvinte puține + urechi.
//
// Regula învățată pe teren: fiecare cuvânt în plus ține coada ocupată, iar un mesaj
// rostit târziu e un mesaj fals. De aceea:
//  • EARCONS — tonuri de o jumătate de secundă pentru starea continuă (deviere,
//    box trecut): urcător = ești în avans (încetinește), coborâtor = în urmă
//    (accelerează), tic scurt = box confirmat. Nu ocupă coada de cuvinte.
//  • CUVINTE — doar manevre și cifre; coada are TTL (stătut = aruncat) și categorie
//    (nou înlocuiește vechi din aceeași categorie).
//  • URECHI — push-to-talk: „sunt la box 12", „cât am", „viteza".
// Tot modulul e injectabil: testele îi dau un difuzor fals și citesc ce s-ar fi spus.

export function makeVoice({ tts = null, audio = null, now = () => Date.now() } = {}) {
  const q = [];
  let cur = null, curAt = 0;

  const T = tts || defaultTts();
  const A = audio;   // AudioContext factory — null în teste

  function pump() {
    if (cur || !q.length) return;
    const nowMs = now();
    for (let i = q.length - 1; i >= 0; i--) {
      if (nowMs - q[i].at > (q[i].prio >= 3 ? 3500 : 5000)) q.splice(i, 1);
    }
    if (!q.length) return;
    let idx = 0;
    for (let i = 1; i < q.length; i++) if (q[i].prio > q[idx].prio) idx = i;
    cur = q.splice(idx, 1)[0];
    curAt = nowMs;
    T.speak(cur.text, () => { cur = null; pump(); });
  }

  // watchdog: pe Android, onend poate să nu vină; nu lăsăm vocea să moară pe zi
  const wdId = setInterval(() => {
    if (cur && now() - curAt > Math.max(6000, cur.text.length * 90) && !T.busy()) {
      cur = null; pump();
    }
    T.keepAlive && T.keepAlive();
  }, 2000);

  return {
    say(text, prio = 2, cat = null) {
      if (!text) return;
      if (cat) for (let i = q.length - 1; i >= 0; i--) if (q[i].cat === cat) q.splice(i, 1);
      if (cur && prio > cur.prio) { T.cancel(); cur = null; }
      q.push({ text, prio, cat, at: now() });
      pump();
    },
    flush() { q.length = 0; cur = null; T.cancel(); },
    // tonuri — starea continuă, fără cuvinte
    tone(kind) {
      if (!A) return;
      try {
        const ctx = A();
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        g.gain.value = 0.28;
        const t = ctx.currentTime;
        if (kind === 'ahead')       { o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(760, t + 0.28); }
        else if (kind === 'behind') { o.frequency.setValueAtTime(760, t); o.frequency.linearRampToValueAtTime(520, t + 0.28); }
        else if (kind === 'ok')     { o.frequency.setValueAtTime(640, t); }
        else if (kind === 'tick')   { o.frequency.setValueAtTime(1100, t); }
        else if (kind === 'alarm')  { o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(660, t + 0.15); o.frequency.setValueAtTime(880, t + 0.3); }
        o.start(t);
        o.stop(t + (kind === 'tick' ? 0.08 : kind === 'alarm' ? 0.45 : 0.3));
      } catch (e) {}
    },
    dispose() { clearInterval(wdId); T.cancel(); },
    _q: q   // pentru teste
  };
}

function defaultTts() {
  const S = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  return {
    speak(text, onEnd) {
      if (!S) { onEnd(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ro-RO'; u.rate = 1.12;
      u.onend = u.onerror = () => onEnd();
      setTimeout(() => S.speak(u), 50);
    },
    cancel() { S && S.cancel(); },
    busy() { return S ? S.speaking : false; },
    keepAlive() { if (S && S.paused) S.resume(); }
  };
}

// secunde rostite cu zecime: „3 virgulă 4" (Sibiu cronometrează la 0,1 s)
export function secRo(x) {
  const v = Math.round(Math.abs(x) * 10) / 10;
  const i = Math.floor(v), z = Math.round((v - i) * 10);
  return z === 0 ? `${i}` : `${i} virgulă ${z}`;
}

export function distRo(m) {
  const r = m >= 950 ? Math.round(m / 100) / 10 : m >= 400 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10;
  return m >= 950 ? `${String(r).replace('.', ' virgulă ')} kilometri` : `${r}`;
}

// ── comenzile vocale (push-to-talk) ─────────────────────────────────────────
// Gramatică mică, robustă: „box 12" / „sunt la box 12", „cât am", „viteza", „start", „stop".
export function parseCommand(txt) {
  const t = String(txt).toLowerCase();
  let m = t.match(/box(?:ul)?\s+(\d{1,3})/);
  if (m) return { cmd: 'at_box', num: +m[1] };
  if (/c[âa]t am|cum stau|devier/.test(t)) return { cmd: 'status' };
  if (/vitez/.test(t)) return { cmd: 'speed' };
  if (/\bstart\b|porne/.test(t)) return { cmd: 'start' };
  if (/\bstop\b|opre/.test(t)) return { cmd: 'stop' };
  return { cmd: 'unknown', raw: txt };
}

export function makeEars({ onCommand }) {
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  let listening = false;
  return {
    supported: !!SR,
    listen() {
      if (!SR || listening) return false;
      const rec = new SR();
      rec.lang = 'ro-RO'; rec.interimResults = false; rec.maxAlternatives = 1;
      listening = true;
      rec.onresult = e => onCommand(parseCommand(e.results[0][0].transcript));
      rec.onend = rec.onerror = () => { listening = false; };
      try { rec.start(); return true; } catch (e) { listening = false; return false; }
    },
    get listening() { return listening; }
  };
}
