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
      const day = new Date().toISOString().slice(0, 10);
      const path = `jurnale/${day}.json`;
      const body = btoa(unescape(encodeURIComponent(JSON.stringify(dump))));

      const hdr = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      };
      // un fișier per zi, suprascris: PUT cere SHA-ul versiunii curente dacă există
      let sha;
      const probe = await fetch(`${API}/repos/${repo}/contents/${path}`,
        { headers: hdr, signal: AbortSignal.timeout(20000) });
      if (probe.ok) sha = (await probe.json()).sha;

      const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
        method: 'PUT', headers: hdr, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          message: `jurnal ${day} (${reason})`,
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
