// ── Constanten ──
const STANDAARD_DAGEN_LEREN = {
  Mondeling: 7, Proefwerk: 4, SO: 1, Luistertoets: 0,
  Schrijfvaardigheid: 2, PO: 14, Anders: 3
};

// ── Datumhulpfuncties ──
function normaliseer(d) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function addDagen(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); r.setHours(0,0,0,0); return r; }
function parseDatum(s) { return normaliseer(new Date(s + 'T00:00:00')); }
function toDatumStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getMaandag(d) {
  const r = normaliseer(d);
  const diff = r.getDay() === 0 ? -6 : 1 - r.getDay();
  r.setDate(r.getDate() + diff); return r;
}
function isoWeek(datumStr) {
  const d = new Date(datumStr + 'T00:00:00');
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return d.getFullYear() + '-W' +
    String(1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7)).padStart(2, '0');
}
function getMaandagVanIsoWeek(isoWeekStr) {
  const [jaarStr, weekStr] = isoWeekStr.split('-W');
  const jaar = parseInt(jaarStr), week = parseInt(weekStr);
  const jan4 = new Date(jaar, 0, 4);
  const jan4Dag = (jan4.getDay() + 6) % 7;
  const maandag = new Date(jan4);
  maandag.setDate(jan4.getDate() - jan4Dag + (week - 1) * 7);
  return maandag;
}

// ── Planningshulpfuncties ──
function getLeerDagen(type, moeilijkheid) {
  const inst = JSON.parse(localStorage.getItem('instellingen') || '{}');
  const key = type || 'Anders';
  const basis = inst[key] !== undefined ? inst[key]
    : (STANDAARD_DAGEN_LEREN[key] !== undefined ? STANDAARD_DAGEN_LEREN[key] : STANDAARD_DAGEN_LEREN.Anders);
  if (basis === 0) return 0;
  return Math.max(1, Math.round(basis * ((moeilijkheid || 5) / 5)));
}

function getVakAanpassing(vakNaam) {
  return JSON.parse(localStorage.getItem('feedback') || '[]')
    .filter(f => f.vak === vakNaam)
    .reduce((acc, f) => acc + (f.antwoord === 'te-weinig' ? 2 : f.antwoord === 'te-veel' ? -1 : 0), 0);
}

function getCijferAanpassing(vakNaam) {
  const lijst = JSON.parse(localStorage.getItem('cijfers') || '[]')
    .filter(c => c.vakNaam === vakNaam)
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
  return !lijst.length ? 0 : (lijst[lijst.length - 1].cijfer <= 6 ? 2 : 0);
}

// ── berekenBegindatum ──
// Berekent de aanbevolen startdatum voor leren en geeft de datum + metadata terug.
// vakInstellingen: { naam, moeilijkheid, extraLeerDagen? }
// Geeft null terug als de toets geen leervoorbereiding vereist.
function berekenBegindatum(toets, vakInstellingen, schooldagen, trainingen, cijfers) {
  const leerDagen = getLeerDagen(toets.type, vakInstellingen.moeilijkheid);
  if (leerDagen === 0) return null;

  // Cijfer aanpassing: 2 extra dagen als laatste cijfer ≤ 6
  const vakCijfers = (cijfers || [])
    .filter(c => c.vakNaam === vakInstellingen.naam)
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
  const cijferAanpassing = vakCijfers.length && vakCijfers[vakCijfers.length - 1].cijfer <= 6 ? 2 : 0;

  // Vak feedback aanpassing
  const vakAanpassing = getVakAanpassing(vakInstellingen.naam);

  // Sessie aanpassing: +1 dag als minder dan 50% van geplande sessies gedaan vorige week
  const gepland = JSON.parse(localStorage.getItem('plan_gepland') || '{}');
  const gedaan  = JSON.parse(localStorage.getItem('plan_gedaan')  || '{}');
  const nu = normaliseer(new Date());
  let n = 0, g = 0;
  for (let i = 1; i <= 7; i++) {
    const d = addDagen(nu, -i);
    const p = gepland[toDatumStr(d)];
    if (p && p.vakNaam === vakInstellingen.naam) { n++; if (gedaan[toDatumStr(d)]) g++; }
  }
  const sessieRate = n >= 2 ? g / n : null;
  const sessieAanpassing = (sessieRate !== null && sessieRate < 0.5) ? 1 : 0;

  const extraLeerDagen = vakInstellingen.extraLeerDagen || 0;

  const beginD = parseDatum(toets.datum);
  beginD.setDate(beginD.getDate() - leerDagen - cijferAanpassing - vakAanpassing - sessieAanpassing - extraLeerDagen);

  // Verschuif naar vrije dag (niet bezet door werk of training)
  const werk = JSON.parse(localStorage.getItem('werk') || '[]');
  const vm   = JSON.parse(localStorage.getItem('vrijeMomenten') || '{}');
  function isHeleDagVrij(dag) {
    const v = vm[dag.getDay()];
    return !!(v && typeof v === 'object' && v.heleDag);
  }
  function isDagBezet(dag) {
    if (isHeleDagVrij(dag)) return false;
    const w = dag.getDay();
    return werk.some(e => Array.isArray(e.dagen) && e.dagen.includes(w)) ||
           (trainingen || []).some(e => Array.isArray(e.dagen) && e.dagen.includes(w));
  }
  const datum = normaliseer(beginD);
  let verschoven = false, max = 14;
  while (isDagBezet(datum) && max-- > 0) { datum.setDate(datum.getDate() - 1); verschoven = true; }
  const ideaal = isHeleDagVrij(datum);

  // Tijdsdeel: wanneer op die dag begonnen kan worden
  const isSchooldag = schooldagen ? schooldagen.includes(datum.getDay()) : true;
  const schoolEinde = localStorage.getItem('schoolEinde') || null;
  const vrijData = vm[datum.getDay()];
  const vrijTijd = vrijData ? (typeof vrijData === 'string' ? vrijData : vrijData.tijd) : null;
  const tijdDeel = isSchooldag && schoolEinde ? ` na ${schoolEinde}` : (vrijTijd ? `, vrij vanaf ${vrijTijd}` : '');

  return { datum, verschoven, ideaal, tijdDeel, cijferAanpassing, vakAanpassing, sessieAanpassing };
}

