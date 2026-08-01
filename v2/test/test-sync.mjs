// RALI 2 — jurnalul care pleacă singur nu are voie să ȘTEARGĂ.
// Pe 2026-08-01, după ora 21:18, aplicația a urcat de trei ori un jurnal gol peste
// datele bune ale cursei. S-au recuperat din istoricul git. Testele astea sunt gardul.
import { makeSync } from '../js/sync.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const b64 = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const jurnal = n => ({ _app: 'RALI2', journal: Array.from({ length: n }, (_, i) => ({ type: 'x', t: i })) });

// GitHub de mucava: ține un fișier per cale și notează fiecare PUT
function fakeGitHub(fisiere = {}) {
  const puts = [];
  global.fetch = async (url, opt = {}) => {
    const path = decodeURIComponent(url.split('/contents/')[1]);
    if (!opt.method) {
      return fisiere[path]
        ? { ok: true, json: async () => ({ sha: 'sha-' + path, content: fisiere[path] }) }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    const b = JSON.parse(opt.body);
    puts.push({ path, sha: b.sha, content: b.content });
    fisiere[path] = b.content;
    return { ok: true, json: async () => ({}) };
  };
  return { puts, fisiere };
}

const azi = new Date().toISOString().slice(0, 10);
const mk = (dump, onStatus = () => {}) => makeSync({
  getToken: () => 'tok', repo: 'Calatorescu/rali-jurnale',
  exportFn: async () => dump, onStatus
});

console.log('\n═══ Jurnalul gol NU pleacă niciodată ═══');
{
  const gh = fakeGitHub({ [`jurnale/${azi}.json`]: b64(jurnal(500)) });
  const st = [];
  const okRes = await mk(jurnal(0), s => st.push(s)).pushNow('auto');
  ok('urcarea e refuzată', okRes === false);
  ok('niciun PUT nu s-a făcut', gh.puts.length === 0, JSON.stringify(gh.puts));
  ok('datele bune sunt intacte', gh.fisiere[`jurnale/${azi}.json`] === b64(jurnal(500)));
  ok('motivul e spus, nu tăcut', st.some(s => /gol/i.test(s)), JSON.stringify(st));
}

console.log('\n═══ Jurnal local mai MIC decât cel urcat: se salvează alături ═══');
{
  const gh = fakeGitHub({ [`jurnale/${azi}.json`]: b64(jurnal(500)) });
  const st = [];
  await mk(jurnal(12), s => st.push(s)).pushNow('auto');
  ok('fișierul zilei NU a fost atins', gh.fisiere[`jurnale/${azi}.json`] === b64(jurnal(500)));
  ok('varianta mică s-a salvat separat',
     gh.puts.length === 1 && gh.puts[0].path === `jurnale/${azi}-partial-12.json`,
     JSON.stringify(gh.puts.map(p => p.path)));
  ok('fără sha → nu poate suprascrie din greșeală', gh.puts[0].sha === undefined);
  ok('anomalia e semnalată cu cifre', st.some(s => /12/.test(s) && /500/.test(s)), JSON.stringify(st));
}

console.log('\n═══ Cazul normal: jurnalul crește, se suprascrie ═══');
{
  const gh = fakeGitHub({ [`jurnale/${azi}.json`]: b64(jurnal(500)) });
  await mk(jurnal(640)).pushNow('stop');
  ok('s-a scris peste fișierul zilei',
     gh.puts.length === 1 && gh.puts[0].path === `jurnale/${azi}.json`);
  ok('cu sha-ul versiunii curente', gh.puts[0].sha === `sha-jurnale/${azi}.json`);
}

console.log('\n═══ Prima urcare a zilei (nu există fișier) ═══');
{
  const gh = fakeGitHub({});
  ok('urcarea reușește', await mk(jurnal(30)).pushNow('auto') === true);
  ok('fără sha, cale normală',
     gh.puts[0].path === `jurnale/${azi}.json` && gh.puts[0].sha === undefined);
}

console.log('\n═══ Fișier urcat corupt: necunoscutul nu blochează ziua ═══');
{
  const gh = fakeGitHub({ [`jurnale/${azi}.json`]: Buffer.from('}{nu e json', 'utf8').toString('base64') });
  await mk(jurnal(30)).pushNow('auto');
  ok('urcarea continuă pe calea normală',
     gh.puts.length === 1 && gh.puts[0].path === `jurnale/${azi}.json`,
     JSON.stringify(gh.puts.map(p => p.path)));
}

console.log('\n═══ Fără token: nu se încearcă nimic ═══');
{
  const gh = fakeGitHub({});
  const s = makeSync({ getToken: () => '', repo: 'x/y', exportFn: async () => jurnal(9) });
  ok('refuz curat', await s.pushNow('auto') === false);
  ok('zero cereri', gh.puts.length === 0);
}

console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
process.exit(fail ? 1 : 0);
