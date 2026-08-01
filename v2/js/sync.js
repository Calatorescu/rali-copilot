// RALI 2 · sync.js — jurnalul pleacă singur: telefon → repo-ul PRIVAT al lui Andreas.
//
// Scris cu acordul explicit al lui Andreas (2026-08-01), după ce guard-ul automat a
// blocat prima încercare — pe bună dreptate ca tipar; aici datele, tokenul și repo-ul
// de destinație îi aparțin toate lui.
// Bucla: aplicația urcă ziua (jurnal + plan + recunoaștere) în `Calatorescu/rali-jurnale`
// (repo PRIVAT — jurnalul conține urme GPS); rularea de noapte a copilotului de birou
// îl citește și pune debrief-ul în briefingul de dimineață.
// Tokenul: fine-grained, LIMITAT la acel repo, doar Contents R/W. Stă în localStorage,
// același regim asumat ca și cheia Anthropic.
// Momente de urcare: STOP ZIUA · la ~10 min în cursă · când pagina intră în fundal.
// Offline = stare normală pe munte: reîncercarea vine singură la revenirea rețelei.

const API = 'https://api.github.com';

// Câte intrări are jurnalul deja urcat. Conținutul vine de la GitHub — deci sunt DATE,
// nu instrucțiuni: se citește doar lungimea listei, nimic din el nu se execută și nimic
// nu se importă. Orice eroare de parsare înseamnă „nu știu", adică −1, iar necunoscutul
// nu blochează urcarea (altfel un fișier corupt ar opri sincronizarea toată ziua).
function numaraIntrari(b64) {
  try {
    const txt = decodeURIComponent(escape(atob(String(b64 || '').replace(/\s/g, ''))));
    const j = JSON.parse(txt);
    return Array.isArray(j.journal) ? j.journal.length : -1;
  } catch (e) { return -1; }
}

export function makeSync({ getToken, repo /* 'user/nume' */, exportFn, onStatus = () => {} }) {
  let pending = false, lastOkMs = 0, timerId = null;

  async function pushNow(reason = 'manual') {
    const token = getToken();
    if (!token || !repo) { onStatus('sync: fără token — jurnalul rămâne doar local'); return false; }
    if (pending) return false;
    pending = true;
    try {
      const dump = await exportFn();
      dump._syncReason = reason;
      const localN = (dump.journal || []).length;
      const day = new Date().toISOString().slice(0, 10);
      let path = `jurnale/${day}.json`;

      // REGULA CARE A LIPSIT (2026-08-01): un jurnal GOL nu pleacă niciodată. În ziua
      // testului, aplicația a urcat de trei ori un jurnal gol peste datele bune ale
      // cursei; s-au recuperat din istoricul git, dar puteau fi pierdute definitiv.
      if (localN === 0) {
        onStatus('sync sărit: jurnal gol — nu suprascriu ce e deja urcat');
        return false;
      }

      const hdr = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      };
      // un fișier per zi, suprascris: PUT cere SHA-ul versiunii curente dacă există
      let sha, remoteN = -1;
      const probe = await fetch(`${API}/repos/${repo}/contents/${path}`,
        { headers: hdr, signal: AbortSignal.timeout(20000) });
      if (probe.ok) {
        const meta = await probe.json();
        sha = meta.sha;
        remoteN = numaraIntrari(meta.content);
      }

      // Jurnalul e append-only: ce e local ar trebui să fie SUPRASET peste ce e urcat.
      // Dacă e mai mic, ceva s-a resetat (reinstalare, alt telefon, IndexedDB golit).
      // Atunci nu suprascriu — salvez alături, ca să nu pierd niciuna dintre versiuni.
      if (remoteN > localN) {
        path = `jurnale/${day}-partial-${localN}.json`;
        sha = undefined;
        onStatus(`⚠ jurnal local mai mic (${localN} < ${remoteN}) — salvat separat`);
      }

      const body = btoa(unescape(encodeURIComponent(JSON.stringify(dump))));
      const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
        method: 'PUT', headers: hdr, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          message: `jurnal ${day} (${reason}, ${localN} intrări)`,
          content: body, ...(sha ? { sha } : {})
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      lastOkMs = Date.now();
      onStatus(`sync ✓ ${new Date().toLocaleTimeString('ro-RO')}`);
      return true;
    } catch (e) {
      onStatus('sync amânat (' + (e && e.message ? e.message : 'offline') + ')');
      return false;
    } finally { pending = false; }
  }

  return {
    pushNow,
    startAuto(intervalMs = 10 * 60 * 1000) {
      clearInterval(timerId);
      timerId = setInterval(() => pushNow('auto'), intervalMs);
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => pushNow('online'));
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') pushNow('hidden');
        });
      }
    },
    stopAuto() { clearInterval(timerId); },
    get lastOkMs() { return lastOkMs; }
  };
}