// ── berekenDrukkeDagen ──
// Geeft de drukscore van een week terug: aantal toetsen + huiswerk + eenmalige afspraken.
// vakken: array van vak-objecten (met toetsen en huiswerk), afspraken: array van afspraken.
function berekenDrukkeDagen(weekMaandag, vakken, afspraken, trainingen) {
  const weekEinde = addDagen(weekMaandag, 7);
  const maStr = toDatumStr(weekMaandag);
  const zoStr = toDatumStr(addDagen(weekMaandag, 6));
  let score = 0;

  (vakken || []).forEach(v => {
    const toetsen = v.toetsen || (v.toetsdatum ? [{ datum: v.toetsdatum }] : []);
    toetsen.forEach(t => {
      if (!t.datum) return;
      const d = parseDatum(t.datum);
      if (d >= weekMaandag && d < weekEinde) score++;
    });
    (v.huiswerk || []).forEach(h => {
      if (!h.inleverdatum || h.gedaan) return;
      const ds = h.inleverdatum.slice(0,10);
      if (ds >= maStr && ds <= zoStr) score++;
    });
  });

  (afspraken || []).forEach(a => {
    if (a.afgerond || a.herhaling === 'wekelijks' || !a.datum) return;
    if (a.datum >= maStr && a.datum <= zoStr) score++;
  });

  return score;
}

// ── geefDagAdvies ──
// Geeft een leeradvies-tekst voor de opgegeven dag, of null als er geen actie nodig is.
// alleData: { vakken, schooldagen, schoolEinde, trainingen, afspraken }
function geefDagAdvies(dag, alleData) {
  const { vakken, schooldagen, schoolEinde, trainingen, afspraken } = alleData;
  const dagNr = dag.getDay();
  const dagStr = toDatumStr(dag);
  const isSchooldag = !schooldagen || schooldagen.includes(dagNr);

  const dagTr = (trainingen || [])
    .filter(t => Array.isArray(t.dagen) && t.dagen.includes(dagNr)
              && t.tijden && t.tijden[dagNr] && !t.tijden[dagNr].wisselend)
    .map(t => ({ naam: t.naam, begin: t.tijden[dagNr].begin || null }))
    .sort((a, b) => !a.begin ? 1 : !b.begin ? -1 : a.begin.localeCompare(b.begin));

  const dagAf = (afspraken || []).filter(a => {
    if (a.afgerond) return false;
    return a.herhaling === 'wekelijks'
      ? parseDatum(a.datum).getDay() === dagNr && a.datum <= dagStr
      : a.einddatum ? a.datum <= dagStr && dagStr <= a.einddatum : a.datum === dagStr;
  });

  const aantalBezet = dagTr.length + dagAf.length + (isSchooldag ? 1 : 0);

  // Vind de urgentste toets waarvoor nu geleerd moet worden
  const dagMs = dag.getTime();
  let best = null;
  (vakken || []).forEach(v => {
    const toetsen = v.toetsen || (v.toetsdatum ? [{ datum: v.toetsdatum, type: 'Anders' }] : []);
    toetsen.forEach(t => {
      if (!t.datum) return;
      const toetsMs = parseDatum(t.datum).getTime();
      if (toetsMs < dagMs) return;
      const dgn = getLeerDagen(t.type, v.moeilijkheid);
      if (dgn === 0) return;
      const beginMs = toetsMs - dgn * 86400000;
      if (dagMs >= beginMs && dagMs <= toetsMs) {
        if (!best || toetsMs < best.toetsMs) {
          best = { vakNaam: v.naam, toetsMs, dagenTot: Math.round((toetsMs - dagMs) / 86400000) };
        }
      }
    });
  });

  if (!best) return null;
  if (aantalBezet >= 3 && best.dagenTot > 1) return null;

  const vakNaam = best.vakNaam;
  const eersteT = dagTr[0];

  if (eersteT && eersteT.begin) return `${eersteT.naam} om ${eersteT.begin}, leer ${vakNaam} eerst`;
  if (!isSchooldag) return `Vrije dag, ideaal voor ${vakNaam}`;
  if (schoolEinde) return `Leer ${vakNaam} na ${schoolEinde}`;
  return `Leer ${vakNaam}`;
}
