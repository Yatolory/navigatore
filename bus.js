/* Mezzi pubblici di Perugia: dati dall'artifact «Linee Bus Perugia»
   (percorsi e fermate da OpenStreetMap, orari ufficiali Busitalia).
   L'orario ufficiale dà i minuti solo alle fermate principali: per le altre
   il passaggio è stimato in proporzione alla distanza. */
(function (root) {
  const S = 1e5, rad = d => d * Math.PI / 180;
  const hav = (a, b) => { const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]), s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(s)); };
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'()\-\/,]/g, ' ').replace(/\s+/g, ' ').trim();
  const GENERIC = new Set(['viale', 'piazza', 'piazzale', 'strada', 'capolinea', 'sant', 'santa', 'della', 'delle', 'degli', 'dello', 'civico', 'largo', 'corso']);
  const words = s => norm(s).split(' ').filter(w => w.length > 3 && !GENERIC.has(w));
  const nameMatch = (a, b) => { const wa = words(a), wb = words(b); return wa.some(w => wb.some(x => x.startsWith(w) || w.startsWith(x))); };
  const WALK = 75, DETOUR = 1.3;                 // metri al minuto a piedi; strada reale rispetto alla linea d'aria
  const walkMin = m => m * DETOUR / WALK;

  // ---- calendario del servizio (stesse regole dell'artifact) ----
  const BRANCH = { A5: 'casaglia', A6: 'breccia', C2: 'erminio', E1: 'enea', E2: 'rossa', E3: 'vetturino', F1: 'mariano', F2: 'misericordia', H1: 'firenze', H2: 'colle maggio', N1: 'laghetto', N2: 'campolonghi', P1: 'piccione', P2: 'diavolo', P3: 'pitignano', Q1: 'balanzano', Q2: 'collestrada' };
  const NOTE_RULE = {
    SLV: i => i.school && i.dow >= 1 && i.dow <= 5, SLS: i => i.school && i.dow >= 1, SS: i => i.school && i.dow === 6,
    NSLS: i => !i.school && i.dow >= 1, SG: i => i.school && i.dow === 4, SM: i => i.school && i.dow === 2,
    FLV: i => i.dow >= 1 && i.dow <= 5, F5NSS: i => (i.dow >= 1 && i.dow <= 5) || (i.dow === 6 && !i.school),
    FLR: i => i.dow === 1 || i.dow === 3, FMGV: i => [2, 4, 5].includes(i.dow),
  };
  const dayNum = d => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
    return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1);
  }
  function dayInfo(dt) {
    const md = (dt.getMonth() + 1) * 100 + dt.getDate(), dow = dt.getDay(), today = dayNum(dt), e = dayNum(easter(dt.getFullYear()));
    const festivo = dow === 0 || [101, 106, 129, 425, 501, 602, 815, 1101, 1208, 1225, 1226].includes(md) || today === e + 1;
    const special = [1225, 101, 501].includes(md);
    const school = (md >= 914 || md <= 608) && !(md >= 1223 || md <= 106) && !(today >= e - 3 && today <= e + 2) && !festivo;
    return { dow, festivo, special, easterDay: today === e, school };
  }
  function pickService(svcs, info) {
    let best = -1, score = 0;
    svcs.forEach((s, i) => {
      const r = s.raw; let sc = 0;
      if (info.festivo || info.easterDay) {
        if (r.startsWith('festivo speciale')) sc = info.special ? 3 : 0;
        else if (r.startsWith('festivo')) sc = info.special && svcs.some(x => x.raw.startsWith('festivo speciale')) ? 1 : 2;
      } else if (!r.startsWith('festivo')) {
        const sat = info.dow === 6;
        const dayOk = r.includes('lunedì a sabato') || (r.includes('lunedì a venerdì') ? !sat : r.includes('sabato') ? sat : true);
        const kindOk = r.startsWith('non scolastica') ? !info.school : r.startsWith('scolastica') ? info.school : true;
        if (dayOk && kindOk) sc = r.startsWith('feriale') ? 2 : 3;
      }
      if (sc > score) { score = sc; best = i; }
    });
    return best;
  }
  const firstT = t => t.find(x => x != null && x >= 0);
  const absT = (t, i) => { const v = t[i]; return v < 240 && firstT(t) > 720 ? v + 1440 : v; };

  // ---- abbinamento fermate dell'orario ↔ fermate sulla mappa, rispettando l'ordine ----
  function matchStops(ttStops, osmStops) {
    const pairs = [];
    ttStops.forEach((n, i) => osmStops.forEach((s, j) => { if (nameMatch(n, s.name)) pairs.push({ i, j, n: 1, prev: -1 }); }));
    let best = -1;
    pairs.forEach((p, k) => {
      for (let q = 0; q < k; q++) { const o = pairs[q]; if (o.i < p.i && o.j < p.j && o.n + 1 > p.n) { p.n = o.n + 1; p.prev = q; } }
      if (best < 0 || p.n > pairs[best].n) best = k;
    });
    const out = [];
    for (let k = best; k >= 0; k = pairs[k].prev) out.unshift({ ti: pairs[k].i, oi: pairs[k].j });
    return out;
  }

  function decodePath(arr) { const pts = []; let y = 0, x = 0; for (let i = 0; i < arr.length; i += 2) { y += arr[i]; x += arr[i + 1]; pts.push([x / S, y / S]); } return pts; }

  let DATA = null, cache = { key: null, patterns: null };
  function load(lines, orari) { DATA = { lines: lines.lines, tt: orari }; cache = { key: null, patterns: null }; }
  const ready = () => !!DATA;

  // Un «pattern» = una linea in una direzione, con tutte le corse di quel giorno e l'orario stimato a ogni fermata.
  function patternsFor(date) {
    const key = date.toDateString();
    if (cache.key === key) return cache.patterns;
    const info = dayInfo(date), TT = DATA.tt, out = [];
    for (const line of DATA.lines) {
      const fam = TT.lines[line.ref] ? line.ref : TT.lines[line.ref.replace(/\d+$/, '')] ? line.ref.replace(/\d+$/, '') : null;
      if (!fam) continue;
      const svcs = TT.lines[fam].services, si = pickService(svcs, info);
      if (si < 0) continue;
      const children = Object.keys(BRANCH).filter(r => r !== fam && r.replace(/\d+$/, '') === fam);
      line.dirs.forEach((d, di) => {
        const stops = d.stops.map(s => ({ name: s[0], lat: s[1] / S, lng: s[2] / S }));
        if (stops.length < 2) return;
        const cum = [0]; for (let i = 1; i < stops.length; i++) cum.push(cum[i - 1] + hav([stops[i - 1].lng, stops[i - 1].lat], [stops[i].lng, stops[i].lat]));
        let td = null, anchors = [];
        svcs[si].dirs.forEach(x => { const m = matchStops(x.stops, stops); if (m.length > anchors.length) { anchors = m; td = x; } });
        if (!td || anchors.length < 2) return;
        const rowsOf = kw => td.stops.map((s, i) => norm(s).includes(kw) ? i : -1).filter(i => i >= 0);
        const serves = (t, rows) => rows.some(i => t[i] != null && t[i] >= 0);
        let trips = td.trips.filter(([, n]) => !n || !NOTE_RULE[n] || NOTE_RULE[n](info)).map(([t]) => t);
        if (line.ref !== fam && BRANCH[line.ref]) {        // diramazione: solo le sue corse
          const own = trips.filter(t => serves(t, rowsOf(BRANCH[line.ref])));
          if (own.length && own.length < trips.length) trips = own;
        } else if (line.ref === fam) {                     // linea madre: tolgo le corse delle diramazioni
          for (const c of children) { const rows = rowsOf(BRANCH[c]), rest = trips.filter(t => !serves(t, rows)); if (rows.length && rest.length && rest.length < trips.length) trips = rest; }
        }
        const runs = [];
        for (const t of trips) {
          const times = new Array(stops.length).fill(null);
          for (let k = 0; k < anchors.length; k++) {
            const a = anchors[k], va = t[a.ti];
            if (va == null || va < 0) continue;
            const ta = absT(t, a.ti); times[a.oi] = ta;
            const b = anchors[k + 1]; if (!b) continue;
            const vb = t[b.ti]; if (vb == null || vb < 0) continue;
            const tb = absT(t, b.ti), span = cum[b.oi] - cum[a.oi];
            if (tb < ta) continue;
            for (let j = a.oi + 1; j < b.oi; j++) times[j] = ta + (tb - ta) * (span ? (cum[j] - cum[a.oi]) / span : 0);
          }
          if (times.filter(x => x != null).length >= 2) runs.push(times);
        }
        if (runs.length) out.push({ ref: line.ref, dir: di, to: d.to, stops, cum, runs, exact: new Set(anchors.map(a => a.oi)), path: d.path });
      });
    }
    cache = { key, patterns: out };
    return out;
  }

  /* Cerca i bus diretti da origin a dest ([lng,lat]).
     pref 'primo'  → il primo bus che riesco a prendere entro 10 minuti a piedi;
     pref 'vicino' → la fermata più vicina, anche se c'è da aspettare. */
  function plan(origin, dest, date, pref) {
    const now = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
    const maxW1 = pref === 'primo' ? 10 : 30, maxW2 = 20, direct = walkMin(hav(origin, dest));
    const res = []; let nearO = Infinity, nearD = Infinity;
    for (const p of patternsFor(date)) {
      const w1 = p.stops.map(s => walkMin(hav(origin, [s.lng, s.lat]))), w2 = p.stops.map(s => walkMin(hav(dest, [s.lng, s.lat])));
      nearO = Math.min(nearO, ...w1); nearD = Math.min(nearD, ...w2);
      if (Math.min(...w1) > maxW1 || Math.min(...w2) > maxW2) continue;
      for (const times of p.runs) {
        let b = -1;                                   // fermata di salita: la più vicina che faccio in tempo a raggiungere
        for (let i = 0; i < times.length - 1; i++) if (times[i] != null && w1[i] <= maxW1 && times[i] >= now + w1[i] + 1 && (b < 0 || w1[i] < w1[b])) b = i;
        if (b < 0) continue;
        let e = -1;                                   // fermata di discesa: quella che mi fa arrivare prima
        for (let j = b + 1; j < times.length; j++) if (times[j] != null && w2[j] <= maxW2 && (e < 0 || times[j] + w2[j] < times[e] + w2[e])) e = j;
        if (e < 0 || p.cum[e] - p.cum[b] < 400 || w1[b] + w2[e] > direct * .9) continue;
        if (times[b] - now > 240) continue;
        const stop = (i) => ({ name: p.stops[i].name, lng: p.stops[i].lng, lat: p.stops[i].lat, t: times[i], exact: p.exact.has(i) });
        res.push({ line: p.ref, to: p.to, pattern: p, bi: b, ei: e, board: stop(b), alight: stop(e), walk1: w1[b], walk2: w2[e], nStops: e - b, wait: times[b] - now - w1[b], arr: times[e] + w2[e], dur: times[e] + w2[e] - now });
      }
    }
    res.sort(pref === 'primo' ? (a, b) => a.board.t - b.board.t || a.arr - b.arr : (a, b) => Math.round(a.walk1) - Math.round(b.walk1) || a.board.t - b.board.t);
    const seen = {}, out = [];
    for (const r of res) {
      const k = r.line + '|' + r.pattern.dir, k2 = k + '|' + Math.round(r.board.t);
      if (seen[k2] || (seen[k] || 0) >= 2) continue;
      seen[k2] = 1; seen[k] = (seen[k] || 0) + 1; out.push(r);
      if (out.length >= 6) break;
    }
    return { list: out, nearO, nearD };
  }

  // Geometria del tratto in bus tra salita e discesa.
  function legCoords(it) {
    const p = it.pattern, a = [it.board.lng, it.board.lat], b = [it.alight.lng, it.alight.lat];
    const near = (c, q) => { let bi = 0, bd = Infinity; c.forEach((x, i) => { const d = hav(x, q); if (d < bd) { bd = d; bi = i; } }); return { i: bi, d: bd }; };
    for (const seg of p.path) {
      const c = decodePath(seg), na = near(c, a), nb = near(c, b);
      if (na.d < 80 && nb.d < 80 && nb.i > na.i) return [a, ...c.slice(na.i, nb.i + 1), b];
    }
    return p.stops.slice(it.bi, it.ei + 1).map(s => [s.lng, s.lat]);   // ripiego: linea che unisce le fermate
  }
  const hhmm = v => { const m = Math.round(v) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  const api = { load, ready, plan, legCoords, hhmm, patternsFor, dayInfo };
  if (typeof module !== 'undefined') module.exports = api; else root.Bus = api;
})(typeof window !== 'undefined' ? window : globalThis);
