// RALI 2 · maps.js — traseul și întoarcerea, predate aplicației Google Maps.
//
// Decizia lui Andreas (04.08.2026), după ce busola în linie dreaptă nu l-a adus înapoi:
// ghidajul pe străzi îl face Maps, care are hărțile, sensurile unice și vocea. RALI îi dă
// punctele și rămâne cu ce știe el: kilometrajul oficial, probele, ceasul și boxurile.
// Zero servicii de rutare în aplicație — doar linkuri.
//
// Linkurile se construiesc AICI, ca funcții pure: un URL greșit se vede într-un test, nu
// pe telefon, în mașină, la 50 km/h.

// Google acceptă până la 9 puncte intermediare pe un link de traseu; al zecelea e
// destinația. Peste atât, traseul se taie în bucăți consecutive.
export const MAX_WAYPOINTS = 9;

const coord = p => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;

function valid(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
         Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

// NAVIGARE către un singur punct — folosit de ecranul „întoarcere la traseu".
// Fără `origin`: Maps pleacă de la poziția curentă a telefonului și arată butonul de
// pornire a navigării. (Aceeași convenție ca la linkurile de recunoaștere.)
export function linkNavigare(pct) {
  if (!valid(pct)) return null;
  return 'https://www.google.com/maps/dir/?api=1' +
         `&destination=${encodeURIComponent(coord(pct))}` +
         '&travelmode=driving';
}

// CARE ancore intră în link, când sunt mai multe decât încap. Ordinea importanței:
//  1. capetele bucății (start și destinație) — obligatorii;
//  2. punctele de care depinde cursa: TC-uri, linii de start/finish de probă;
//  3. restul, distribuite uniform, ca linia să semene cu traseul, nu cu o scurtătură.
export function alegeWaypoints(ancore, max = MAX_WAYPOINTS) {
  const mijloc = ancore.slice(1, -1);
  if (mijloc.length <= max) return mijloc;
  const importante = mijloc.filter(a => a.flag);
  const alese = new Set(importante.slice(0, max).map(a => a.num));
  if (alese.size < max) {
    const restul = mijloc.filter(a => !alese.has(a.num));
    const cateMai = max - alese.size;
    const pas = restul.length / cateMai;
    for (let i = 0; i < cateMai; i++) alese.add(restul[Math.floor(i * pas)].num);
  }
  return mijloc.filter(a => alese.has(a.num));
}

// TRASEUL întreg, ca unul sau mai multe linkuri consecutive. Fiecare bucată începe de
// unde s-a terminat cea dinainte, ca să nu rămână drum nedescris între ele.
export function linkuriTraseu(ancore, { max = MAX_WAYPOINTS } = {}) {
  const bune = (ancore || []).filter(valid).sort((a, b) => a.sumKm - b.sumKm);
  if (bune.length < 2) return [];
  const perBucata = max + 2;                       // start + 9 intermediare + destinație
  const bucati = [];
  for (let i = 0; i < bune.length - 1; i += perBucata - 1)
    bucati.push(bune.slice(i, i + perBucata));
  return bucati.map((b, i) => {
    const wp = alegeWaypoints(b, max);
    const url = 'https://www.google.com/maps/dir/?api=1' +
      `&destination=${encodeURIComponent(coord(b[b.length - 1]))}` +
      (wp.length ? `&waypoints=${wp.map(p => encodeURIComponent(coord(p))).join('%7C')}` : '') +
      '&travelmode=driving';
    return {
      url,
      eticheta: bucati.length === 1
        ? `Traseul pe Google Maps (boxurile ${b[0].num}–${b[b.length - 1].num})`
        : `Partea ${i + 1} din ${bucati.length}: boxurile ${b[0].num}–${b[b.length - 1].num}`,
      deLaBox: b[0].num, panaLaBox: b[b.length - 1].num, puncte: wp.length + 2
    };
  });
}
