import { useState, useEffect, useRef } from "react";

const C = {
  bg:      "#080E0A",
  surface: "#111A12",
  card:    "#1A2B1C",
  border:  "#2c3d27",
  accent:  "#c8a84b",
  green:   "#52D17C",
  red:     "#c0392b",
  muted:   "#6b7f63",
  text:    "#e8ead4",
  textSub: "#9aab8a",
  blue:    "#C4623A",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@600;700&family=Inter:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; color: ${C.text}; font-family: 'Inter', sans-serif; min-height: 100vh; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #2c3d27; border-radius: 3px; }
  input, select { background: #111A12; border: 1px solid #2c3d27; color: #e8ead4; border-radius: 6px; padding: 8px 12px; font-size: 14px; outline: none; width: 100%; }
  input:focus, select:focus { border-color: #c8a84b; }
  button { cursor: pointer; border: none; font-family: 'Inter', sans-serif; font-weight: 600; border-radius: 6px; transition: all .15s; }
  @keyframes crownGlow { 0%,100% { box-shadow: 0 0 8px #c8a84b33; } 50% { box-shadow: 0 0 20px #c8a84b88; } }
  .crown-glow { animation: crownGlow 2.5s ease-in-out infinite; }
  @keyframes slideUpM { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .slide-up { animation: popIn .22s cubic-bezier(.2,.8,.3,1) both; }
  @keyframes popIn { from { opacity: 0; transform: scale(.96) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
  .sheet-up { animation: slideUpM .3s cubic-bezier(.2,.8,.3,1) both; }
  .tile-press { transition: transform .12s ease; }
  .tile-press:active { transform: scale(.96); }
  @keyframes fadeTab { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .fade-tab { animation: fadeTab .25s ease; }
`;

const uid = () => Math.random().toString(36).slice(2, 8);
const ELO_START = 1000;
const K = 32;
const MIN_MATCHES = 3;

// ─── Supabase (données partagées en ligne) ───────────────────────────────────
const SUPABASE_URL = "https://xxjbhyxfkhxufisfuspk.supabase.co";
const SUPABASE_KEY = "sb_publishable_lK2zV4x6xnvJZ4ts5z-Gow_iPwH22tO";
const ADMIN_CODE_STORAGE = "folelli_admin_code";

async function loadFromCloud() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/league_data?id=eq.main&select=data`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) return { data: null, error: true };
    const rows = await res.json();
    if (Array.isArray(rows) && rows[0]?.data?.players) return { data: rows[0].data, error: false };
    return { data: null, error: false }; // base vide (pas encore initialisée)
  } catch {
    return { data: null, error: true };
  }
}

async function saveToCloud(adminCode, data) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_league_data`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ admin_code: adminCode, new_data: data })
    });
    if (!res.ok) return false;
    const ok = await res.json();
    return ok === true;
  } catch {
    return false;
  }
}

function eloExpected(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

// ─── Streak helper ───────────────────────────────────────────────────────────
function computeStreak(pid, sorted) {
  // Walk matches newest → oldest
  const byDate = [...sorted].slice().reverse();
  let streak = 0;
  let streakType = null;
  for (const m of byDate) {
    const inA = [m.a1, m.a2].includes(pid);
    const inB = [m.b1, m.b2].includes(pid);
    if (!inA && !inB) continue;
    const aSets = m.sets.filter(s => s.a > s.b).length;
    const bSets = m.sets.filter(s => s.b > s.a).length;
    const aWin = aSets > bSets;
    const won = (inA && aWin) || (inB && !aWin);
    const cur = won ? "W" : "L";
    if (streakType === null) { streakType = cur; streak = 1; }
    else if (cur === streakType) streak++;
    else break;
  }
  return { streak, streakType };
}

// ─── Partner / rival helpers ─────────────────────────────────────────────────
function computePartnerRival(pid, sorted, players) {
  const partnerStats = {}; // partnerId → {w, total}
  const rivalStats = {};   // rivalId → {w, total}

  sorted.forEach(m => {
    const inA = [m.a1, m.a2].includes(pid);
    const inB = [m.b1, m.b2].includes(pid);
    if (!inA && !inB) return;

    const aSets = m.sets.filter(s => s.a > s.b).length;
    const bSets = m.sets.filter(s => s.b > s.a).length;
    const aWin = aSets > bSets;
    const won = (inA && aWin) || (inB && !aWin);

    const partners = inA ? [m.a1, m.a2].filter(x => x !== pid) : [m.b1, m.b2].filter(x => x !== pid);
    const rivals = inA ? [m.b1, m.b2] : [m.a1, m.a2];

    partners.forEach(id => {
      if (!partnerStats[id]) partnerStats[id] = { w: 0, total: 0 };
      partnerStats[id].total++;
      if (won) partnerStats[id].w++;
    });
    rivals.forEach(id => {
      if (!rivalStats[id]) rivalStats[id] = { w: 0, total: 0 };
      rivalStats[id].total++;
      if (won) rivalStats[id].w++;
    });
  });

  const pName = id => players.find(p => p.id === id)?.name || "?";

  // Partenaire favori = celui avec qui on a le plus joué
  const bestPartner = Object.entries(partnerStats)
    .sort(([, a], [, b]) => b.total - a.total)[0];

  // Bête noire = adversaire avec un écart de 3+ défaites (l - w >= 3), sinon aucun
  const beteNoire = Object.entries(rivalStats)
    .map(([id, s]) => [id, s, (s.total - s.w) - s.w]) // écart défaites - victoires
    .filter(([, , gap]) => gap >= 3)
    .sort(([, , a], [, , b]) => b - a)[0];

  // Victime favorite = adversaire avec un écart de 3+ victoires (w - l >= 3), sinon aucun
  const victime = Object.entries(rivalStats)
    .map(([id, s]) => [id, s, s.w - (s.total - s.w)]) // écart victoires - défaites
    .filter(([, , gap]) => gap >= 3)
    .sort(([, , a], [, , b]) => b - a)[0];

  // Rival = adversaire le plus affronté
  const rival = Object.entries(rivalStats)
    .sort(([, a], [, b]) => b.total - a.total)[0];

  const topPartners = Object.entries(partnerStats)
    .sort(([, a], [, b]) => b.total - a.total || b.w - a.w)
    .slice(0, 3)
    .map(([id, s]) => ({ name: pName(id), w: s.w, total: s.total, wr: s.total > 0 ? Math.round(s.w / s.total * 100) : 0 }));

  return {
    topPartners,
    bestPartner: bestPartner ? { name: pName(bestPartner[0]), w: bestPartner[1].w, total: bestPartner[1].total } : null,
    beteNoire: beteNoire ? { name: pName(beteNoire[0]), w: beteNoire[1].w, total: beteNoire[1].total } : null,
    victime: victime ? { name: pName(victime[0]), w: victime[1].w, total: victime[1].total } : null,
    rival: rival ? { name: pName(rival[0]), w: rival[1].w, total: rival[1].total } : null,
  };
}

// ─── Main compute ─────────────────────────────────────────────────────────────
function computeElo(players, matches) {
  const ratings = {};
  const played = {};
  players.forEach(p => { ratings[p.id] = ELO_START; played[p.id] = 0; });

  const sorted = [...matches].map((m, i) => ({ ...m, _idx: i })).sort((a, b) => new Date(a.date) - new Date(b.date) || a._idx - b._idx);
  const history = {};
  players.forEach(p => { history[p.id] = [{ after: ELO_START, matchId: null }]; });
  const ratingSnapshots = []; // snapshot of all ratings after each match

  sorted.forEach(m => {
    const aSets = m.sets.filter(s => s.a > s.b).length;
    const bSets = m.sets.filter(s => s.b > s.a).length;
    const aWin = aSets > bSets;
    // 1-0 → ×0.70 | 2-0 → ×1.0 | 2-1 → ×0.85 | 1-1 STB → ×0.70
    const totalSetsPlayed = aSets + bSets;
    const kMult = m.superTieBreak ? 0.70 : totalSetsPlayed === 1 ? 0.70 : totalSetsPlayed === 2 ? 1.0 : 0.85;

    const teamA = [m.a1, m.a2].filter(id => ratings[id] !== undefined);
    const teamB = [m.b1, m.b2].filter(id => ratings[id] !== undefined);
    const avgA = teamA.reduce((s, id) => s + ratings[id], 0) / (teamA.length || 1);
    const avgB = teamB.reduce((s, id) => s + ratings[id], 0) / (teamB.length || 1);
    const expA = eloExpected(avgA, avgB);
    const expB = 1 - expA;
    const scoreA = aWin ? 1 : 0;
    const scoreB = aWin ? 0 : 1;
    const newRatings = { ...ratings };

    teamA.forEach(id => {
      const delta = Math.round(K * kMult * (scoreA - expA));
      newRatings[id] = ratings[id] + delta;
      played[id] = (played[id] || 0) + 1;
      history[id].push({ after: newRatings[id], matchId: m.id, delta });
    });
    teamB.forEach(id => {
      const delta = Math.round(K * kMult * (scoreB - expB));
      newRatings[id] = ratings[id] + delta;
      played[id] = (played[id] || 0) + 1;
      history[id].push({ after: newRatings[id], matchId: m.id, delta });
    });
    Object.assign(ratings, newRatings);
    ratingSnapshots.push({ ...ratings });
  });

  const stats = players.map(p => {
    const wins = sorted.filter(m => {
      const aSets = m.sets.filter(s => s.a > s.b).length;
      const bSets = m.sets.filter(s => s.b > s.a).length;
      const aWin = aSets > bSets;
      return (aWin && [m.a1, m.a2].includes(p.id)) || (!aWin && [m.b1, m.b2].includes(p.id));
    }).length;
    const losses = (played[p.id] || 0) - wins;
    const elo = ratings[p.id] ?? ELO_START;
    // Jeux gagnés / perdus + nombre de sets joués (hors STB)
    let gamesW = 0, gamesL = 0, setsPlayed = 0;
    sorted.forEach(m => {
      const inA = [m.a1, m.a2].includes(p.id);
      const inB = [m.b1, m.b2].includes(p.id);
      if (!inA && !inB) return;
      const realSets = m.superTieBreak ? m.sets.slice(0, -1) : m.sets; // exclure le STB des jeux
      realSets.forEach(s => {
        if (inA) { gamesW += s.a; gamesL += s.b; }
        else     { gamesW += s.b; gamesL += s.a; }
        setsPlayed++;
      });
    });
    const hist = history[p.id] || [];
    const lastDelta = hist.length > 1 ? hist[hist.length - 1].delta : null;
    const { streak, streakType } = computeStreak(p.id, sorted);
    const { bestPartner, beteNoire, victime, rival, topPartners } = computePartnerRival(p.id, sorted, players);
    // Évolution du classement sur les 5 derniers matchs du joueur
    const playerMatchIndexes = [];
    sorted.forEach((m, idx) => {
      if ([m.a1,m.a2,m.b1,m.b2].includes(p.id)) playerMatchIndexes.push(idx);
    });
    const qualifiedIds = players.filter(pl => (played[pl.id] || 0) >= MIN_MATCHES).map(pl => pl.id);
    const rankHistory = playerMatchIndexes.slice(-5).map(idx => {
      const snap = ratingSnapshots[idx];
      if (!snap) return null;
      const ranked = players.map(pl => ({ id: pl.id, elo: snap[pl.id] ?? ELO_START }))
        .sort((a, b) => b.elo - a.elo);
      return ranked.findIndex(r => r.id === p.id) + 1;
    }).filter(r => r !== null);
    const rankHistoryQ = playerMatchIndexes.slice(-5).map(idx => {
      const snap = ratingSnapshots[idx];
      if (!snap) return null;
      const ranked = players.filter(pl => qualifiedIds.includes(pl.id))
        .map(pl => ({ id: pl.id, elo: snap[pl.id] ?? ELO_START }))
        .sort((a, b) => b.elo - a.elo);
      const pos = ranked.findIndex(r => r.id === p.id);
      return pos >= 0 ? pos + 1 : null;
    }).filter(r => r !== null);

    // Points de la courbe interactive : rang + détail du match (5 derniers)
    const last5Idx = playerMatchIndexes.slice(-5);
    const curvePoints = last5Idx.map((idx, k) => {
      const m = sorted[idx];
      const aS = m.sets.filter(s => s.a > s.b).length;
      const bS = m.sets.filter(s => s.b > s.a).length;
      const inA = [m.a1, m.a2].includes(p.id);
      const won = (inA && aS > bS) || (!inA && bS > aS);
      const partnerId = inA ? (m.a1 === p.id ? m.a2 : m.a1) : (m.b1 === p.id ? m.b2 : m.b1);
      const opps = inA ? [m.b1, m.b2] : [m.a1, m.a2];
      const pn = id => players.find(pl => pl.id === id)?.name || "?";
      const setsTxt = m.sets.map(s => inA ? `${s.a}-${s.b}` : `${s.b}-${s.a}`).join(" · ");
      const d = new Date(m.date);
      const dateShort = `${d.getDate()}/${d.getMonth() + 1}`;
      const dateLong = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      const histEntry = (history[p.id] || []).find(h => h.matchId === m.id);
      const delta = histEntry ? histEntry.delta : 0;
      // Rang (tous joueurs) après ce match
      const snap = ratingSnapshots[idx];
      const rankedAll = players.map(pl => ({ id: pl.id, elo: snap ? (snap[pl.id] ?? ELO_START) : ELO_START })).sort((a, b) => b.elo - a.elo);
      const rank = rankedAll.findIndex(r => r.id === p.id) + 1;
      // Rang qualifiés après ce match
      const rankedQ = players.filter(pl => qualifiedIds.includes(pl.id))
        .map(pl => ({ id: pl.id, elo: snap ? (snap[pl.id] ?? ELO_START) : ELO_START })).sort((a, b) => b.elo - a.elo);
      const posQ = rankedQ.findIndex(r => r.id === p.id);
      const rankQ = posQ >= 0 ? posQ + 1 : null;
      return { rank, rankQ, dateShort, dateLong, won, partner: pn(partnerId), opp1: pn(opps[0]), opp2: pn(opps[1]), setsTxt, delta };
    });

    // 5 derniers matchs (enrichis)
    const pNameL = id => players.find(pl => pl.id === id)?.name || "?";
    const last5 = sorted.filter(m => [m.a1,m.a2,m.b1,m.b2].includes(p.id)).slice(-5).map(m => {
      const aSets = m.sets.filter(s => s.a > s.b).length;
      const bSets = m.sets.filter(s => s.b > s.a).length;
      const inA = [m.a1,m.a2].includes(p.id);
      const won = (inA && aSets>bSets)||(!inA && bSets>aSets);
      const partnerId = inA ? (m.a1 === p.id ? m.a2 : m.a1) : (m.b1 === p.id ? m.b2 : m.b1);
      const opps = inA ? [m.b1, m.b2] : [m.a1, m.a2];
      const setsTxt = m.sets.map(s => inA ? `${s.a}-${s.b}` : `${s.b}-${s.a}`).join(" · ");
      const dateTxt = new Date(m.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      return { won, partner: pNameL(partnerId), opp1: pNameL(opps[0]), opp2: pNameL(opps[1]), setsTxt, dateTxt };
    }).reverse();

    // Performance par format
    const formats = { "2-0": {w:0,l:0}, "2-1": {w:0,l:0}, "STB": {w:0,l:0}, "1set": {w:0,l:0} };
    sorted.forEach(m => {
      const inA = [m.a1,m.a2].includes(p.id), inB = [m.b1,m.b2].includes(p.id);
      if (!inA && !inB) return;
      const aSets = m.sets.filter(s=>s.a>s.b).length, bSets = m.sets.filter(s=>s.b>s.a).length;
      const won = (inA && aSets>bSets)||(!inA && bSets>aSets);
      const total = aSets + bSets;
      let fmt = total === 1 ? "1set" : m.superTieBreak ? "STB" : total === 2 ? "2-0" : "2-1";
      if (formats[fmt]) { if (won) formats[fmt].w++; else formats[fmt].l++; }
    });

    return { id: p.id, name: p.name, elo, played: played[p.id] || 0, wins, losses, lastDelta, history: hist, streak, streakType, bestPartner, beteNoire, victime, rival, topPartners, gamesW, gamesL, setsPlayed, last5, formats, rankHistory, rankHistoryQ, curvePoints };
  });

  stats.sort((a, b) => b.elo - a.elo || b.wins - a.wins);
  stats.forEach((p, i) => { p.currentRank = i + 1; });
  const qualifiedStats = stats.filter(p => p.played >= MIN_MATCHES);
  qualifiedStats.forEach((p, i) => { p.currentRankQ = i + 1; });

  // Difficulté du calendrier : formule hybride = moyenne entre l'ELO de l'adversaire
  // au moment du match et son ELO actuel (corrige les débutants sous-cotés à 1000)
  stats.forEach(p => {
    let totalOpp = 0, count = 0;
    sorted.forEach((m, idx) => {
      const inA = [m.a1, m.a2].includes(p.id);
      const inB = [m.b1, m.b2].includes(p.id);
      if (!inA && !inB) return;
      const pre = idx > 0 ? ratingSnapshots[idx - 1] : null;
      const g = id => {
        const atMatch = pre ? (pre[id] ?? ELO_START) : ELO_START;
        const current = ratings[id] ?? ELO_START;
        return (atMatch + current) / 2;
      };
      const opps = inA ? [m.b1, m.b2] : [m.a1, m.a2];
      totalOpp += (g(opps[0]) + g(opps[1])) / 2;
      count++;
    });
    p.avgOppElo = count > 0 ? Math.round(totalOpp / count) : null;
  });
  const calSorted = qualifiedStats.filter(p => p.avgOppElo !== null).slice().sort((a, b) => b.avgOppElo - a.avgOppElo);
  calSorted.forEach((p, i) => { p.calRank = i + 1; });
  stats.calCount = calSorted.length;

  // Compute rank movement vs previous match
  // Re-run ELO without the last match to get previous ranks
  if (sorted.length > 0) {
    const prevRatings = {};
    players.forEach(p => { prevRatings[p.id] = ELO_START; });
    const withoutLast = sorted.slice(0, -1);
    withoutLast.forEach(m => {
      const aSets = m.sets.filter(s => s.a > s.b).length;
      const bSets = m.sets.filter(s => s.b > s.a).length;
      const aWin = aSets > bSets;
      const totalSetsPlayed = aSets + bSets;
      const kMult = m.superTieBreak ? 0.70 : totalSetsPlayed === 1 ? 0.70 : totalSetsPlayed === 2 ? 1.0 : 0.85;
      const tA = [m.a1, m.a2].filter(id => prevRatings[id] !== undefined);
      const tB = [m.b1, m.b2].filter(id => prevRatings[id] !== undefined);
      const avgA = tA.reduce((s, id) => s + prevRatings[id], 0) / (tA.length || 1);
      const avgB = tB.reduce((s, id) => s + prevRatings[id], 0) / (tB.length || 1);
      const expA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400));
      const nr = { ...prevRatings };
      tA.forEach(id => { nr[id] = prevRatings[id] + Math.round(K * kMult * ((aWin ? 1 : 0) - expA)); });
      tB.forEach(id => { nr[id] = prevRatings[id] + Math.round(K * kMult * ((aWin ? 0 : 1) - (1 - expA))); });
      Object.assign(prevRatings, nr);
    });
    const prevStats = players.map(p => ({ id: p.id, elo: prevRatings[p.id] ?? ELO_START }))
      .sort((a, b) => b.elo - a.elo);
    const prevRankMap = {};
    prevStats.forEach((p, i) => { prevRankMap[p.id] = i + 1; });
    stats.forEach((p, i) => {
      const prevRank = prevRankMap[p.id];
      p.rankMove = prevRank !== undefined ? prevRank - (i + 1) : 0;
    });
  } else {
    stats.forEach(p => { p.rankMove = 0; });
  }


  // ── Historique des règnes (#1 après chaque match) ──
  const reigns = [];
  ratingSnapshots.forEach((snap, idx) => {
    const ranked = players.map(pl => ({ id: pl.id, elo: snap[pl.id] ?? ELO_START }))
      .sort((a, b) => b.elo - a.elo);
    const top = ranked[0]?.id;
    if (!top) return;
    if (reigns.length === 0 || reigns[reigns.length - 1].id !== top) {
      reigns.push({ id: top, start: idx + 1, length: 1 });
    } else {
      reigns[reigns.length - 1].length++;
    }
  });
  stats.reigns = reigns;
  stats.snapshots = ratingSnapshots;

  return stats;
}


// ─── Joueur du mois ───────────────────────────────────────────────────────────
// Score = ΔELO du mois + 3×victoires + (% jeux gagnés − 50)/2 · min 2 matchs
// Agrège les scores mensuels en trimestres et années
// Trimestres calendaires : T1 janv-mars, T2 avr-juin, T3 juil-sept, T4 oct-déc
// Trophées de l'année : Attaquant (jeux gagnés/set), Défenseur (jeux encaissés/set), Progression
// Seuil 5 matchs/an pour Attaquant & Défenseur. Progression 2026 : départ = ELO au 3e match (éligible dès 4 matchs).
function computeYearTrophies(players, matches, year) {
  const sorted = [...matches].map((m, i) => ({ ...m, _i: i }))
    .sort((a, b) => new Date(a.date) - new Date(b.date) || a._i - b._i);

  // Reconstruire les ELO chronologiquement pour connaître l'ELO à chaque match d'un joueur
  const K = 32, START = 1000;
  const ratings = {};
  players.forEach(p => { ratings[p.id] = START; });
  const eloAtMatch = {}; // playerId -> [{date, eloBefore, eloAfter, year}]
  players.forEach(p => { eloAtMatch[p.id] = []; });

  sorted.forEach(m => {
    const aS = m.sets.filter(s => s.a > s.b).length;
    const bS = m.sets.filter(s => s.b > s.a).length;
    const aWin = aS > bS; const total = aS + bS;
    const kM = m.superTieBreak ? 0.70 : (total === 1 ? 0.70 : (total === 2 ? 1.0 : 0.85));
    const avgA = (ratings[m.a1] + ratings[m.a2]) / 2;
    const avgB = (ratings[m.b1] + ratings[m.b2]) / 2;
    const eA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400));
    const dA = Math.round(K * kM * ((aWin ? 1 : 0) - eA));
    const dB = Math.round(K * kM * ((aWin ? 0 : 1) - (1 - eA)));
    const y = new Date(m.date).getFullYear();
    [m.a1, m.a2].forEach(id => { eloAtMatch[id].push({ before: ratings[id], after: ratings[id] + dA, year: y }); ratings[id] += dA; });
    [m.b1, m.b2].forEach(id => { eloAtMatch[id].push({ before: ratings[id], after: ratings[id] + dB, year: y }); ratings[id] += dB; });
  });

  // Stats de jeux par set, sur l'année demandée
  const stat = {};
  players.forEach(p => { stat[p.id] = { gW: 0, gL: 0, sets: 0, played: 0 }; });
  sorted.forEach(m => {
    if (new Date(m.date).getFullYear() !== year) return;
    const real = m.superTieBreak ? m.sets.slice(0, -1) : m.sets;
    [[m.a1, "A"], [m.a2, "A"], [m.b1, "B"], [m.b2, "B"]].forEach(([id, team]) => {
      if (!stat[id]) return;
      stat[id].played++;
      real.forEach(s => {
        const mine = team === "A" ? s.a : s.b;
        const theirs = team === "A" ? s.b : s.a;
        stat[id].gW += mine; stat[id].gL += theirs; stat[id].sets++;
      });
    });
  });

  const pName = id => players.find(p => p.id === id)?.name || "?";

  // Attaquant & Défenseur : seuil 5 matchs/an, égalité → plus de matchs
  const eligibleAD = players.map(p => p.id).filter(id => stat[id].played >= 5 && stat[id].sets > 0);
  const attaquant = eligibleAD
    .map(id => ({ id, name: pName(id), val: stat[id].gW / stat[id].sets, played: stat[id].played, sets: stat[id].sets }))
    .sort((a, b) => b.val - a.val || b.played - a.played);
  const defenseur = eligibleAD
    .map(id => ({ id, name: pName(id), val: stat[id].gL / stat[id].sets, played: stat[id].played, sets: stat[id].sets }))
    .sort((a, b) => a.val - b.val || b.played - a.played);

  // Progression
  const progression = players.map(p => p.id).map(id => {
    const ms = eloAtMatch[id].filter(e => e.year === year);
    if (ms.length === 0) return null;
    const careerThisYearCount = ms.length;
    let base;
    if (year === 2026) {
      // départ = ELO au 3e match (before), éligible dès le 4e match de carrière
      const all = eloAtMatch[id];
      if (all.length < 4) return null;
      base = all[2].before; // ELO avant le 3e match = point de départ
    } else {
      // départ = ELO au 1er janvier = before du 1er match de l'année
      base = ms[0].before;
    }
    const current = eloAtMatch[id][eloAtMatch[id].length - 1].after;
    return { id, name: pName(id), val: current - base, played: careerThisYearCount };
  }).filter(Boolean).sort((a, b) => b.val - a.val || b.played - a.played);

  return { attaquant, defenseur, progression };
}

function computePeriods(players, matches) {
  const rawMonthly = computeMonthly(players, matches); // { "YYYY-MM": [ {id, score, dElo, wins, played, pct}, ... ] }
  const pName = id => players.find(p => p.id === id)?.name || "?";

  // Éligibilité aux titres : réservée aux joueurs du classement officiel (MIN_MATCHES en carrière)
  const careerCount = {};
  matches.forEach(m => [m.a1, m.a2, m.b1, m.b2].forEach(id => { careerCount[id] = (careerCount[id] || 0) + 1; }));
  const eligible = id => (careerCount[id] || 0) >= MIN_MATCHES;

  const monthly = {};
  Object.entries(rawMonthly).forEach(([month, rows]) => {
    const kept = rows.filter(r => eligible(r.id));
    if (kept.length > 0) monthly[month] = kept;
  });

  const quarterOf = m => Math.floor((parseInt(m.split("-")[1]) - 1) / 3) + 1;

  const aggregate = keyFn => {
    const buckets = {}; // periodKey -> playerId -> cumulScore
    Object.entries(monthly).forEach(([month, rows]) => {
      const key = keyFn(month);
      if (!buckets[key]) buckets[key] = {};
      rows.forEach(r => {
        buckets[key][r.id] = (buckets[key][r.id] || 0) + r.score;
      });
    });
    const result = {};
    Object.entries(buckets).forEach(([key, byPlayer]) => {
      const rows = Object.entries(byPlayer)
        .map(([id, score]) => ({ id, score: Math.round(score * 10) / 10 }))
        .sort((a, b) => b.score - a.score);
      if (rows.length > 0) result[key] = rows;
    });
    return result;
  };

  const quarters = aggregate(m => `${m.split("-")[0]}-T${quarterOf(m)}`);
  const years = aggregate(m => m.split("-")[0]);

  return { monthly, quarters, years, pName };
}

function computeMonthly(players, matches) {
  const sorted = [...matches].map((m, i) => ({ ...m, _idx: i })).sort((a, b) => new Date(a.date) - new Date(b.date) || a._idx - b._idx);
  const ratings = {};
  players.forEach(p => { ratings[p.id] = ELO_START; });
  const monthly = {}; // month -> playerId -> stats

  sorted.forEach(m => {
    const month = new Date(m.date).toISOString().slice(0, 7);
    const aS = m.sets.filter(s => s.a > s.b).length;
    const bS = m.sets.filter(s => s.b > s.a).length;
    const aWin = aS > bS;
    const total = aS + bS;
    const kM = m.superTieBreak ? 0.70 : total === 1 ? 0.70 : total === 2 ? 1.0 : 0.85;
    const tA = [m.a1, m.a2].filter(id => ratings[id] !== undefined);
    const tB = [m.b1, m.b2].filter(id => ratings[id] !== undefined);
    const avgA = tA.reduce((s, id) => s + ratings[id], 0) / (tA.length || 1);
    const avgB = tB.reduce((s, id) => s + ratings[id], 0) / (tB.length || 1);
    const expA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400));
    const dA = Math.round(K * kM * ((aWin ? 1 : 0) - expA));
    const dB = Math.round(K * kM * ((aWin ? 0 : 1) - (1 - expA)));
    const real = m.superTieBreak ? m.sets.slice(0, -1) : m.sets;
    const gA = real.reduce((s, x) => s + x.a, 0);
    const gB = real.reduce((s, x) => s + x.b, 0);
    if (!monthly[month]) monthly[month] = {};
    const upd = (id, delta, won, gw, gl) => {
      if (ratings[id] === undefined) return;
      if (!monthly[month][id]) monthly[month][id] = { dElo: 0, wins: 0, played: 0, gW: 0, gL: 0 };
      const s = monthly[month][id];
      s.dElo += delta; s.played += 1; s.gW += gw; s.gL += gl;
      if (won) s.wins += 1;
      ratings[id] += delta;
    };
    tA.forEach(id => upd(id, dA, aWin, gA, gB));
    tB.forEach(id => upd(id, dB, !aWin, gB, gA));
  });

  // Build ranked list per month
  const result = {};
  Object.entries(monthly).forEach(([month, byPlayer]) => {
    const rows = Object.entries(byPlayer)
      .filter(([, s]) => s.played >= 2)
      .map(([id, s]) => {
        const pct = (s.gW + s.gL) > 0 ? (s.gW / (s.gW + s.gL)) * 100 : 50;
        const score = s.dElo + 3 * s.wins + (pct - 50) / 2;
        return { id, score: Math.round(score * 10) / 10, dElo: s.dElo, wins: s.wins, played: s.played, pct: Math.round(pct) };
      })
      .sort((a, b) => b.score - a.score || b.dElo - a.dElo || b.pct - a.pct);
    if (rows.length > 0) result[month] = rows;
  });
  return result;
}

// ─── Duo stats ────────────────────────────────────────────────────────────────
function computeDuos(players, matches) {
  const duos = {};
  const sorted = [...matches].map((m, i) => ({ ...m, _idx: i })).sort((a, b) => new Date(a.date) - new Date(b.date) || a._idx - b._idx);

  // Individual win rates for complementarity
  const indiv = {};
  players.forEach(p => { indiv[p.id] = { w: 0, l: 0 }; });

  const getDuo = (p1, p2) => {
    const key = [p1, p2].sort().join("__");
    if (!duos[key]) duos[key] = {
      key, p1: [p1,p2].sort()[0], p2: [p1,p2].sort()[1],
      w: 0, l: 0, elo: ELO_START, gamesW: 0, gamesL: 0, matchList: []
    };
    return duos[key];
  };

  sorted.forEach(m => {
    const aSets = m.sets.filter(s => s.a > s.b).length;
    const bSets = m.sets.filter(s => s.b > s.a).length;
    const aWin = aSets > bSets;
    const totalSetsPlayed = aSets + bSets;
    const kMult = m.superTieBreak ? 0.70 : totalSetsPlayed === 1 ? 0.70 : totalSetsPlayed === 2 ? 1.0 : 0.85;

    const duoA = getDuo(m.a1, m.a2);
    const duoB = getDuo(m.b1, m.b2);

    // Duo ELO transfer
    const expA = eloExpected(duoA.elo, duoB.elo);
    const deltaA = Math.round(K * kMult * ((aWin ? 1 : 0) - expA));
    const deltaB = Math.round(K * kMult * ((aWin ? 0 : 1) - (1 - expA)));
    duoA.elo += deltaA;
    duoB.elo += deltaB;

    // Games
    const realSetsD = m.superTieBreak ? m.sets.slice(0, -1) : m.sets;
    const gamesA = realSetsD.reduce((s, x) => s + x.a, 0);
    const gamesB = realSetsD.reduce((s, x) => s + x.b, 0);
    duoA.gamesW += gamesA; duoA.gamesL += gamesB;
    duoB.gamesW += gamesB; duoB.gamesL += gamesA;

    // W/L + match list
    if (aWin) { duoA.w++; duoB.l++; } else { duoB.w++; duoA.l++; }
    duoA.matchList.push({ ...m, won: aWin, isTeamA: true, deltaElo: deltaA });
    duoB.matchList.push({ ...m, won: !aWin, isTeamA: false, deltaElo: deltaB });

    // Individual W/L
    [m.a1, m.a2].forEach(id => { if (indiv[id]) { if (aWin) indiv[id].w++; else indiv[id].l++; } });
    [m.b1, m.b2].forEach(id => { if (indiv[id]) { if (!aWin) indiv[id].w++; else indiv[id].l++; } });
  });

  const pName = id => players.find(p => p.id === id)?.name || "?";

  return Object.values(duos)
    .filter(d => d.w + d.l >= 2)
    .map(d => {
      const played = d.w + d.l;
      const winRate = Math.round((d.w / played) * 100);
      // Complémentarité : win rate du duo vs moyenne des win rates individuels
      const wr1 = indiv[d.p1] && (indiv[d.p1].w + indiv[d.p1].l) > 0 ? indiv[d.p1].w / (indiv[d.p1].w + indiv[d.p1].l) : 0;
      const wr2 = indiv[d.p2] && (indiv[d.p2].w + indiv[d.p2].l) > 0 ? indiv[d.p2].w / (indiv[d.p2].w + indiv[d.p2].l) : 0;
      const avgIndiv = Math.round(((wr1 + wr2) / 2) * 100);
      const synergy = winRate - avgIndiv;
      return {
        ...d, played, winRate,
        label: pName(d.p1) + " / " + pName(d.p2),
        name1: pName(d.p1), name2: pName(d.p2),
        avgIndiv, synergy,
      };
    })
    .sort((a, b) => b.elo - a.elo || b.winRate - a.winRate);
}

// ─── Components ──────────────────────────────────────────────────────────────
function CountUp({ target }) {
  const [val, setVal] = useState(target);
  const raf = useRef(null);
  useEffect(() => {
    let start = null;
    const from = Math.max(0, target - 60);
    setVal(from);
    const animate = ts => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / 800, 1);
      setVal(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(animate);
    };
    raf.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return <>{val}</>;
}

function Rank({ n, qualified }) {
  const colors = ["#c8a84b", "#9eaebd", "#c07a3a"];
  const bg = colors[n - 1] || C.border;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 26, height: 26, borderRadius: "50%",
      background: n <= 3 ? bg : "transparent",
      border: n > 3 ? `1px solid ${qualified ? C.border : C.border + "66"}` : "none",
      fontSize: 13, fontWeight: 700,
      color: n <= 3 ? "#080E0A" : (qualified ? C.muted : C.muted + "66")
    }}>{n}</span>
  );
}

function EloDelta({ delta }) {
  if (delta === null || delta === undefined) return null;
  const color = delta > 0 ? C.green : delta < 0 ? C.red : C.muted;
  return (
    <span style={{ fontSize: 11, color, fontWeight: 600 }}>
      {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"}{Math.abs(delta)}
    </span>
  );
}

function MiniSparkline({ history }) {
  if (history.length < 2) return null;
  const vals = history.map(h => h.after);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 56, H = 20;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 2) - 1;
    return `${x},${y}`;
  }).join(" ");
  const last = vals[vals.length - 1];
  const first = vals[0];
  const color = last >= first ? C.green : C.red;
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function StreakBadge({ streak, streakType }) {
  if (!streak || streak < 2) return null;
  const isWin = streakType === "W";
  const color = isWin ? C.green : C.red;
  const icon = isWin ? "🔥" : "❄️";
  return (
    <span style={{ fontSize: 11, color, fontWeight: 700, background: color + "18", border: `1px solid ${color}44`, borderRadius: 4, padding: "1px 6px" }}>
      {icon} {streak} {isWin ? "victoires" : "défaites"}
    </span>
  );
}

function StatPill({ icon, label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 11 }}>
      <span>{icon}</span>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{ color: color || C.text, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Badge({ label, color }) {
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>
      {label}
    </span>
  );
}

function SetScore({ sets }) {
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      {sets.map((s, i) => (
        <span key={i} style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: s.a > s.b ? C.green : C.text }}>{s.a}</span>
          <span style={{ color: C.muted }}>-</span>
          <span style={{ color: s.b > s.a ? C.green : C.text }}>{s.b}</span>
        </span>
      ))}
    </span>
  );
}

// ─── Player detail modal ──────────────────────────────────────────────────────
function PlayerModal({ player, qualifiedOnly, monthTitles, calCount, onClose }) {
  const [selPoint, setSelPoint] = useState(null);
  useEffect(() => { setSelPoint(null); }, [player]);
  if (!player) return null;
  const winRate = player.played > 0 ? Math.round((player.wins / player.played) * 100) : 0;
  const gamePct = (player.gamesW + player.gamesL) > 0 ? Math.round(player.gamesW / (player.gamesW + player.gamesL) * 100) : null;
  const wrColor = v => v >= 60 ? C.green : v >= 40 ? C.accent : C.red;
  const titles = monthTitles || [];
  const rankLabel = r => r === 1 ? "1er" : `${r}ème`;

  // ── Courbe interactive : points = 5 derniers matchs + Auj. ──
  const useQ = qualifiedOnly && player.currentRankQ;
  const cps = (player.curvePoints || []).filter(cp => !useQ || cp.rankQ !== null);
  const currentRank = useQ ? player.currentRankQ : player.currentRank;
  const curveData = [
    ...cps.map(cp => ({ ...cp, r: useQ ? cp.rankQ : cp.rank, isToday: false })),
    { r: currentRank, dateShort: "Auj.", isToday: true },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 10px calc(100px + env(safe-area-inset-bottom))" }}
      onClick={onClose}>
      <div className="slide-up" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, maxHeight: "calc(100dvh - 150px)", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}>

        {/* ── Tête ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 30, letterSpacing: 2, color: C.text, lineHeight: 1 }}>{player.name}</span>
          <button onClick={onClose} style={{ background: C.border, color: C.muted, padding: "4px 10px", fontSize: 13 }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
          {player.currentRank ? `#${player.currentRank} du classement · ` : ""}{player.played} match{player.played > 1 ? "s" : ""} joué{player.played > 1 ? "s" : ""}
        </div>

        {/* ── 3 stats clés ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ background: `linear-gradient(135deg, ${C.accent}14, ${C.surface})`, border: `1px solid ${C.accent}44`, borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 30, color: C.accent, lineHeight: 1 }}><CountUp target={player.elo} /></div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 4, letterSpacing: 1 }}>ELO</div>
          </div>
          <div style={{ background: C.surface, borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 26, color: wrColor(winRate), lineHeight: 1.2 }}>{winRate}%</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 2, letterSpacing: 0.5 }}>WIN RATE ({player.wins}V-{player.losses}D)</div>
          </div>
          <div style={{ background: C.surface, borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 26, color: gamePct !== null ? wrColor(gamePct) : C.muted, lineHeight: 1.2 }}>{gamePct !== null ? gamePct + "%" : "—"}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 2, letterSpacing: 0.5 }}>JEUX GAGNÉS</div>
          </div>
        </div>

        {/* ── Palmarès ── */}
        {titles.length > 0 && (
          <div style={{ background: `linear-gradient(135deg, ${C.accent}10, ${C.surface})`, border: `1px solid ${C.accent}44`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>🏆</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>PALMARÈS · {titles.length} TITRE{titles.length > 1 ? "S" : ""}</div>
              {titles.map((t, i) => (
                <div key={i} style={{ fontSize: 12, fontWeight: 600, color: C.accent, lineHeight: 1.5 }}>🏆 {t}</div>
              ))}
            </div>
          </div>
        )}

        {/* ── Courbe interactive ── */}
        {curveData.length > 1 && player.played > 0 && (() => {
          const rh = curveData.map(p => p.r);
          const minR = Math.min(...rh), maxR = Math.max(...rh);
          const rankLevels = [];
          for (let r = minR; r <= maxR; r++) rankLevels.push(r);
          const VW = 320, VH = 30 + Math.max(rankLevels.length, 2) * 24;
          const PAD_L = 30, PAD_R = 16, PAD_T = 14, PAD_B = 20;
          const yFor = r => PAD_T + ((r - minR) / Math.max(maxR - minR, 1)) * (VH - PAD_T - PAD_B);
          const xFor = i => PAD_L + (i / (curveData.length - 1)) * (VW - PAD_L - PAD_R);
          const pts = curveData.map((p, i) => ({ ...p, x: xFor(i), y: maxR === minR ? VH / 2 : yFor(p.r) }));
          const line = pts.map(p => `${p.x},${p.y}`).join(" ");
          const selected = selPoint !== null && pts[selPoint] ? pts[selPoint] : null;
          return (
            <div style={{ background: C.surface, borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8, textAlign: "center" }}>
                PLACE AU CLASSEMENT{useQ ? " (QUALIFIÉS)" : ""}
              </div>
              <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", height: "auto", display: "block" }}>
                {rankLevels.map(r => (
                  <g key={r}>
                    <line x1={PAD_L} y1={maxR === minR ? VH / 2 : yFor(r)} x2={VW - PAD_R} y2={maxR === minR ? VH / 2 : yFor(r)}
                      stroke={C.border} strokeWidth="1" strokeDasharray={r === 1 ? "none" : "3,4"} opacity={r === 1 ? 0.9 : 0.5} />
                    <text x={PAD_L - 8} y={(maxR === minR ? VH / 2 : yFor(r)) + 3.5} textAnchor="end" fontSize="10" fontWeight="700"
                      fill={r === 1 ? C.accent : C.muted}>{r}{r === 1 ? "👑" : ""}</text>
                  </g>
                ))}
                <polyline points={line} fill="none" stroke={C.textSub} strokeWidth="2" strokeLinejoin="round" opacity="0.55" />
                {pts.map((p, i) => {
                  const isSel = selPoint === i;
                  const ptColor = p.isToday ? C.accent : p.won ? C.green : C.red;
                  return (
                    <g key={i} onClick={() => setSelPoint(selPoint === i ? null : i)} style={{ cursor: "pointer" }}>
                      <circle cx={p.x} cy={p.y} r="16" fill="transparent" />
                      {isSel && <circle cx={p.x} cy={p.y} r="10" fill={ptColor + "33"} />}
                      <circle cx={p.x} cy={p.y} r={p.isToday ? 6.5 : 5.5}
                        fill={p.isToday ? C.accent : isSel ? ptColor : C.card}
                        stroke={ptColor} strokeWidth="2.5" />
                    </g>
                  );
                })}
                {pts.map((p, i) => (
                  <text key={i} x={p.x} y={VH - 4} textAnchor="middle" fontSize="9"
                    fontWeight={p.isToday || selPoint === i ? "700" : "400"}
                    fill={p.isToday ? C.accent : selPoint === i ? C.text : C.muted}>{p.dateShort}</text>
                ))}
              </svg>

              {selected && !selected.isToday && (
                <div key={selPoint} style={{
                  marginTop: 10, background: C.card,
                  border: `1px solid ${selected.won ? C.green + "44" : C.red + "44"}`,
                  borderRadius: 8, padding: "10px 12px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.muted }}>
                        <span style={{ color: selected.won ? C.green : C.red, fontWeight: 700 }}>{selected.won ? "V" : "D"} avec {selected.partner}</span>
                        {" · "}{selected.dateLong}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>vs {selected.opp1} / {selected.opp2}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
                      <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15, color: selected.won ? C.green : C.red }}>{selected.setsTxt}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: selected.delta > 0 ? C.green : selected.delta < 0 ? C.red : C.muted }}>
                        {selected.delta > 0 ? "+" : ""}{selected.delta} ELO
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>→ {rankLabel(selected.r)} au classement après ce match</div>
                </div>
              )}
              {selected && selected.isToday && (
                <div key={selPoint} style={{ marginTop: 10, background: C.card, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                  <span style={{ fontSize: 12, color: C.accent, fontWeight: 700 }}>Position actuelle : {rankLabel(selected.r)}{selected.r === 1 ? " 👑" : ""}</span>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>● Victoire</span>
                <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>● Défaite</span>
                <span style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>● Aujourd'hui</span>
              </div>
              <div style={{ fontSize: 11, color: C.accent, textAlign: "center", marginTop: 6, fontWeight: 600 }}>
                👆 Appuie sur un point pour voir le détail du match
              </div>
            </div>
          );
        })()}

        {/* ── Ses partenaires (top 3) ── */}
        {player.topPartners && player.topPartners.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.muted, marginBottom: 8 }}>🤝 SES PARTENAIRES</div>
            <div style={{ background: C.surface, borderRadius: 10, padding: "6px 12px", marginBottom: 14 }}>
              {player.topPartners.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: i < player.topPartners.length - 1 ? `1px solid ${C.border}55` : "none" }}>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, width: 14 }}>{i + 1}.</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{p.total} match{p.total > 1 ? "s" : ""}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: wrColor(p.wr), width: 38, textAlign: "right" }}>{p.wr}%</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Relations & calendrier ── */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.muted, marginBottom: 8 }}>RELATIONS & CALENDRIER</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {player.rival && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 8, padding: "8px 12px" }}>
              <span style={{ fontSize: 16 }}>⚔️</span>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, width: 88, flexShrink: 0 }}>RIVAL</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: C.accent }}>{player.rival.name} ({player.rival.total} confrontation{player.rival.total > 1 ? "s" : ""} · {player.rival.w}V-{player.rival.total - player.rival.w}D)</span>
            </div>
          )}
          {player.beteNoire && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 8, padding: "8px 12px" }}>
              <span style={{ fontSize: 16 }}>💀</span>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, width: 88, flexShrink: 0 }}>BÊTE NOIRE</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: C.red }}>{player.beteNoire.name} ({player.beteNoire.w}V-{player.beteNoire.total - player.beteNoire.w}D)</span>
            </div>
          )}
          {player.victime && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 8, padding: "8px 12px" }}>
              <span style={{ fontSize: 16 }}>😏</span>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, width: 88, flexShrink: 0 }}>VICTIME FAVORITE</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: C.blue }}>{player.victime.name} ({player.victime.w}V-{player.victime.total - player.victime.w}D)</span>
            </div>
          )}
          {player.avgOppElo !== null && player.avgOppElo !== undefined && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 8, padding: "8px 12px" }}>
              <span style={{ fontSize: 16 }}>📅</span>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, width: 88, flexShrink: 0 }}>CALENDRIER</span>
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>
                Adversaires : ELO moy. <span style={{ color: C.accent, fontWeight: 700 }}>{player.avgOppElo}</span>
                {player.calRank && calCount > 1 && (
                  <span style={{ color: C.muted, fontWeight: 400 }}> · {player.calRank === 1 ? "calendrier le + dur" : `${player.calRank}ème calendrier le + dur`} (sur {calCount})</span>
                )}
              </span>
            </div>
          )}
          {!player.rival && (
            <p style={{ fontSize: 12, color: C.muted }}>Pas encore de matchs pour ces stats.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniSparklineWide({ history }) {
  if (history.length < 2) return null;
  const vals = history.map(h => h.after);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 280, H = 48;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const last = vals[vals.length - 1];
  const first = vals[0];
  const color = last >= first ? C.green : C.red;
  return (
    <svg width={W} height={H}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {vals.map((v, i) => {
        const x = (i / (vals.length - 1)) * W;
        const y = H - ((v - min) / range) * (H - 4) - 2;
        return <circle key={i} cx={x} cy={y} r="3" fill={color} />;
      })}
    </svg>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function PadelTracker() {
  const [data, setData] = useState({ players: [], matches: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("accueil");
  const [matchForm, setMatchForm] = useState({ a1: "", a2: "", b1: "", b2: "", sets: [{ a: "", b: "" }, { a: "", b: "" }], superTieBreak: false, note: "" });
  const [newPlayer, setNewPlayer] = useState("");
  const [flash, setFlash] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [h2hA, setH2hA] = useState("");
  const [showOnlyQualified, setShowOnlyQualified] = useState(true);
  const [activeRecord, setActiveRecord] = useState(null);
  const [selectedDuo, setSelectedDuo] = useState(null);
  const [adminCode, setAdminCode] = useState(() => { try { return localStorage.getItem(ADMIN_CODE_STORAGE) || ""; } catch { return ""; } });
  const [adminInput, setAdminInput] = useState("");
  const [cloudEmpty, setCloudEmpty] = useState(false);
  const [cloudError, setCloudError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [palmaresView, setPalmaresView] = useState("mois");
  const [titrePeriod, setTitrePeriod] = useState("mois");
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editDateId, setEditDateId] = useState(null);
  const [editNameId, setEditNameId] = useState(null);
  const [editNameVal, setEditNameVal] = useState("");
  const [h2hB, setH2hB] = useState("");

  const DEFAULT_DATA = {
    players: [
      { id: "p1", name: "Theo SALÈS" },
      { id: "p2", name: "Alex LEPORATI" },
      { id: "p3", name: "Jp GIANNORSI" },
      { id: "p4", name: "Anthony LUZI" },
      { id: "p5", name: "Antoine PIANELLI" },
      { id: "p6", name: "Rémi FOUQUET" },
      { id: "p7", name: "Rémi Copain Boulanger" },
      { id: "p8", name: "Thomas Andreani" },
      { id: "p9", name: "Ficello" },
      { id: "p10", name: "Petru Pa" },
      { id: "p11", name: "JB Cozzani" },
      { id: "guest", name: "Invité" },
    ],
    // Matches ordered chronologically; same-day matches get +1h per match to preserve ELO order
    matches: [
      {
        id: "m1",
        date: "2026-06-15T17:00:00.000Z",
        a1: "p1", a2: "p2", b1: "p3", b2: "p4",
        sets: [{ a: 6, b: 4 }, { a: 5, b: 6 }, { a: 7, b: 10 }],
        superTieBreak: true,
        note: ""
      },
      {
        id: "m2",
        date: "2026-06-15T18:00:00.000Z",
        a1: "p1", a2: "p2", b1: "p3", b2: "p4",
        sets: [{ a: 6, b: 0 }, { a: 7, b: 5 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m3",
        date: "2026-06-21T17:00:00.000Z",
        a1: "p2", a2: "p3", b1: "p5", b2: "p6",
        sets: [{ a: 6, b: 1 }, { a: 6, b: 3 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m4",
        date: "2026-06-23T17:00:00.000Z",
        a1: "p1", a2: "p2", b1: "p6", b2: "p7",
        sets: [{ a: 6, b: 4 }, { a: 6, b: 2 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m5",
        date: "2026-06-28T17:00:00.000Z",
        a1: "p1", a2: "p8", b1: "p3", b2: "p9",
        sets: [{ a: 6, b: 1 }, { a: 1, b: 6 }, { a: 6, b: 4 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m6",
        date: "2026-06-29T17:00:00.000Z",
        a1: "p1", a2: "p2", b1: "p3", b2: "p6",
        sets: [{ a: 6, b: 4 }, { a: 2, b: 6 }, { a: 4, b: 6 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m7",
        date: "2026-07-02T17:00:00.000Z",
        a1: "p3", a2: "p9", b1: "p4", b2: "p10",
        sets: [{ a: 5, b: 7 }, { a: 7, b: 6 }, { a: 6, b: 3 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m8",
        date: "2026-07-03T17:00:00.000Z",
        a1: "p1", a2: "p6", b1: "p3", b2: "p9",
        sets: [{ a: 2, b: 6 }, { a: 4, b: 6 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m9",
        date: "2026-07-03T18:00:00.000Z",
        a1: "p1", a2: "p3", b1: "p6", b2: "p9",
        sets: [{ a: 3, b: 6 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m10",
        date: "2026-07-03T19:00:00.000Z",
        a1: "p1", a2: "p9", b1: "p3", b2: "p6",
        sets: [{ a: 7, b: 5 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m11",
        date: "2026-07-08T17:00:00.000Z",
        a1: "p2", a2: "p3", b1: "p11", b2: "p4",
        sets: [{ a: 3, b: 6 }, { a: 3, b: 6 }],
        superTieBreak: false,
        note: ""
      },
      {
        id: "m12",
        date: "2026-07-08T18:00:00.000Z",
        a1: "p3", a2: "p4", b1: "p2", b2: "p11",
        sets: [{ a: 0, b: 6 }, { a: 0, b: 6 }],
        superTieBreak: false,
        note: ""
      },
    ]
  };

  useEffect(() => {
    loadFromCloud().then(({ data: cloud, error }) => {
      if (cloud) {
        setData(cloud);
      } else {
        // Base vide ou erreur réseau → données locales par défaut (lecture seule tant que non publiées)
        setData(DEFAULT_DATA);
        if (!error) setCloudEmpty(true);
        if (error) setCloudError(true);
      }
      setLoading(false);
    });
  }, []);

  const { players, matches } = data;
  const eloStats = computeElo(players, matches);

  const isAdmin = adminCode.length > 0;

  function persist(next) {
    if (!isAdmin) {
      setFlash("🔒 Mode lecture — entre le code admin dans l'onglet Joueurs.");
      setTimeout(() => setFlash(null), 3500);
      return false;
    }
    setData(next);
    setSyncing(true);
    saveToCloud(adminCode, next).then(ok => {
      setSyncing(false);
      if (ok) {
        setCloudEmpty(false);
      } else {
        setFlash("⚠️ Échec de synchronisation — code admin invalide ou réseau. Modif non enregistrée en ligne !");
        setTimeout(() => setFlash(null), 4000);
      }
    });
    return true;
  }

  function unlockAdmin() {
    const code = adminInput.trim();
    if (!code) return;
    setAdminCode(code);
    try { localStorage.setItem(ADMIN_CODE_STORAGE, code); } catch {}
    setAdminInput("");
    setFlash("✓ Mode admin activé sur cet appareil.");
    setTimeout(() => setFlash(null), 2500);
  }

  function lockAdmin() {
    setAdminCode("");
    try { localStorage.removeItem(ADMIN_CODE_STORAGE); } catch {}
  }

  function addPlayer() {
    const name = newPlayer.trim();
    if (!name || players.find(p => p.name.toLowerCase() === name.toLowerCase())) return;
    persist({ ...data, players: [...players, { id: uid(), name }] });
    setNewPlayer("");
  }

  function removePlayer(id) {
    if (matches.some(m => [m.a1, m.a2, m.b1, m.b2].includes(id))) {
      setFlash("Ce joueur a des matchs. Supprimez d'abord ses matchs.");
      setTimeout(() => setFlash(null), 3000);
      return;
    }
    persist({ ...data, players: players.filter(p => p.id !== id) });
  }

  function addSet() { setMatchForm(f => ({ ...f, sets: [...f.sets, { a: "", b: "" }] })); }
  function removeSet(i) {
    if (matchForm.sets.length <= 1) return;
    setMatchForm(f => ({ ...f, sets: f.sets.filter((_, idx) => idx !== i) }));
  }
  function setSet(i, side, val) {
    setMatchForm(f => ({ ...f, sets: f.sets.map((s, idx) => idx === i ? { ...s, [side]: val } : s) }));
  }

  function submitMatch() {
    const { a1, a2, b1, b2, sets, note } = matchForm;
    const p4 = [a1, a2, b1, b2];
    if (p4.some(p => !p) || new Set(p4).size < 4) {
      setFlash("4 joueurs différents requis."); setTimeout(() => setFlash(null), 3000); return;
    }
    const parsedSets = sets.map(s => ({ a: parseInt(s.a), b: parseInt(s.b) }));
    if (parsedSets.some(s => isNaN(s.a) || isNaN(s.b))) {
      setFlash("Remplis tous les scores."); setTimeout(() => setFlash(null), 3000); return;
    }
    const match = { id: uid(), date: new Date().toISOString(), a1, a2, b1, b2, sets: parsedSets, superTieBreak: matchForm.superTieBreak, note };
    if (!persist({ ...data, matches: [match, ...matches] })) return;
    setMatchForm({ a1: "", a2: "", b1: "", b2: "", sets: [{ a: "", b: "" }, { a: "", b: "" }], superTieBreak: false, note: "" });
    setFlash("✓ Match enregistré !"); setTimeout(() => setFlash(null), 2000);
    setTab("ranking");
  }

  function deleteMatch(id) { persist({ ...data, matches: matches.filter(m => m.id !== id) }); }
  function updateMatchDate(id, isoDate) {
    persist({ ...data, matches: matches.map(m => m.id === id ? { ...m, date: new Date(isoDate + "T12:00:00").toISOString() } : m) });
  }
  function renamePlayer(id, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    persist({ ...data, players: players.map(p => p.id === id ? { ...p, name: trimmed } : p) });
  }

  const pName = id => players.find(p => p.id === id)?.name || "?";

  const mainTabs = [
    { id: "accueil", label: "Accueil", icon: "🏠" },
    { id: "ranking", label: "Classement", icon: "🏆" },
    { id: "match", label: "Match", icon: "➕" },
    { id: "reigns", label: "Palmarès", icon: "👑" },
  ];
  const moreTabs = [
    { id: "duos", label: "Duos", icon: "🤝" },
    { id: "h2h", label: "Face à Face", icon: "⚔️" },
    { id: "records", label: "Records", icon: "⭐" },
    { id: "history", label: "Historique", icon: "📋" },
    { id: "players", label: "Joueurs", icon: "👤" },
  ];
  const isMoreTab = moreTabs.some(t => t.id === tab);

  if (loading) return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 4, color: C.accent }}>FOLELLI LEAGUE</div>
        <div style={{ color: C.muted, fontSize: 13 }}>Connexion à la ligue…</div>
      </div>
    </>
  );

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", background: C.bg }}>

        {/* Header — Folelli League */}
        <div style={{
          background: `linear-gradient(160deg, ${C.accent}14, ${C.card} 55%)`,
          borderBottom: `2px solid ${C.accent}55`,
          padding: "14px 20px", display: "flex", alignItems: "center", gap: 14
        }}>
          {/* Écusson */}
          <div className="crown-glow" style={{
            width: 44, height: 44, flexShrink: 0,
            background: `linear-gradient(145deg, ${C.accent}, #9b7e35)`,
            clipPath: "polygon(50% 0%, 100% 15%, 100% 70%, 50% 100%, 0% 70%, 0% 15%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 14px ${C.accent}44`
          }}>
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#080E0A", letterSpacing: 1, marginTop: -2 }}>F</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: 2, color: C.text, lineHeight: 1 }}>FOLELLI</span>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: 2, color: C.accent, lineHeight: 1 }}>LEAGUE</span>
            </div>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2.5, fontWeight: 700, marginTop: 2 }}>
              {matches.length} MATCHS · {players.length} JOUEURS{(() => {
                const champ = eloStats.reigns && eloStats.reigns.length > 0 ? eloStats.reigns[eloStats.reigns.length - 1] : null;
                if (!champ) return "";
                const cName = players.find(p => p.id === champ.id)?.name || "";
                return ` · 👑 ${cName.toUpperCase()}`;
              })()}
            </div>
          </div>
        </div>

        {flash && (
          <div style={{ background: flash.startsWith("✓") ? C.green + "22" : C.red + "22", border: `1px solid ${flash.startsWith("✓") ? C.green : C.red}`, color: flash.startsWith("✓") ? C.green : C.red, padding: "10px 20px", fontSize: 14, textAlign: "center" }}>
            {flash}
          </div>
        )}

        <div key={tab} className="fade-tab" style={{ padding: "16px 16px calc(90px + env(safe-area-inset-bottom))", maxWidth: 640, margin: "0 auto" }}>

          {/* ── CLASSEMENT ELO ── */}
          {/* ── ACCUEIL ── */}
          {tab === "accueil" && (() => {
            const qualified = eloStats.filter(p => p.played >= MIN_MATCHES);
            const reigns = eloStats.reigns || [];
            const champ = reigns.length > 0 ? reigns[reigns.length - 1] : null;
            const champStats = champ ? eloStats.find(p => p.id === champ.id) : null;
            const pNameA = id => players.find(p => p.id === id)?.name || "?";

            // Jours depuis le dernier match
            const lastDate = matches.length > 0 ? matches.reduce((max, m) => new Date(m.date) > max ? new Date(m.date) : max, new Date(0)) : null;
            const days = lastDate ? Math.floor((new Date() - lastDate) / 86400000) : null;
            const daysColor = days === null ? C.muted : days <= 7 ? C.green : days <= 21 ? C.accent : C.red;

            // ── Stats du jour (pool + rotation quotidienne) ──
            const q3 = qualified;
            const gamePctA = p => (p.gamesW + p.gamesL) > 0 ? p.gamesW / (p.gamesW + p.gamesL) : 0;
            const pool = [];

            if (q3.length > 0) {
              const bw = [...q3].sort((a, b) => (b.wins / b.played) - (a.wins / a.played));
              pool.push({ icon: "🔥", title: "Meilleur win rate", holder: bw[0].name, value: `${Math.round(bw[0].wins / bw[0].played * 100)}%`, color: C.green,
                top3: bw.slice(0, 3).map(p => [`${p.name} (${p.wins}V/${p.losses}D)`, `${Math.round(p.wins / p.played * 100)}%`]) });
              const mp = [...eloStats].filter(p => p.played > 0).sort((a, b) => b.played - a.played);
              pool.push({ icon: "🎾", title: "+ de matchs joués", holder: mp[0].name, value: `${mp[0].played}`, color: C.accent,
                top3: mp.slice(0, 3).map(p => [p.name, `${p.played} matchs`]) });
              const gp = [...q3].sort((a, b) => gamePctA(b) - gamePctA(a));
              pool.push({ icon: "⚔️", title: "Meilleur % de jeux gagnés", holder: gp[0].name, value: `${Math.round(gamePctA(gp[0]) * 100)}%`, color: C.green,
                top3: gp.slice(0, 3).map(p => [`${p.name} (${p.gamesW}G/${p.gamesL}P)`, `${Math.round(gamePctA(p) * 100)}%`]) });
            }
            if (reigns.length > 0) {
              const lr = [...reigns].sort((a, b) => b.length - a.length);
              pool.push({ icon: "🏰", title: "Plus long règne", holder: pNameA(lr[0].id), value: `${lr[0].length} match${lr[0].length > 1 ? "s" : ""}`, color: C.accent,
                top3: lr.slice(0, 3).map(r => [pNameA(r.id), `${r.length} match${r.length > 1 ? "s" : ""}`]) });
            }
            {
              // Victoire la plus nette (jeux, hors STB)
              const sortedM = [...matches].map((m, i) => ({ ...m, _idx: i })).sort((a, b) => new Date(a.date) - new Date(b.date) || a._idx - b._idx);
              const ms = sortedM.map(m => {
                const aS = m.sets.filter(s => s.a > s.b).length, bS = m.sets.filter(s => s.b > s.a).length;
                const aWin = aS > bS;
                const real = m.superTieBreak ? m.sets.slice(0, -1) : m.sets;
                const gA = real.reduce((s, x) => s + x.a, 0), gB = real.reduce((s, x) => s + x.b, 0);
                const winners = aWin ? [m.a1, m.a2] : [m.b1, m.b2];
                const losers = aWin ? [m.b1, m.b2] : [m.a1, m.a2];
                const setsTxt = m.sets.map(s => aWin ? `${s.a}-${s.b}` : `${s.b}-${s.a}`).join(" · ");
                return { diff: Math.abs(gA - gB), winners, losers, setsTxt };
              }).sort((a, b) => b.diff - a.diff);
              if (ms.length > 0) {
                const lbl = m => `${pNameA(m.winners[0]).split(" ")[0]}/${pNameA(m.winners[1]).split(" ")[0]}`;
                pool.push({ icon: "💥", title: "Victoire la + nette", holder: lbl(ms[0]), value: `+${ms[0].diff} jeux`, color: C.green,
                  top3: ms.slice(0, 3).map(m => [`${lbl(m)} vs ${pNameA(m.losers[0]).split(" ")[0]}/${pNameA(m.losers[1]).split(" ")[0]} — ${m.setsTxt}`, `+${m.diff}`]) });
              }
            }

            const dayIndex = Math.floor(Date.now() / 86400000);
            const picks = pool.length >= 2
              ? [pool[dayIndex % pool.length], pool[(dayIndex + Math.floor(pool.length / 2)) % pool.length]]
              : pool;

            if (matches.length === 0) return (
              <p style={{ color: C.muted, fontSize: 13, textAlign: "center", marginTop: 40 }}>Pas encore de matchs — la ligue démarre bientôt !</p>
            );

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {/* Hero TOP 1 */}
                {champStats && (
                  <div style={{ textAlign: "center", padding: "20px 0 18px" }}>
                    <div style={{ fontSize: 40, marginBottom: 4 }}>👑</div>
                    <div style={{ fontSize: 10, letterSpacing: 4, color: C.muted, fontWeight: 700, marginBottom: 6 }}>TOP 1 ACTUEL</div>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 42, letterSpacing: 3, color: C.accent, lineHeight: 1 }}>{champStats.name.toUpperCase()}</div>
                    <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 24, color: C.text, marginTop: 6 }}>
                      <CountUp target={champStats.elo} /> <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>ELO</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>
                      Règne depuis {champ.length} match{champ.length > 1 ? "s" : ""} · {champStats.played > 0 ? Math.round(champStats.wins / champStats.played * 100) : 0}% de victoires
                    </div>
                  </div>
                )}

                {/* Compteurs */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 24, color: C.accent, lineHeight: 1 }}>{matches.length}</div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 4, lineHeight: 1.3 }}>matchs joués</div>
                  </div>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 24, color: daysColor, lineHeight: 1 }}>{days !== null ? `${days}j` : "—"}</div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 4, lineHeight: 1.3 }}>depuis le dernier match</div>
                  </div>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 24, color: C.accent, lineHeight: 1 }}>{qualified.length}</div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 4, lineHeight: 1.3 }}>joueurs classés</div>
                  </div>
                </div>

                {/* Dernier match */}
                {(() => {
                  const sortedM = [...matches].map((m, i) => ({ ...m, _idx: i })).sort((a, b) => new Date(a.date) - new Date(b.date) || a._idx - b._idx);
                  const lm = sortedM[sortedM.length - 1];
                  if (!lm) return null;
                  const aS = lm.sets.filter(s => s.a > s.b).length;
                  const bS = lm.sets.filter(s => s.b > s.a).length;
                  const aWin = aS > bS;
                  const winners = aWin ? [lm.a1, lm.a2] : [lm.b1, lm.b2];
                  const losers = aWin ? [lm.b1, lm.b2] : [lm.a1, lm.a2];
                  const setsTxt = lm.sets.map(s => aWin ? `${s.a}-${s.b}` : `${s.b}-${s.a}`).join(" · ");
                  const dateTxt = new Date(lm.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                  return (
                    <div style={{ background: C.card, border: `1px solid ${C.accent}44`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 10, letterSpacing: 2, color: C.accent, fontWeight: 700 }}>🎾 DERNIER MATCH</span>
                        <span style={{ fontSize: 10, color: C.muted }}>{dateTxt}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>
                            {pNameA(winners[0])} / {pNameA(winners[1])} <span style={{ fontSize: 11 }}>✓</span>
                          </div>
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                            {pNameA(losers[0])} / {pNameA(losers[1])}
                          </div>
                        </div>
                        <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 18, color: C.text, flexShrink: 0, textAlign: "right" }}>
                          {setsTxt}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Stats du jour */}
                {picks.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, letterSpacing: 2, color: C.muted, fontWeight: 700, marginBottom: 8 }}>📊 STATS DU JOUR</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {picks.map((r, i) => (
                        <div key={i} className="tile-press" onClick={() => setActiveRecord(r)} style={{
                          background: `linear-gradient(160deg, ${r.color}10, ${C.card} 60%)`,
                          border: `1px solid ${r.color}33`, borderRadius: 12,
                          padding: "14px 12px", textAlign: "center", cursor: "pointer"
                        }}>
                          <div style={{ fontSize: 24 }}>{r.icon}</div>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", marginTop: 4 }}>{r.title}</div>
                          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 20, color: r.color, marginTop: 2 }}>{r.value}</div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginTop: 2 }}>{r.holder}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: C.muted, textAlign: "center", marginTop: 6 }}>Changent chaque jour · appuie pour le top 3</div>
                  </div>
                )}

                {/* Podium */}
                {qualified.length >= 3 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, letterSpacing: 2, color: C.muted, fontWeight: 700, marginBottom: 8 }}>LE PODIUM</div>
                    {qualified.slice(0, 3).map((p, i) => {
                      const pc = ["#c8a84b", "#9eaebd", "#c07a3a"][i];
                      return (
                        <div key={p.id} className="tile-press" onClick={() => setSelectedPlayer(p)} style={{ display: "flex", alignItems: "center", gap: 10, background: `linear-gradient(135deg, ${pc}10, ${C.card})`, border: `1px solid ${pc}44`, borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer" }}>
                          <span style={{ width: 24, height: 24, borderRadius: "50%", background: pc, color: "#080E0A", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                          <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 18, color: pc }}>{p.elo}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* CTA */}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setTab("ranking")} style={{ flex: 1, background: C.accent, color: "#080E0A", fontWeight: 700, borderRadius: 10, padding: "14px", fontSize: 13 }}>
                    VOIR LE CLASSEMENT
                  </button>
                  <button onClick={() => setTab("match")} style={{ flex: 1, background: "transparent", border: `1px solid ${C.border}`, color: C.text, fontWeight: 600, borderRadius: 10, padding: "14px", fontSize: 13 }}>
                    + NOUVEAU MATCH
                  </button>
                </div>

                {/* Modal top 3 stat du jour */}
                {activeRecord && activeRecord.top3 && (
                  <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 10px calc(100px + env(safe-area-inset-bottom))" }} onClick={() => setActiveRecord(null)}>
                    <div className="slide-up" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, maxHeight: "calc(100dvh - 150px)", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 24 }}>{activeRecord.icon}</span>
                          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: activeRecord.color }}>{activeRecord.title}</span>
                        </div>
                        <button onClick={() => setActiveRecord(null)} style={{ background: C.border, color: C.muted, padding: "4px 10px", fontSize: 13 }}>✕</button>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>TOP 3</div>
                      {activeRecord.top3.map(([label, value], i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `1px solid ${i === 0 ? C.accent + "55" : C.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                          <span style={{ fontSize: 20 }}>{["🥇", "🥈", "🥉"][i]}</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: C.text }}>{label}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: activeRecord.color }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {tab === "ranking" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Ligne info + toggle */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <button onClick={() => setShowRules(true)} className="tile-press"
                  style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, padding: "6px 10px", borderRadius: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 15, height: 15, borderRadius: "50%", border: `1px solid ${C.accent}`, color: C.accent, fontSize: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", fontStyle: "italic", fontWeight: 700 }}>i</span>
                  Règles ELO
                </button>
                <div onClick={() => setShowOnlyQualified(v => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                    background: showOnlyQualified ? C.accent + "18" : C.surface,
                    border: `1px solid ${showOnlyQualified ? C.accent : C.border}`,
                    borderRadius: 20, padding: "6px 12px" }}>
                  <div style={{ width: 32, height: 18, borderRadius: 9,
                    background: showOnlyQualified ? C.accent : C.border, position: "relative", transition: "background .2s", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 2, left: showOnlyQualified ? 16 : 2,
                      width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: showOnlyQualified ? C.accent : C.muted, whiteSpace: "nowrap" }}>
                    Qualifiés (3+ matchs)
                  </span>
                </div>
              </div>

              {eloStats.length === 0 && (
                <p style={{ color: C.muted, fontSize: 13 }}>Ajoute des joueurs et des matchs pour voir le classement.</p>
              )}

              {eloStats.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 46px 46px 58px", gap: 8, padding: "4px 12px", fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>
                  <span>#</span><span>JOUEUR</span><span style={{ textAlign: "center" }}>V-D</span><span style={{ textAlign: "center" }}>WIN%</span><span style={{ textAlign: "right" }}>ELO</span>
                </div>
              )}

              {(() => {
                const displayed = showOnlyQualified ? eloStats.filter(p => p.played >= MIN_MATCHES) : eloStats;
                const rankColors = ["#c8a84b", "#9eaebd", "#c07a3a"];
                return displayed.map((p, i) => {
                  const qualified = p.played >= MIN_MATCHES;
                  const glowColor = i < 3 && qualified ? rankColors[i] : null;
                  return (
                    <div key={p.id}
                      onClick={() => setSelectedPlayer(p)}
                      className="tile-press"
                      style={{
                        display: "grid", gridTemplateColumns: "30px 1fr 46px 46px 58px", gap: 8, alignItems: "center",
                        background: glowColor ? `linear-gradient(135deg, ${glowColor}12, ${C.card})` : C.card,
                        border: `1px solid ${glowColor ? glowColor + "55" : qualified ? C.border : C.border + "55"}`,
                        borderRadius: 8, padding: "10px 12px", opacity: qualified ? 1 : 0.6, cursor: "pointer",
                        boxShadow: glowColor ? `0 0 12px ${glowColor}22, inset 0 0 20px ${glowColor}08` : "none",
                      }}>
                      <Rank n={i + 1} qualified={qualified} />
                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: qualified ? C.text : C.muted }}>{p.name}</div>
                        {(p.rankMove !== 0 && qualified) || p.played < MIN_MATCHES || p.streak >= 2 ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
                            {p.rankMove !== 0 && qualified && (
                              <span style={{
                                fontSize: 10, fontWeight: 700,
                                color: p.rankMove > 0 ? C.green : C.red,
                                background: p.rankMove > 0 ? C.green + "18" : C.red + "18",
                                border: `1px solid ${p.rankMove > 0 ? C.green + "44" : C.red + "44"}`,
                                borderRadius: 4, padding: "1px 5px",
                              }}>
                                {p.rankMove > 0 ? `▲${p.rankMove}` : `▼${Math.abs(p.rankMove)}`}
                              </span>
                            )}
                            {p.played < MIN_MATCHES && (
                              <span style={{ fontSize: 10, color: C.muted }}>{p.played}/{MIN_MATCHES} matchs</span>
                            )}
                            {p.streak >= 2 && <StreakBadge streak={p.streak} streakType={p.streakType} />}
                          </div>
                        ) : null}
                      </div>
                      <span style={{ textAlign: "center", fontSize: 12, fontWeight: 600 }}>
                        <span style={{ color: C.green }}>{p.wins}</span>
                        <span style={{ color: C.muted }}>-</span>
                        <span style={{ color: C.red }}>{p.losses}</span>
                      </span>
                      <span style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: p.played > 0 ? (Math.round(p.wins/p.played*100) >= 60 ? C.green : Math.round(p.wins/p.played*100) >= 40 ? C.accent : C.red) : C.muted }}>
                        {p.played > 0 ? Math.round(p.wins/p.played*100) + "%" : "—"}
                      </span>
                      <span style={{ textAlign: "right", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 21, color: qualified ? C.accent : C.muted }}>
                        {p.elo}
                      </span>
                    </div>
                  );
                });
              })()}

              {!showOnlyQualified && eloStats.some(p => p.played < MIN_MATCHES) && (
                <p style={{ fontSize: 11, color: C.muted, textAlign: "center" }}>
                  Les joueurs grisés ne sont pas encore qualifiés (3+ matchs).
                </p>
              )}

              {/* Modal règles ELO */}
              {showRules && (
                <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 10px calc(100px + env(safe-area-inset-bottom))" }} onClick={() => setShowRules(false)}>
                  <div className="slide-up" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: C.accent }}>RÈGLES DU CLASSEMENT</span>
                      <button onClick={() => setShowRules(false)} style={{ background: C.border, color: C.muted, padding: "4px 10px", fontSize: 13 }}>✕</button>
                    </div>
                    <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.8 }}>
                      <b style={{ color: C.text }}>ELO</b> — tout le monde démarre à 1000 pts. On gagne/perd des points selon le résultat et la force de l'adversaire (K=32). Battre plus fort rapporte plus.<br/>
                      <b style={{ color: C.text }}>Multiplicateurs</b> — 2 sets secs : ×1.0 · 3 sets : ×0.85 · super tie-break : ×0.70 · 1 set : ×0.70.<br/>
                      <b style={{ color: C.text }}>Qualification</b> — minimum {MIN_MATCHES} matchs joués pour être classé.<br/>
                      <b style={{ color: C.text }}>Badges</b> — ▲▼ places gagnées/perdues au dernier match · 🔥 série de victoires · ❄️ série de défaites.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── DUOS ── */}
          {tab === "duos" && (() => {
            const duos = computeDuos(players, matches);
            const pNameD = id => players.find(p => p.id === id)?.name || "?";
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.muted }}>
                  🤝 Paires avec <b style={{ color: C.text }}>2+ matchs ensemble</b> · classées par <b style={{ color: C.accent }}>ELO de duo</b> (départ 1000) · Appuie sur un duo pour ses stats
                </div>

                {duos.length === 0 && (
                  <p style={{ color: C.muted, fontSize: 13 }}>Pas encore assez de matchs par duo (min. 2).</p>
                )}

                {duos.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 50px 50px 60px", gap: 8, padding: "4px 12px", fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 1 }}>
                    <span>#</span><span>Duo</span><span style={{ textAlign: "center" }}>V/D</span><span style={{ textAlign: "center" }}>Win%</span><span style={{ textAlign: "right" }}>ELO</span>
                  </div>
                )}

                {duos.map((d, i) => {
                  const colors = ["#c8a84b","#9eaebd","#c07a3a"];
                  const rankColor = colors[i] || C.border;
                  const isTop = i < 3;
                  return (
                    <div key={d.key}
                      onClick={() => setSelectedDuo(d)}
                      className="tile-press"
                      style={{
                        display: "grid", gridTemplateColumns: "30px 1fr 50px 50px 60px", gap: 8, alignItems: "center",
                        background: isTop ? `linear-gradient(135deg, ${rankColor}12, ${C.card})` : C.card,
                        border: `1px solid ${isTop ? rankColor + "55" : C.border}`,
                        borderRadius: 8, padding: "12px 12px", cursor: "pointer",
                        boxShadow: isTop ? `0 0 12px ${rankColor}22` : "none"
                      }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 26, height: 26, borderRadius: "50%",
                        background: isTop ? rankColor : "transparent",
                        border: !isTop ? `1px solid ${C.border}` : "none",
                        fontSize: 13, fontWeight: 700,
                        color: isTop ? "#080E0A" : C.muted
                      }}>{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{d.label}</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                          {d.synergy !== 0 && (
                            <span style={{
                              fontSize: 10, fontWeight: 700,
                              color: d.synergy > 0 ? C.green : C.red,
                              background: d.synergy > 0 ? C.green + "18" : C.red + "18",
                              border: `1px solid ${d.synergy > 0 ? C.green + "44" : C.red + "44"}`,
                              borderRadius: 4, padding: "1px 5px",
                            }}>
                              {d.synergy > 0 ? "⚗️ +" : "⚗️ "}{d.synergy}% synergie
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={{ textAlign: "center", fontSize: 13 }}>
                        <span style={{ color: C.green }}>{d.w}</span>
                        <span style={{ color: C.muted }}>/</span>
                        <span style={{ color: C.red }}>{d.l}</span>
                      </span>
                      <span style={{ textAlign: "center", fontSize: 13, color: d.winRate >= 60 ? C.green : d.winRate >= 40 ? C.accent : C.red, fontWeight: 600 }}>
                        {d.winRate}%
                      </span>
                      <span style={{ textAlign: "right", fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 21, color: C.accent }}>
                        {d.elo}
                      </span>
                    </div>
                  );
                })}

                {/* Duo modal */}
                {selectedDuo && (
                  <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 150, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 10px calc(100px + env(safe-area-inset-bottom))" }}
                    onClick={() => setSelectedDuo(null)}>
                    <div className="slide-up" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, maxHeight: "calc(100dvh - 150px)", overflowY: "auto" }}
                      onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, color: C.text }}>{selectedDuo.label}</span>
                        <button onClick={() => setSelectedDuo(null)} style={{ background: C.border, color: C.muted, padding: "4px 10px", fontSize: 13 }}>✕</button>
                      </div>

                      {/* ELO */}
                      <div style={{ textAlign: "center", marginBottom: 16 }}>
                        <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 52, color: C.accent, lineHeight: 1 }}><CountUp target={selectedDuo.elo} /></div>
                        <div style={{ fontSize: 12, color: C.muted, letterSpacing: 2 }}>ELO DUO</div>
                      </div>

                      {/* Core stats */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                        <div style={{ background: C.surface, borderRadius: 8, padding: 10, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{selectedDuo.w}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>Victoires</div>
                        </div>
                        <div style={{ background: C.surface, borderRadius: 8, padding: 10, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: C.red }}>{selectedDuo.l}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>Défaites</div>
                        </div>
                        <div style={{ background: C.surface, borderRadius: 8, padding: 10, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: C.accent }}>{selectedDuo.winRate}%</div>
                          <div style={{ fontSize: 11, color: C.muted }}>Win rate</div>
                        </div>
                      </div>

                      {/* Games */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                        <div style={{ background: C.surface, borderRadius: 8, padding: 10, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: C.green }}>{selectedDuo.gamesW}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>Jeux gagnés</div>
                        </div>
                        <div style={{ background: C.surface, borderRadius: 8, padding: 10, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: C.red }}>{selectedDuo.gamesL}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>Jeux perdus</div>
                        </div>
                        <div style={{ background: C.surface, borderRadius: 8, padding: 10, textAlign: "center" }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: (selectedDuo.gamesW - selectedDuo.gamesL) > 0 ? C.green : (selectedDuo.gamesW - selectedDuo.gamesL) < 0 ? C.red : C.muted }}>
                            {(selectedDuo.gamesW - selectedDuo.gamesL) > 0 ? "+" : ""}{selectedDuo.gamesW - selectedDuo.gamesL}
                          </div>
                          <div style={{ fontSize: 11, color: C.muted }}>Différentiel</div>
                        </div>
                      </div>

                      {/* Synergie */}
                      <div style={{ background: C.surface, border: `1px solid ${selectedDuo.synergy > 0 ? C.green + "44" : selectedDuo.synergy < 0 ? C.red + "44" : C.border}`, borderRadius: 8, padding: 12, marginBottom: 14 }}>
                        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 1, marginBottom: 6 }}>⚗️ COMPLÉMENTARITÉ</div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.textSub, marginBottom: 6 }}>
                          <span>Win rate du duo : <b style={{ color: C.text }}>{selectedDuo.winRate}%</b></span>
                          <span>Moy. individuelle : <b style={{ color: C.text }}>{selectedDuo.avgIndiv}%</b></span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: selectedDuo.synergy > 0 ? C.green : selectedDuo.synergy < 0 ? C.red : C.muted }}>
                          {selectedDuo.synergy > 0
                            ? `+${selectedDuo.synergy}% — ils jouent mieux ensemble que séparément 🔥`
                            : selectedDuo.synergy < 0
                            ? `${selectedDuo.synergy}% — ils performent moins bien ensemble 🤔`
                            : "Ils jouent pareil ensemble que séparément"}
                        </div>
                      </div>

                      {/* Match history */}
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.muted, marginBottom: 8 }}>HISTORIQUE DU DUO</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[...selectedDuo.matchList].reverse().map((m, idx) => {
                          const opps = m.isTeamA ? [m.b1, m.b2] : [m.a1, m.a2];
                          const displaySets = m.sets.map(s => m.isTeamA ? s : { a: s.b, b: s.a });
                          const dSets = displaySets.filter(s => s.a > s.b).length;
                          const oSets = displaySets.filter(s => s.b > s.a).length;
                          const dateStr = new Date(m.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
                          return (
                            <div key={idx} style={{ background: C.surface, border: `1px solid ${m.won ? C.green + "33" : C.red + "33"}`, borderRadius: 8, padding: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: m.won ? C.green : C.red }}>{m.won ? "VICTOIRE" : "DÉFAITE"}</span>
                                  <span style={{ fontSize: 11, color: C.muted }}> vs {pNameD(opps[0])} / {pNameD(opps[1])}</span>
                                </div>
                                <span style={{ fontSize: 10, color: C.muted }}>{dateStr}</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                                <div style={{ display: "flex", gap: 6 }}>
                                  {displaySets.map((s, si) => (
                                    <span key={si} style={{ fontSize: 12 }}>
                                      <span style={{ color: s.a > s.b ? C.green : C.text }}>{s.a}</span>
                                      <span style={{ color: C.muted }}>-</span>
                                      <span style={{ color: s.b > s.a ? C.green : C.text }}>{s.b}</span>
                                    </span>
                                  ))}
                                  <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 14, color: C.accent, marginLeft: 4 }}>{dSets}—{oSets}</span>
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 700, color: m.deltaElo > 0 ? C.green : C.red }}>
                                  {m.deltaElo > 0 ? "▲" : "▼"}{Math.abs(m.deltaElo)} ELO
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── FACE À FACE ── */}
          {tab === "h2h" && (() => {
            const pName = id => players.find(p => p.id === id)?.name || "?";
            const sortedAsc = [...matches].map((m, i) => ({ ...m, _idx: i })).sort((a, b) => new Date(a.date) - new Date(b.date) || a._idx - b._idx);

            let wA = 0, wB = 0, gA = 0, gB = 0;
            let duels = []; // chronologique

            if (h2hA && h2hB && h2hA !== h2hB) {
              duels = sortedAsc.filter(m => {
                const inA = [m.a1, m.a2].includes(h2hA);
                const inB = [m.b1, m.b2].includes(h2hA);
                const oppInA = [m.a1, m.a2].includes(h2hB);
                const oppInB = [m.b1, m.b2].includes(h2hB);
                return (inA && oppInB) || (inB && oppInA);
              });
              duels.forEach(m => {
                const aSets = m.sets.filter(s => s.a > s.b).length;
                const bSets = m.sets.filter(s => s.b > s.a).length;
                const aWin = aSets > bSets;
                const pAinA = [m.a1, m.a2].includes(h2hA);
                const pAwon = (pAinA && aWin) || (!pAinA && !aWin);
                if (pAwon) wA++; else wB++;
                const real = m.superTieBreak ? m.sets.slice(0, -1) : m.sets;
                real.forEach(s => {
                  if (pAinA) { gA += s.a; gB += s.b; } else { gA += s.b; gB += s.a; }
                });
              });
            }

            const total = wA + wB;
            const sA = eloStats.find(p => p.id === h2hA);
            const sB = eloStats.find(p => p.id === h2hB);

            // ── Indice Folelli : 40% ELO · 25% duels · 20% jeux · 15% win rate ──
            let indice = null;
            if (sA && sB && h2hA !== h2hB) {
              const pElo = 1 / (1 + Math.pow(10, (sB.elo - sA.elo) / 400));
              const wrA = sA.played > 0 ? sA.wins / sA.played : 0.5;
              const wrB = sB.played > 0 ? sB.wins / sB.played : 0.5;
              const pWr = (wrA + wrB) > 0 ? wrA / (wrA + wrB) : 0.5;
              let p;
              if (total === 0) {
                p = 0.70 * pElo + 0.30 * pWr;
              } else {
                const pH = (wA + 1) / (total + 2); // lissage
                const pG = (gA + gB) > 0 ? gA / (gA + gB) : 0.5;
                p = 0.40 * pElo + 0.25 * pH + 0.20 * pG + 0.15 * pWr;
              }
              indice = Math.round(p * 100);
            }

            // ── Verdict ──
            let verdict = null;
            if (total > 0) {
              const last3 = duels.slice(-3).map(m => {
                const aS = m.sets.filter(s => s.a > s.b).length;
                const bS = m.sets.filter(s => s.b > s.a).length;
                const pAinA = [m.a1, m.a2].includes(h2hA);
                return (pAinA && aS > bS) || (!pAinA && bS > aS);
              });
              const recentA = last3.filter(Boolean).length;
              if (wA === wB) verdict = "⚖️ Rivalité parfaitement équilibrée";
              else if (wA > wB && recentA >= 2) verdict = `🔥 ${pName(h2hA).split(" ")[0]} domine la rivalité`;
              else if (wB > wA && recentA <= 1) verdict = `🔥 ${pName(h2hB).split(" ")[0]} domine la rivalité`;
              else if (wA > wB) verdict = `📈 ${pName(h2hB).split(" ")[0]} renverse la tendance`;
              else verdict = `📈 ${pName(h2hA).split(" ")[0]} renverse la tendance`;
            }

            // ── Ensemble ──
            let togW = 0, togN = 0;
            if (h2hA && h2hB && h2hA !== h2hB) {
              sortedAsc.forEach(m => {
                const bothA = [m.a1, m.a2].includes(h2hA) && [m.a1, m.a2].includes(h2hB);
                const bothB = [m.b1, m.b2].includes(h2hA) && [m.b1, m.b2].includes(h2hB);
                if (!bothA && !bothB) return;
                const aS = m.sets.filter(s => s.a > s.b).length;
                const bS = m.sets.filter(s => s.b > s.a).length;
                togN++;
                if ((bothA && aS > bS) || (bothB && bS > aS)) togW++;
              });
            }

            // ── Match référence (plus gros écart de jeux) ──
            let ref = null;
            duels.forEach(m => {
              const real = m.superTieBreak ? m.sets.slice(0, -1) : m.sets;
              const ga = real.reduce((s, x) => s + x.a, 0);
              const gb = real.reduce((s, x) => s + x.b, 0);
              const diff = Math.abs(ga - gb);
              if (!ref || diff > ref.diff) ref = { m, diff };
            });

            const last3Squares = duels.slice(-3).map(m => {
              const aS = m.sets.filter(s => s.a > s.b).length;
              const bS = m.sets.filter(s => s.b > s.a).length;
              const pAinA = [m.a1, m.a2].includes(h2hA);
              return (pAinA && aS > bS) || (!pAinA && bS > aS);
            });

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h2 style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, color: C.accent }}>FACE À FACE</h2>

                {/* Sélecteurs */}
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <select value={h2hA} onChange={e => setH2hA(e.target.value)} style={{ flex: 1 }}>
                    <option value="">— Joueur A —</option>
                    {players.map(p => <option key={p.id} value={p.id} disabled={p.id === h2hB}>{p.name}</option>)}
                  </select>
                  <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, color: C.muted, flexShrink: 0 }}>VS</span>
                  <select value={h2hB} onChange={e => setH2hB(e.target.value)} style={{ flex: 1 }}>
                    <option value="">— Joueur B —</option>
                    {players.map(p => <option key={p.id} value={p.id} disabled={p.id === h2hA}>{p.name}</option>)}
                  </select>
                </div>

                {(!h2hA || !h2hB) && (
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, textAlign: "center", color: C.muted, fontSize: 13 }}>
                    Sélectionne deux joueurs pour voir leur rivalité.
                  </div>
                )}

                {h2hA && h2hB && h2hA !== h2hB && sA && sB && (
                  <>
                    {/* ── Affiche du duel ── */}
                    <div style={{ background: `linear-gradient(160deg, ${C.accent}0C, ${C.card})`, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 14px", textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 1.5, lineHeight: 1.1 }}>{pName(h2hA).toUpperCase()}</div>
                          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15, color: C.accent, marginTop: 4 }}>{sA.elo} <span style={{ fontSize: 9, color: C.muted }}>ELO</span></div>
                        </div>
                        <div style={{ fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 3, color: C.muted, paddingTop: 4 }}>VS</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 1.5, lineHeight: 1.1 }}>{pName(h2hB).toUpperCase()}</div>
                          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 15, color: C.accent, marginTop: 4 }}>{sB.elo} <span style={{ fontSize: 9, color: C.muted }}>ELO</span></div>
                        </div>
                      </div>

                      {total > 0 ? (
                        <>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 14, marginTop: 14 }}>
                            <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 48, lineHeight: 1, color: wA >= wB ? C.green : C.text }}>{wA}</span>
                            <span style={{ fontSize: 11, color: C.muted, letterSpacing: 2 }}>{total} DUEL{total > 1 ? "S" : ""}</span>
                            <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 48, lineHeight: 1, color: wB > wA ? C.green : C.text }}>{wB}</span>
                          </div>
                          <div style={{ height: 6, background: C.red + "66", borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
                            <div style={{ height: "100%", width: (wA / total * 100) + "%", background: C.green, borderRadius: 3 }} />
                          </div>
                          {verdict && <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: C.accent }}>{verdict}</div>}
                        </>
                      ) : (
                        <div style={{ marginTop: 14, fontSize: 12, color: C.muted }}>Jamais affrontés — le premier duel reste à écrire.</div>
                      )}
                    </div>

                    {/* ── Indice Folelli ── */}
                    {indice !== null && (
                      <div style={{ background: C.card, border: `1px solid ${C.accent}33`, borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>⚡ INDICE FOLELLI — PROCHAIN DUEL</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, width: 44 }}>{indice}%</span>
                          <div style={{ flex: 1, height: 8, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                            <div style={{ width: indice + "%", background: indice >= 50 ? C.green : C.textSub }} />
                            <div style={{ width: (100 - indice) + "%", background: indice < 50 ? C.green : C.textSub, opacity: 0.6 }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, width: 44, textAlign: "right" }}>{100 - indice}%</span>
                        </div>
                        <div style={{ fontSize: 10, color: C.muted, marginTop: 6, textAlign: "center" }}>
                          {indice === 50 ? "Impossible de les départager" : `${pName(indice > 50 ? h2hA : h2hB).split(" ")[0]} favori`} · calcul : ELO + duels + jeux + forme{total === 0 ? " (jamais affrontés : ELO + forme uniquement)" : ""}
                        </div>
                      </div>
                    )}

                    {/* ── Stats de la rivalité ── */}
                    {total > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, textAlign: "center" }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>🎾 JEUX DANS LES DUELS</div>
                          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 22, marginTop: 4 }}>
                            <span style={{ color: gA >= gB ? C.green : C.text }}>{gA}</span>
                            <span style={{ color: C.muted }}> — </span>
                            <span style={{ color: gB > gA ? C.green : C.text }}>{gB}</span>
                          </div>
                          <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>
                            {gA === gB ? "Égalité parfaite" : `${pName(gA > gB ? h2hA : h2hB).split(" ")[0]} domine les échanges`}
                          </div>
                        </div>
                        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, textAlign: "center" }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>📈 DYNAMIQUE</div>
                          <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 7 }}>
                            {last3Squares.map((won, i) => (
                              <span key={i} style={{
                                width: 24, height: 24, borderRadius: 6, fontSize: 10, fontWeight: 700,
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                background: (won ? C.green : C.red) + "22",
                                border: `1.5px solid ${won ? C.green : C.red}`,
                                color: won ? C.green : C.red,
                              }}>{pName(won ? h2hA : h2hB).charAt(0).toUpperCase()}</span>
                            ))}
                          </div>
                          <div style={{ fontSize: 9, color: C.muted, marginTop: 6 }}>
                            {last3Squares.length > 0 && (last3Squares[last3Squares.length - 1]
                              ? `${pName(h2hA).split(" ")[0]} a pris le dernier duel`
                              : `${pName(h2hB).split(" ")[0]} a pris le dernier duel`)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Ensemble ── */}
                    {togN > 0 && (
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 22 }}>🤝</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>ET EN ÉQUIPE ENSEMBLE ?</div>
                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                            {togN} match{togN > 1 ? "s" : ""} côte à côte · <span style={{ color: togW > togN - togW ? C.green : togW < togN - togW ? C.red : C.accent, fontWeight: 700 }}>{togW}V-{togN - togW}D</span>
                          </div>
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                            {togW > togN - togW ? "Redoutables quand ils s'allient 🔗" : togW < togN - togW ? "Meilleurs ennemis que partenaires 😄" : "Aussi imprévisibles ensemble que face à face"}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Match référence ── */}
                    {ref && total > 1 && (() => {
                      const m = ref.m;
                      const aS = m.sets.filter(s => s.a > s.b).length;
                      const bS = m.sets.filter(s => s.b > s.a).length;
                      const aWin = aS > bS;
                      const winners = aWin ? [m.a1, m.a2] : [m.b1, m.b2];
                      const losers = aWin ? [m.b1, m.b2] : [m.a1, m.a2];
                      const setsTxt = m.sets.map(s => aWin ? `${s.a}-${s.b}` : `${s.b}-${s.a}`).join(" · ");
                      const dateStr = new Date(m.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
                      return (
                        <div style={{ background: `linear-gradient(135deg, ${C.accent}0A, ${C.card})`, border: `1px solid ${C.accent}33`, borderRadius: 10, padding: 12 }}>
                          <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 1.5, marginBottom: 6 }}>💥 LE MATCH RÉFÉRENCE</div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{pName(winners[0]).split(" ")[0]}/{pName(winners[1]).split(" ")[0]} battent {pName(losers[0]).split(" ")[0]}/{pName(losers[1]).split(" ")[0]}</div>
                              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{dateStr} · le plus gros écart de la rivalité (+{ref.diff} jeux)</div>
                            </div>
                            <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 16, color: C.green, flexShrink: 0 }}>{setsTxt}</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Historique des confrontations ── */}
                    {total > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.muted }}>HISTORIQUE DES CONFRONTATIONS</div>
                        {[...duels].reverse().map(m => {
                          const aSets = m.sets.filter(s => s.a > s.b).length;
                          const bSets = m.sets.filter(s => s.b > s.a).length;
                          const aWin = aSets > bSets;
                          const pAinA = [m.a1, m.a2].includes(h2hA);
                          const pAwin = (pAinA && aWin) || (!pAinA && !aWin);
                          const dateStr = new Date(m.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
                          const pApartner = pAinA ? [m.a1, m.a2].find(x => x !== h2hA) : [m.b1, m.b2].find(x => x !== h2hA);
                          const pBpartner = pAinA ? [m.b1, m.b2].find(x => x !== h2hB) : [m.a1, m.a2].find(x => x !== h2hB);
                          const displaySets = m.sets.map(s => pAinA ? s : { a: s.b, b: s.a });
                          return (
                            <div key={m.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{dateStr}{m.superTieBreak ? " · STB" : ""}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ flex: 1, textAlign: "right" }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: pAwin ? C.green : C.text }}>{pName(h2hA)}</div>
                                  <div style={{ fontSize: 11, color: C.muted }}>avec {pName(pApartner)}</div>
                                </div>
                                <div style={{ textAlign: "center", minWidth: 80 }}>
                                  <div style={{ display: "flex", gap: 4, justifyContent: "center", marginBottom: 2 }}>
                                    {displaySets.map((s, i) => (
                                      <span key={i} style={{ fontSize: 11 }}>
                                        <span style={{ color: s.a > s.b ? C.green : C.text }}>{s.a}</span>
                                        <span style={{ color: C.muted }}>-</span>
                                        <span style={{ color: s.b > s.a ? C.green : C.text }}>{s.b}</span>
                                      </span>
                                    ))}
                                  </div>
                                  <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, color: C.accent }}>
                                    {displaySets.filter(s => s.a > s.b).length} — {displaySets.filter(s => s.b > s.a).length}
                                  </div>
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: !pAwin ? C.green : C.text }}>{pName(h2hB)}</div>
                                  <div style={{ fontSize: 11, color: C.muted }}>avec {pName(pBpartner)}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* ── RECORDS ── */}
          {tab === "records" && (() => {
            const pName = id => players.find(p => p.id === id)?.name || "?";
            const sorted = [...matches].map((m,i) => ({...m, _idx:i})).sort((a,b) => new Date(a.date)-new Date(b.date)||a._idx-b._idx);

            // Per-match stats
            const matchStats = sorted.map(m => {
              const aSets = m.sets.filter(s => s.a > s.b).length;
              const bSets = m.sets.filter(s => s.b > s.a).length;
              const aWin = aSets > bSets;
              const realSetsR = m.superTieBreak ? m.sets.slice(0, -1) : m.sets;
              const totalGamesA = realSetsR.reduce((s, x) => s + x.a, 0);
              const totalGamesB = realSetsR.reduce((s, x) => s + x.b, 0);
              const diff = Math.abs(totalGamesA - totalGamesB);
              const dateStr = new Date(m.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
              const winners = aWin ? [m.a1, m.a2] : [m.b1, m.b2];
              const losers  = aWin ? [m.b1, m.b2] : [m.a1, m.a2];
              const winnerGames = aWin ? totalGamesA : totalGamesB;
              const loserGames  = aWin ? totalGamesB : totalGamesA;
              return { ...m, aSets, bSets, aWin, totalGamesA, totalGamesB, diff, dateStr, winners, losers, winnerGames, loserGames };
            });

            // Upsets : victoires d'équipes avec un ELO moyen inférieur (ELO au moment du match)
            const snapshots = eloStats.snapshots || [];
            const upsets = matchStats.map((m, idx) => {
              const preSnap = idx > 0 ? snapshots[idx - 1] : null;
              const getElo = id => preSnap ? (preSnap[id] ?? ELO_START) : ELO_START;
              const avgWinners = (getElo(m.winners[0]) + getElo(m.winners[1])) / 2;
              const avgLosers = (getElo(m.losers[0]) + getElo(m.losers[1])) / 2;
              const eloGap = Math.round(avgLosers - avgWinners); // positif = surprise
              return { ...m, avgWinners: Math.round(avgWinners), avgLosers: Math.round(avgLosers), eloGap };
            }).filter(m => m.eloGap > 0).sort((a, b) => b.eloGap - a.eloGap);

            // Per-player max streaks
            const streakStats = eloStats.map(p => {
              let curW = 0, curL = 0, maxW = 0, maxL = 0;
              sorted.forEach(m => {
                const inA = [m.a1,m.a2].includes(p.id), inB = [m.b1,m.b2].includes(p.id);
                if (!inA && !inB) return;
                const aS = m.sets.filter(s=>s.a>s.b).length, bS = m.sets.filter(s=>s.b>s.a).length;
                const won = (inA && aS>bS)||(inB && bS>aS);
                if (won) { curW++; curL=0; maxW=Math.max(maxW,curW); }
                else     { curL++; curW=0; maxL=Math.max(maxL,curL); }
              });
              return { name: p.name, maxW, maxL };
            });

            const qualified3 = eloStats.filter(p => p.played >= 3);
            const medals = ["🥇", "🥈", "🥉"];

            // Generic top-3 detail renderer
            const Top3 = ({ entries, valueColor }) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {entries.slice(0, 3).map((e, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `1px solid ${i === 0 ? C.accent + "55" : C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                    <span style={{ fontSize: 20 }}>{medals[i]}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: C.text }}>{e.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: valueColor || C.accent }}>{e.value}</span>
                  </div>
                ))}
              </div>
            );

            const matchLabel = m => `${pName(m.winners[0])}/${pName(m.winners[1])} vs ${pName(m.losers[0])}/${pName(m.losers[1])}`;
            // Sets orientés du point de vue des vainqueurs (listés en premier dans matchLabel)
            const setsStr = m => m.sets.map(s => m.aWin ? `${s.a}-${s.b}` : `${s.b}-${s.a}`).join(" · ");

            // Rankings for each record
            const rBiggestWin = [...matchStats].sort((a,b) => b.diff - a.diff);
            const rTightest   = [...matchStats].sort((a,b) => a.diff - b.diff);
            const rLongest    = [...matchStats].sort((a,b) => b.sets.length - a.sets.length || (b.totalGamesA+b.totalGamesB) - (a.totalGamesA+a.totalGamesB));
            const rMostPlayed = [...eloStats].filter(p=>p.played>0).sort((a,b) => b.played - a.played);
            const rBestWR     = [...qualified3].sort((a,b) => (b.wins/b.played) - (a.wins/a.played));
            const rWorstWR    = [...qualified3].sort((a,b) => (a.wins/a.played) - (b.wins/b.played));
            const gwPerSet = p => p.setsPlayed > 0 ? p.gamesW / p.setsPlayed : 0;
            const glPerSet = p => p.setsPlayed > 0 ? p.gamesL / p.setsPlayed : 0;
            const rGwPerSet = [...qualified3].filter(p => p.setsPlayed > 0).sort((a,b) => gwPerSet(b) - gwPerSet(a));
            const rGlPerSet = [...qualified3].filter(p => p.setsPlayed > 0).sort((a,b) => glPerSet(a) - glPerSet(b));
            const gamePct = p => (p.gamesW + p.gamesL) > 0 ? p.gamesW / (p.gamesW + p.gamesL) : 0;
            const rBestPct = [...qualified3].sort((a,b) => gamePct(b) - gamePct(a));
            const rWorstPct = [...qualified3].sort((a,b) => gamePct(a) - gamePct(b));

            // ── 6-0 infligés / encaissés + % de sets + régicide ──
            const bagelsFor = {}, bagelsAgainst = {}, setsWon = {}, setsLost = {};
            eloStats.forEach(p => { bagelsFor[p.id] = 0; bagelsAgainst[p.id] = 0; setsWon[p.id] = 0; setsLost[p.id] = 0; });
            sorted.forEach(m => {
              const realG = m.superTieBreak ? m.sets.slice(0, -1) : m.sets;
              [[m.a1, "A"], [m.a2, "A"], [m.b1, "B"], [m.b2, "B"]].forEach(([id, team]) => {
                if (setsWon[id] === undefined) return;
                m.sets.forEach(s => {
                  const mine = team === "A" ? s.a : s.b;
                  const theirs = team === "A" ? s.b : s.a;
                  if (mine > theirs) setsWon[id]++; else setsLost[id]++;
                });
                realG.forEach(s => {
                  const mine = team === "A" ? s.a : s.b;
                  const theirs = team === "A" ? s.b : s.a;
                  if (mine === 6 && theirs === 0) bagelsFor[id]++;
                  if (theirs === 6 && mine === 0) bagelsAgainst[id]++;
                });
              });
            });
            const pctSets = id => (setsWon[id] + setsLost[id]) > 0 ? setsWon[id] / (setsWon[id] + setsLost[id]) : 0;
            const rBagelsFor = eloStats.filter(p => bagelsFor[p.id] > 0).sort((a, b) => bagelsFor[b.id] - bagelsFor[a.id]);
            const rBagelsAgainst = eloStats.filter(p => bagelsAgainst[p.id] > 0).sort((a, b) => bagelsAgainst[b.id] - bagelsAgainst[a.id]);
            const rBestSets = [...qualified3].sort((a, b) => pctSets(b.id) - pctSets(a.id));
            const rWorstSets = [...qualified3].sort((a, b) => pctSets(a.id) - pctSets(b.id));

            // Régicide : victoires contre le n°1 en titre (avant le match)
            const regicide = {};
            eloStats.forEach(p => { regicide[p.id] = 0; });
            sorted.forEach((m, idx) => {
              if (idx === 0) return;
              const pre = snapshots[idx - 1];
              if (!pre) return;
              const topId = players.map(pl => ({ id: pl.id, elo: pre[pl.id] ?? ELO_START })).sort((a, b) => b.elo - a.elo)[0]?.id;
              if (!topId) return;
              const aS = m.sets.filter(s => s.a > s.b).length;
              const bS = m.sets.filter(s => s.b > s.a).length;
              const winners = aS > bS ? [m.a1, m.a2] : [m.b1, m.b2];
              const losers = aS > bS ? [m.b1, m.b2] : [m.a1, m.a2];
              if (losers.includes(topId)) winners.forEach(w => { if (regicide[w] !== undefined) regicide[w]++; });
            });
            const rRegicide = eloStats.filter(p => regicide[p.id] > 0).sort((a, b) => regicide[b.id] - regicide[a.id]);

            // Calendrier le plus dur : formule hybride (déjà calculée dans eloStats)
            const oppEloStats = qualified3
              .filter(p => p.avgOppElo !== null && p.avgOppElo !== undefined)
              .map(p => ({ name: p.name, avgOppElo: p.avgOppElo, count: p.played }))
              .sort((a, b) => b.avgOppElo - a.avgOppElo);

            // Tueur de géants : win rate contre les joueurs actuellement top 3 (qualifiés)
            const top3Ids = eloStats.filter(p => p.played >= MIN_MATCHES).slice(0, 3).map(p => p.id);
            const giantStats = qualified3.map(p => {
              let w = 0, l = 0;
              sorted.forEach(m => {
                const inA = [m.a1, m.a2].includes(p.id);
                const inB = [m.b1, m.b2].includes(p.id);
                if (!inA && !inB) return;
                const opps = inA ? [m.b1, m.b2] : [m.a1, m.a2];
                if (!opps.some(id => top3Ids.includes(id))) return;
                const aS = m.sets.filter(s => s.a > s.b).length;
                const bS = m.sets.filter(s => s.b > s.a).length;
                const won = (inA && aS > bS) || (inB && bS > aS);
                if (won) w++; else l++;
              });
              return { name: p.name, w, l, total: w + l };
            }).filter(g => g.total >= 2).sort((a, b) => (b.w / b.total) - (a.w / a.total) || b.w - a.w);
            const rStreakW    = [...streakStats].filter(s=>s.maxW>=1).sort((a,b) => b.maxW - a.maxW);
            const rStreakL    = [...streakStats].filter(s=>s.maxL>=1).sort((a,b) => b.maxL - a.maxL);


            // Build record configs
            const matchRecords = [
              rBiggestWin[0] && { icon: "💥", title: "Victoire la + nette", holder: `${pName(rBiggestWin[0].winners[0])} / ${pName(rBiggestWin[0].winners[1])}`, value: `+${rBiggestWin[0].diff} jeux`, color: C.green,
                detail: <Top3 valueColor={C.green} entries={rBiggestWin.map(m => ({ label: `${matchLabel(m)} — ${setsStr(m)} (${m.dateStr})`, value: `+${m.diff}` }))} /> },
              rTightest[0] && { icon: "😅", title: "Match le + serré", holder: matchLabel(rTightest[0]), value: `±${rTightest[0].diff} jeux`, color: C.accent,
                detail: <Top3 valueColor={C.accent} entries={rTightest.map(m => ({ label: `${matchLabel(m)} — ${setsStr(m)} (${m.dateStr})`, value: `±${m.diff}` }))} /> },
              rLongest[0] && { icon: "⏱️", title: "Match le + long", holder: matchLabel(rLongest[0]), value: `${rLongest[0].sets.length} sets`, color: C.textSub,
                detail: <Top3 valueColor={C.textSub} entries={rLongest.map(m => ({ label: `${matchLabel(m)} — ${setsStr(m)} (${m.dateStr})`, value: `${m.sets.length} sets · ${m.totalGamesA + m.totalGamesB}j` }))} /> },
              upsets[0] && { icon: "🎲", title: "Victoire surprise", holder: `${pName(upsets[0].winners[0])} / ${pName(upsets[0].winners[1])}`, value: `+${upsets[0].eloGap} ELO`, color: C.blue,
                detail: <Top3 valueColor={C.blue} entries={upsets.map(m => ({ label: `${matchLabel(m)} — ${setsStr(m)} (${m.dateStr}) · ELO ${m.avgWinners} vs ${m.avgLosers}`, value: `+${m.eloGap}` }))} /> },
            ].filter(Boolean);

            const playerRecords = [
              rMostPlayed[0] && { icon: "🎾", title: "+ de matchs", holder: rMostPlayed[0].name, value: `${rMostPlayed[0].played}`, color: C.accent,
                detail: <Top3 valueColor={C.accent} entries={rMostPlayed.map(p => ({ label: p.name, value: `${p.played} matchs` }))} /> },
              rBestWR[0] && { icon: "🔥", title: "Meilleur win rate", holder: rBestWR[0].name, value: `${Math.round(rBestWR[0].wins/rBestWR[0].played*100)}%`, color: C.green,
                detail: <Top3 valueColor={C.green} entries={rBestWR.map(p => ({ label: `${p.name} (${p.wins}V/${p.losses}D)`, value: `${Math.round(p.wins/p.played*100)}%` }))} /> },
              rWorstWR[0] && { icon: "😬", title: "Pire win rate", holder: rWorstWR[0].name, value: `${Math.round(rWorstWR[0].wins/rWorstWR[0].played*100)}%`, color: C.red,
                detail: <Top3 valueColor={C.red} entries={rWorstWR.map(p => ({ label: `${p.name} (${p.wins}V/${p.losses}D)`, value: `${Math.round(p.wins/p.played*100)}%` }))} /> },
              rGwPerSet[0] && { icon: "🎯", title: "Jeux gagnés / set", holder: rGwPerSet[0].name, value: gwPerSet(rGwPerSet[0]).toFixed(1), color: C.green,
                detail: <Top3 valueColor={C.green} entries={rGwPerSet.map(p => ({ label: `${p.name} (${p.setsPlayed} sets)`, value: gwPerSet(p).toFixed(2) }))} /> },
              rGlPerSet[0] && { icon: "🧱", title: "Moins de jeux encaissés / set", holder: rGlPerSet[0].name, value: glPerSet(rGlPerSet[0]).toFixed(1), color: C.blue,
                detail: <Top3 valueColor={C.blue} entries={rGlPerSet.map(p => ({ label: `${p.name} (${p.setsPlayed} sets)`, value: glPerSet(p).toFixed(2) }))} /> },
              rBestPct[0] && { icon: "⚔️", title: "Meilleur % de jeux gagnés", holder: rBestPct[0].name, value: `${Math.round(gamePct(rBestPct[0]) * 100)}%`, color: C.green,
                detail: <Top3 valueColor={C.green} entries={rBestPct.map(p => ({ label: `${p.name} (${p.gamesW}G/${p.gamesL}P)`, value: `${Math.round(gamePct(p) * 100)}%` }))} /> },
              rWorstPct[0] && { icon: "🛡️", title: "Pire % de jeux gagnés", holder: rWorstPct[0].name, value: `${Math.round(gamePct(rWorstPct[0]) * 100)}%`, color: C.red,
                detail: <Top3 valueColor={C.red} entries={rWorstPct.map(p => ({ label: `${p.name} (${p.gamesW}G/${p.gamesL}P)`, value: `${Math.round(gamePct(p) * 100)}%` }))} /> },
              oppEloStats[0] && { icon: "📅", title: "Calendrier le + dur", holder: oppEloStats[0].name, value: `${oppEloStats[0].avgOppElo}`, color: C.accent,
                detail: <Top3 valueColor={C.accent} entries={oppEloStats.map(o => ({ label: `${o.name} (${o.count} matchs)`, value: `ELO moy. ${o.avgOppElo}` }))} /> },
              giantStats[0] && { icon: "🏔️", title: "Tueur de géants", holder: giantStats[0].name, value: `${Math.round(giantStats[0].w / giantStats[0].total * 100)}%`, color: C.blue,
                detail: <Top3 valueColor={C.blue} entries={giantStats.map(g => ({ label: `${g.name} (${g.w}V/${g.l}D vs top 3)`, value: `${Math.round(g.w / g.total * 100)}%` }))} /> },
              rStreakW[0] && rStreakW[0].maxW >= 2 && { icon: "⚡", title: "Série de victoires", holder: rStreakW[0].name, value: `${rStreakW[0].maxW}`, color: C.green,
                detail: <Top3 valueColor={C.green} entries={rStreakW.map(s => ({ label: s.name, value: `${s.maxW} victoires` }))} /> },
              rStreakL[0] && rStreakL[0].maxL >= 2 && { icon: "❄️", title: "Série de défaites", holder: rStreakL[0].name, value: `${rStreakL[0].maxL}`, color: C.red,
                detail: <Top3 valueColor={C.red} entries={rStreakL.map(s => ({ label: s.name, value: `${s.maxL} défaites` }))} /> },
              rBestSets[0] && { icon: "🎯", title: "Meilleur % de sets", holder: rBestSets[0].name, value: `${Math.round(pctSets(rBestSets[0].id) * 100)}%`, color: C.green,
                detail: <Top3 valueColor={C.green} entries={rBestSets.map(p => ({ label: `${p.name} (${setsWon[p.id]}S/${setsLost[p.id]}P)`, value: `${Math.round(pctSets(p.id) * 100)}%` }))} /> },
              rWorstSets[0] && { icon: "📉", title: "Pire % de sets", holder: rWorstSets[0].name, value: `${Math.round(pctSets(rWorstSets[0].id) * 100)}%`, color: C.red,
                detail: <Top3 valueColor={C.red} entries={rWorstSets.map(p => ({ label: `${p.name} (${setsWon[p.id]}S/${setsLost[p.id]}P)`, value: `${Math.round(pctSets(p.id) * 100)}%` }))} /> },
              rBagelsFor[0] && { icon: "🥯", title: "Roi du 6-0", holder: rBagelsFor[0].name, value: `${bagelsFor[rBagelsFor[0].id]}`, color: C.green,
                detail: <Top3 valueColor={C.green} entries={rBagelsFor.map(p => ({ label: p.name, value: `${bagelsFor[p.id]} set${bagelsFor[p.id] > 1 ? "s" : ""} blanc${bagelsFor[p.id] > 1 ? "s" : ""}` }))} /> },
              rBagelsAgainst[0] && { icon: "😵", title: "Encaisseur de 6-0", holder: rBagelsAgainst[0].name, value: `${bagelsAgainst[rBagelsAgainst[0].id]}`, color: C.red,
                detail: <Top3 valueColor={C.red} entries={rBagelsAgainst.map(p => ({ label: p.name, value: `${bagelsAgainst[p.id]} set${bagelsAgainst[p.id] > 1 ? "s" : ""} blanc${bagelsAgainst[p.id] > 1 ? "s" : ""}` }))} /> },
              rRegicide[0] && { icon: "🗡️", title: "Régicide", holder: rRegicide[0].name, value: `${regicide[rRegicide[0].id]}`, color: C.blue,
                detail: <Top3 valueColor={C.blue} entries={rRegicide.map(p => ({ label: `${p.name} — victoires vs le n°1 en titre`, value: `${regicide[p.id]}` }))} /> },
            ].filter(Boolean);

            // Trophy tile
            const Tile = ({ r, i }) => (
              <div onClick={() => setActiveRecord(r)}
                className="tile-press"
                style={{
                  background: `linear-gradient(160deg, ${r.color}10, ${C.card} 60%)`,
                  border: `1px solid ${r.color}33`,
                  borderRadius: 12, padding: "14px 12px", cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 6,
                  minHeight: 120, justifyContent: "center"
                }}>
                <span style={{ fontSize: 26 }}>{r.icon}</span>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", lineHeight: 1.3 }}>{r.title}</div>
                <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 22, color: r.color, lineHeight: 1 }}>{r.value}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{r.holder}</div>
              </div>
            );

            const RecordModal = ({ record, onClose }) => {
              if (!record) return null;
              return (
                <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 10px calc(100px + env(safe-area-inset-bottom))" }}
                  onClick={onClose}>
                  <div className="slide-up" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, maxHeight: "calc(100dvh - 150px)", overflowY: "auto" }}
                    onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 24 }}>{record.icon}</span>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: record.color || C.text }}>{record.title}</span>
                      </div>
                      <button onClick={onClose} style={{ background: C.border, color: C.muted, padding: "4px 10px", fontSize: 13 }}>✕</button>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>TOP 3</div>
                    {record.detail}
                  </div>
                </div>
              );
            };

            if (matches.length === 0) return (
              <p style={{ color: C.muted, fontSize: 13 }}>Pas encore de matchs enregistrés.</p>
            );

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 3, color: C.accent }}>🏆 MATCHS</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {matchRecords.map((r, i) => <Tile key={i} r={r} i={i} />)}
                </div>

                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 3, color: C.accent, marginTop: 6 }}>👤 JOUEURS</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {playerRecords.map((r, i) => <Tile key={i} r={r} i={i} />)}
                </div>

                <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 4 }}>
                  Appuie sur un trophée pour voir le top 3
                </div>

                <RecordModal record={activeRecord} onClose={() => setActiveRecord(null)} />
              </div>
            );
          })()}

          {/* ── RÈGNES ── */}
          {tab === "reigns" && (() => {
            const pName = id => players.find(p => p.id === id)?.name || "?";
            const medals = ["🥇", "🥈", "🥉"];

            const Section = ({ title }) => (
              <div style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 3, color: C.accent, marginTop: 8 }}>{title}</div>
            );

            const Top3 = ({ entries, valueColor }) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {entries.slice(0, 3).map((e, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface, border: `1px solid ${i === 0 ? C.accent + "55" : C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                    <span style={{ fontSize: 20 }}>{medals[i]}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: C.text }}>{e.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: valueColor || C.accent }}>{e.value}</span>
                  </div>
                ))}
              </div>
            );

            const RecordCard = ({ icon, title, value, sub, color, detail }) => (
              <div onClick={() => detail && setActiveRecord({ icon, title, value, sub, color, detail })}
                style={{ background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14,
                  cursor: detail ? "pointer" : "default" }}>
                <span style={{ fontSize: 28, flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>{title}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: color || C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
                  {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
                </div>
                {detail && <span style={{ fontSize: 16, color: C.muted, flexShrink: 0 }}>›</span>}
              </div>
            );

            const RecordModal = ({ record, onClose }) => {
              if (!record) return null;
              return (
                <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 10px calc(100px + env(safe-area-inset-bottom))" }}
                  onClick={onClose}>
                  <div className="slide-up" style={{ width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, maxHeight: "calc(100dvh - 150px)", overflowY: "auto" }}
                    onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 24 }}>{record.icon}</span>
                        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: record.color || C.text }}>{record.title}</span>
                      </div>
                      <button onClick={onClose} style={{ background: C.border, color: C.muted, padding: "4px 10px", fontSize: 13 }}>✕</button>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>TOP 3</div>
                    {record.detail}
                  </div>
                </div>
              );
            };

            if (!eloStats.reigns || eloStats.reigns.length === 0) return (
              <p style={{ color: C.muted, fontSize: 13 }}>Pas encore de matchs enregistrés.</p>
            );

            // ── Joueur du mois ──
            const monthlyAll = computeMonthly(players, matches);
            const monthKeys = Object.keys(monthlyAll).sort();
            const nowMonth = new Date().toISOString().slice(0, 7);
            const currentRace = monthlyAll[nowMonth] || null;
            const pastMonths = monthKeys.filter(m => m < nowMonth).reverse();
            const monthLabel = m => {
              const [y, mo] = m.split("-");
              const noms = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
              return `${noms[parseInt(mo)]} ${y}`;
            };
            const daysLeft = (() => {
              const now = new Date();
              const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
              return end.getDate() - now.getDate();
            })();
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                {/* ── Sous-menu ── */}
                <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4, gap: 4 }}>
                  {[["mois", "🏆 Titres"], ["regnes", "👑 Règnes"]].map(([id, label]) => (
                    <button key={id} onClick={() => setPalmaresView(id)} style={{
                      flex: 1, padding: "9px 0", borderRadius: 7, fontSize: 12, fontWeight: 700,
                      background: palmaresView === id ? C.accent : "transparent",
                      color: palmaresView === id ? "#080E0A" : C.muted,
                    }}>{label}</button>
                  ))}
                </div>

                {palmaresView === "mois" && (() => {
                  const { monthly, quarters, years, pName: pn } = computePeriods(players, matches);
                  const noms = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
                  const now = new Date();
                  const nowMonth = now.toISOString().slice(0, 7);
                  const nowQ = `${now.getFullYear()}-T${Math.floor(now.getMonth() / 3) + 1}`;
                  const nowYear = `${now.getFullYear()}`;
                  const qNames = { 1: "Hiver (janv→mars)", 2: "Printemps (avr→juin)", 3: "Été (juil→sept)", 4: "Automne (oct→déc)" };

                  const monthLabel = m => { const [y, mo] = m.split("-"); return `${noms[parseInt(mo)]} ${y}`; };
                  const quarterLabel = q => { const [y, t] = q.split("-T"); return `${q.replace("-", " ")} · ${qNames[parseInt(t)]}`; };

                  const daysLeftMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
                  const daysLeftQ = Math.ceil((new Date(now.getFullYear(), (Math.floor(now.getMonth() / 3) + 1) * 3, 0) - now) / 86400000);
                  const daysLeftYear = Math.ceil((new Date(now.getFullYear(), 11, 31) - now) / 86400000);

                  // Config selon la période choisie
                  const cfg = {
                    mois: { data: monthly, currentKey: nowMonth, label: monthLabel, icon: "🏆", title: "JOUEUR DU MOIS", daysLeft: daysLeftMonth, palmLabel: "MOIS" },
                    trimestre: { data: quarters, currentKey: nowQ, label: quarterLabel, icon: "🏅", title: "JOUEUR DU TRIMESTRE", daysLeft: daysLeftQ, palmLabel: "TRIMESTRES" },
                    annee: { data: years, currentKey: nowYear, label: y => y, icon: "👑", title: "JOUEUR DE L'ANNÉE", daysLeft: daysLeftYear, palmLabel: "ANNÉES" },
                  }[titrePeriod];

                  const keys = Object.keys(cfg.data).sort();
                  const currentRace = cfg.data[cfg.currentKey] || null;
                  const pastKeys = keys.filter(k => k < cfg.currentKey).reverse();

                  // Détail d'un classement (pour le podium au tap) — mois a le détail complet, trimestre/année juste le score cumulé
                  const detailFor = key => {
                    if (titrePeriod === "mois") {
                      return monthly[key].map(r => [`${pn(r.id)} (ΔELO ${r.dElo >= 0 ? "+" : ""}${r.dElo} · ${r.wins}V/${r.played}m · ${r.pct}% jeux)`, `${r.score}`]);
                    }
                    return cfg.data[key].map(r => [`${pn(r.id)}`, `${r.score}`]);
                  };

                  return (
                    <>
                      {/* Sélecteur de période */}
                      <div style={{ display: "flex", gap: 6 }}>
                        {[["mois", "🏆 Mois"], ["trimestre", "🏅 Trimestre"], ["annee", "👑 Année"]].map(([id, label]) => (
                          <button key={id} onClick={() => setTitrePeriod(id)} style={{
                            flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: 700,
                            border: `1px solid ${titrePeriod === id ? C.accent : C.border}`,
                            background: titrePeriod === id ? C.accent + "18" : "transparent",
                            color: titrePeriod === id ? C.accent : C.muted,
                          }}>{label}</button>
                        ))}
                      </div>

                      <div style={{ fontSize: 10, color: C.muted }}>
                        Score = ΔELO + 3×victoires + (% jeux − 50)÷2{titrePeriod !== "mois" ? " · cumul des mois (0 si mois non joué)" : " · min. 2 matchs dans le mois"} · réservé aux joueurs classés ({MIN_MATCHES}+ matchs)
                      </div>

                      {/* Course en cours */}
                      {currentRace ? (
                        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>{cfg.icon} COURSE — {cfg.label(cfg.currentKey).toUpperCase()}</span>
                            <span style={{ fontSize: 10, color: C.green }}>● {cfg.daysLeft}j restant{cfg.daysLeft > 1 ? "s" : ""}</span>
                          </div>
                          <div style={{ marginTop: 6 }}>
                            {currentRace.slice(0, 5).map((r, i) => {
                              const rc = ["#c8a84b", "#9eaebd", "#c07a3a"][i] || null;
                              const detail = titrePeriod === "mois" ? monthly[cfg.currentKey].find(x => x.id === r.id) : null;
                              return (
                                <div key={r.id} style={{
                                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 6,
                                  background: rc ? `linear-gradient(135deg, ${rc}10, ${C.surface})` : C.surface,
                                  border: `1px solid ${rc ? rc + "44" : C.border}`, borderRadius: 8
                                }}>
                                  <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: rc || "transparent", border: rc ? "none" : `1px solid ${C.border}`, color: rc ? "#080E0A" : C.muted, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600 }}>{pn(r.id)}</div>
                                    {detail && <div style={{ fontSize: 10, color: C.muted }}>ΔELO {detail.dElo >= 0 ? "+" : ""}{detail.dElo} · {detail.wins}V/{detail.played}m · {detail.pct}% jeux</div>}
                                  </div>
                                  <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 19, color: r.score >= 0 ? C.accent : C.red }}>{r.score}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p style={{ fontSize: 12, color: C.muted }}>Pas encore de scores pour cette période.</p>
                      )}

                      {/* ── Trophées de l'année (volet Année uniquement) ── */}
                      {titrePeriod === "annee" && (() => {
                        const year = parseInt(cfg.currentKey);
                        const { attaquant, defenseur, progression } = computeYearTrophies(players, matches, year);
                        const Trophy = ({ icon, title, sub, color, top3, valueFmt, empty }) => (
                          <div className="tile-press" onClick={() => top3.length > 0 && setActiveRecord({
                            icon, title: `${title} — ${year}`, color,
                            detail: <Top3 valueColor={color} entries={top3.slice(0, 3).map(e => ({ label: `${e.name} (${e.played} matchs)`, value: valueFmt(e.val) }))} />
                          })} style={{
                            background: `linear-gradient(150deg, ${color}12, ${C.card})`, border: `1px solid ${color}44`,
                            borderRadius: 12, padding: 14, cursor: top3.length > 0 ? "pointer" : "default", marginBottom: 8
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, background: `${color}1c`, border: `1px solid ${color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{icon}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: 1.5 }}>{title}</div>
                                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 1 }}>{top3.length > 0 ? top3[0].name : "—"}</div>
                                <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{sub}</div>
                              </div>
                              {top3.length > 0 && (
                                <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 22, color, flexShrink: 0 }}>{valueFmt(top3[0].val)}</div>
                              )}
                            </div>
                            {top3.length === 0 && <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>{empty}</div>}
                          </div>
                        );
                        return (
                          <>
                            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: C.accent, marginTop: 6 }}>🏆 TROPHÉES {year}</div>
                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Remis à zéro chaque année · appuie pour le top 3</div>
                            <Trophy icon="⚔️" title="ATTAQUANT DE L'ANNÉE" sub="Jeux gagnés par set · min. 5 matchs" color={C.red}
                              top3={attaquant} valueFmt={v => v.toFixed(1)} empty="Aucun joueur à 5 matchs cette année." />
                            <Trophy icon="🧱" title="DÉFENSEUR DE L'ANNÉE" sub="Jeux encaissés par set · min. 5 matchs" color={C.blue}
                              top3={defenseur} valueFmt={v => v.toFixed(1)} empty="Aucun joueur à 5 matchs cette année." />
                            <Trophy icon="📈" title="PROGRESSION DE L'ANNÉE" sub={year === 2026 ? "Gain d'ELO depuis le 3e match" : "Gain d'ELO sur l'année"} color={C.green}
                              top3={progression} valueFmt={v => `${v >= 0 ? "+" : ""}${v}`} empty="Pas encore assez de matchs." />
                          </>
                        );
                      })()}

                      {/* Palmarès de la période */}
                      {pastKeys.length > 0 && (
                        <>
                          {(() => {
                            const counts = {};
                            pastKeys.forEach(k => { const w = cfg.data[k][0].id; counts[w] = (counts[w] || 0) + 1; });
                            const board = Object.entries(counts).sort(([, a], [, b]) => b - a);
                            return board.length > 0 ? (
                              <div style={{ background: `linear-gradient(135deg, ${C.accent}0C, ${C.card})`, border: `1px solid ${C.accent}33`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>TABLEAU DES TITRES</span>
                                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                                  {board.map(([id, n], i) => (
                                    <span key={id} style={{ fontSize: 12, fontWeight: 700, color: i === 0 ? C.accent : C.textSub }}>
                                      {cfg.icon} {pn(id)} <span style={{ fontFamily: "'Rajdhani', sans-serif" }}>×{n}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : null;
                          })()}

                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: C.muted, marginTop: 4 }}>PALMARÈS · {cfg.palmLabel}</div>
                          {pastKeys.map(key => {
                            const winner = cfg.data[key][0];
                            return (
                              <div key={key} className="tile-press"
                                onClick={() => setActiveRecord({ icon: cfg.icon, title: `${cfg.title} — ${cfg.label(key).toUpperCase()}`, color: C.accent, detail: <Top3 valueColor={C.accent} entries={detailFor(key).slice(0, 3).map(([label, value]) => ({ label, value }))} /> })}
                                style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", background: `linear-gradient(135deg, ${C.accent}0A, ${C.card})`, border: `1px solid ${C.accent}30`, borderRadius: 10, padding: "11px 14px" }}>
                                <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 1 }}>{cfg.label(key).toUpperCase()}</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{pn(winner.id)}</div>
                                </div>
                                <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 16, color: C.accent }}>{winner.score}</span>
                                <span style={{ fontSize: 14, color: C.muted }}>›</span>
                              </div>
                            );
                          })}
                          <div style={{ fontSize: 10, color: C.muted, textAlign: "center" }}>Appuie pour voir le podium complet</div>
                        </>
                      )}
                    </>
                  );
                })()}

                {palmaresView === "regnes" && (<>


                {(() => {
                  const reigns = eloStats.reigns;
                  const current = reigns[reigns.length - 1];
                  // Aggregate per player
                  const agg = {};
                  reigns.forEach(r => {
                    if (!agg[r.id]) agg[r.id] = { total: 0, count: 0, longest: 0 };
                    agg[r.id].total += r.length;
                    agg[r.id].count++;
                    agg[r.id].longest = Math.max(agg[r.id].longest, r.length);
                  });
                  const aggList = Object.entries(agg)
                    .map(([id, a]) => ({ id, name: pName(id), ...a }))
                    .sort((a, b) => b.total - a.total);
                  const longestReign = reigns.reduce((best, r) => r.length > best.length ? r : best);

                  return (
                    <>
                      <Section title="👑 RÈGNES AU SOMMET" />

                      {/* Champion actuel */}
                      <div style={{ background: `linear-gradient(135deg, ${C.accent}18, ${C.card})`, border: `1px solid ${C.accent}66`, borderRadius: 10, padding: "16px", textAlign: "center", boxShadow: `0 0 16px ${C.accent}22` }}>
                        <div style={{ fontSize: 32, marginBottom: 4 }}>👑</div>
                        <div style={{ fontFamily: "'Bebas Neue'", fontSize: 24, letterSpacing: 2, color: C.accent }}>{pName(current.id)}</div>
                        <div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>
                          Champion en titre · règne depuis <b style={{ color: C.accent }}>{current.length} match{current.length > 1 ? "s" : ""}</b>
                        </div>
                      </div>

                      <RecordCard icon="🏰" title="PLUS LONG RÈGNE"
                        value={pName(longestReign.id)}
                        sub={`${longestReign.length} matchs consécutifs au sommet`}
                        color={C.accent}
                        detail={<Top3 valueColor={C.accent} entries={[...reigns].sort((a,b) => b.length - a.length).map(r => ({ label: pName(r.id), value: `${r.length} match${r.length > 1 ? "s" : ""}` }))} />} />

                      <RecordCard icon="⏳" title="TOTAL DE MATCHS AU SOMMET"
                        value={aggList[0].name}
                        sub={`${aggList[0].total} matchs cumulés en tant que #1 · ${aggList[0].count} règne${aggList[0].count > 1 ? "s" : ""}`}
                        color={C.accent}
                        detail={<Top3 valueColor={C.accent} entries={aggList.map(a => ({ label: `${a.name} (${a.count} règne${a.count > 1 ? "s" : ""})`, value: `${a.total} matchs` }))} />} />

                      {/* Frise des règnes */}
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>FRISE DES RÈGNES</div>
                        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 28 }}>
                          {reigns.map((r, i) => {
                            const reignColors = ["#c8a84b", "#52D17C", "#C4623A", "#9eaebd", "#c07a3a", "#8B6FC4"];
                            // color per unique player
                            const playerIds = [...new Set(reigns.map(x => x.id))];
                            const color = reignColors[playerIds.indexOf(r.id) % reignColors.length];
                            const totalMatches = reigns.reduce((s, x) => s + x.length, 0);
                            return (
                              <div key={i} style={{
                                flex: r.length / totalMatches,
                                background: color + "44",
                                borderRight: i < reigns.length - 1 ? `1px solid ${C.bg}` : "none",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 9, fontWeight: 700, color, minWidth: 20, overflow: "hidden", whiteSpace: "nowrap"
                              }}>
                                {r.length}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                          {[...new Set(reigns.map(x => x.id))].map((id, i) => {
                            const reignColors = ["#c8a84b", "#52D17C", "#C4623A", "#9eaebd", "#c07a3a", "#8B6FC4"];
                            return (
                              <span key={id} style={{ fontSize: 10, color: reignColors[i % reignColors.length], fontWeight: 600 }}>
                                ■ {pName(id)}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Stats globales du groupe */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 32, color: C.accent, lineHeight: 1 }}>{matches.length}</div>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>matchs depuis le début</div>
                        </div>
                        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, textAlign: "center" }}>
                          {(() => {
                            const lastDate = matches.reduce((max, m) => new Date(m.date) > max ? new Date(m.date) : max, new Date(0));
                            const days = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));
                            const color = days <= 7 ? C.green : days <= 21 ? C.accent : C.red;
                            return (
                              <>
                                <div style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 32, color, lineHeight: 1 }}>{days}</div>
                                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>jour{days > 1 ? "s" : ""} depuis le dernier match</div>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Graphique ELO du groupe */}
                      {(() => {
                        const snapshots = eloStats.snapshots || [];
                        if (snapshots.length < 2) return null;
                        const activePlayers = players.filter(p => {
                          const st = eloStats.find(s => s.id === p.id);
                          return st && st.played >= MIN_MATCHES;
                        });
                        const chartColors = ["#c8a84b", "#52D17C", "#C4623A", "#9eaebd", "#c07a3a", "#8B6FC4", "#5BC4B8", "#C45B9B", "#8FC45B", "#C4C45B"];
                        const W = 300, H = 160, PAD = 14;
                        // Build series: start at 1000, then each snapshot
                        const series = activePlayers.map((p, pi) => {
                          const vals = [ELO_START, ...snapshots.map(s => s[p.id] ?? ELO_START)];
                          return { id: p.id, name: pName(p.id), vals, color: chartColors[pi % chartColors.length] };
                        });
                        const allVals = series.flatMap(s => s.vals);
                        const minV = Math.min(...allVals), maxV = Math.max(...allVals);
                        const range = maxV - minV || 1;
                        const n = snapshots.length + 1;
                        const toXY = (v, i) => {
                          const x = PAD + (i / (n - 1)) * (W - 2 * PAD);
                          const y = H - PAD - ((v - minV) / range) * (H - 2 * PAD);
                          return `${x},${y}`;
                        };
                        return (
                          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>📈 ÉVOLUTION ELO DU GROUPE</div>
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <svg width={W} height={H} style={{ maxWidth: "100%" }}>
                                {/* Ligne 1000 de référence */}
                                {(() => {
                                  const y = H - PAD - ((ELO_START - minV) / range) * (H - 2 * PAD);
                                  return <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke={C.muted} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.5" />;
                                })()}
                                {series.map(s => (
                                  <polyline key={s.id}
                                    points={s.vals.map((v, i) => toXY(v, i)).join(" ")}
                                    fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" opacity="0.85" />
                                ))}
                              </svg>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                              {series.map(s => (
                                <span key={s.id} style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>■ {s.name}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}
                </>)}

                <RecordModal record={activeRecord} onClose={() => setActiveRecord(null)} />
              </div>
            );
          })()}

          {/* ── NOUVEAU MATCH ── */}
          {tab === "match" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {players.length < 4 && (
                <div style={{ background: C.accent + "15", border: `1px solid ${C.accent}44`, borderRadius: 8, padding: 12, fontSize: 13, color: C.accent }}>
                  Il faut au moins 4 joueurs. Ajoute-les dans "Joueurs".
                </div>
              )}

              {matchForm.a1 && matchForm.a2 && matchForm.b1 && matchForm.b2 && (() => {
                const get = id => eloStats.find(p => p.id === id);
                const a1s = get(matchForm.a1), a2s = get(matchForm.a2);
                const b1s = get(matchForm.b1), b2s = get(matchForm.b2);
                if (!a1s || !a2s || !b1s || !b2s) return null;
                const avgA = Math.round((a1s.elo + a2s.elo) / 2);
                const avgB = Math.round((b1s.elo + b2s.elo) / 2);
                const expA = eloExpected(avgA, avgB);
                const aSetsF = matchForm.sets.filter(s => parseInt(s.a) > parseInt(s.b)).length;
                const bSetsF = matchForm.sets.filter(s => parseInt(s.b) > parseInt(s.a)).length;
                const totalF = aSetsF + bSetsF;
                const kMultF = matchForm.superTieBreak ? 0.70 : totalF === 1 ? 0.70 : totalF === 2 ? 1.0 : 0.85;
                const gainA = Math.round(K * kMultF * (1 - expA));
                const gainB = Math.round(K * kMultF * expA);
                return (
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, fontSize: 12 }}>
                    <div style={{ color: C.muted, marginBottom: 6, fontWeight: 600, letterSpacing: 1, fontSize: 11 }}>APERÇU ELO (si 2-0)</div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span><b style={{ color: C.text }}>{pName(matchForm.a1)} / {pName(matchForm.a2)}</b> <span style={{ color: C.muted }}>moy. {avgA}</span></span>
                      <span style={{ color: C.green }}>+{gainA} si win</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span><b style={{ color: C.text }}>{pName(matchForm.b1)} / {pName(matchForm.b2)}</b> <span style={{ color: C.muted }}>moy. {avgB}</span></span>
                      <span style={{ color: C.green }}>+{gainB} si win</span>
                    </div>
                  </div>
                );
              })()}

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.accent, marginBottom: 10 }}>ÉQUIPE A</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {["a1", "a2"].map(field => (
                    <select key={field} value={matchForm[field]} onChange={e => setMatchForm(f => ({ ...f, [field]: e.target.value }))}>
                      <option value="">— Joueur —</option>
                      {players.map(p => (
                        <option key={p.id} value={p.id} disabled={[matchForm.a1, matchForm.a2, matchForm.b1, matchForm.b2].filter(x => x !== matchForm[field]).includes(p.id)}>
                          {p.name} ({eloStats.find(s => s.id === p.id)?.elo ?? ELO_START})
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
              </div>

              <div style={{ textAlign: "center", fontFamily: "'Bebas Neue'", fontSize: 22, letterSpacing: 4, color: C.muted }}>VS</div>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.green, marginBottom: 10 }}>ÉQUIPE B</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {["b1", "b2"].map(field => (
                    <select key={field} value={matchForm[field]} onChange={e => setMatchForm(f => ({ ...f, [field]: e.target.value }))}>
                      <option value="">— Joueur —</option>
                      {players.map(p => (
                        <option key={p.id} value={p.id} disabled={[matchForm.a1, matchForm.a2, matchForm.b1, matchForm.b2].filter(x => x !== matchForm[field]).includes(p.id)}>
                          {p.name} ({eloStats.find(s => s.id === p.id)?.elo ?? ELO_START})
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
              </div>

              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: C.muted }}>SETS</div>
                  {matchForm.sets.length === 1 && <span style={{ fontSize: 10, color: C.accent, background: C.accent + "18", border: `1px solid ${C.accent}44`, borderRadius: 4, padding: "2px 6px", fontWeight: 600 }}>FORMAT 1 SET · ×0.70</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {matchForm.sets.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: C.muted, width: 40 }}>Set {i + 1}</span>
                      <input type="number" min="0" max="7" placeholder="A" value={s.a} onChange={e => setSet(i, "a", e.target.value)} style={{ width: 60, textAlign: "center" }} />
                      <span style={{ color: C.muted }}>–</span>
                      <input type="number" min="0" max="7" placeholder="B" value={s.b} onChange={e => setSet(i, "b", e.target.value)} style={{ width: 60, textAlign: "center" }} />
                      {matchForm.sets.length > 1 && (
                        <button onClick={() => removeSet(i)} style={{ background: C.red + "22", color: C.red, padding: "4px 8px", fontSize: 12 }}>✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={addSet} style={{ background: "transparent", border: `1px dashed ${C.border}`, color: C.muted, padding: "6px", fontSize: 12 }}>+ Set</button>
                  {/* Super Tie-Break toggle — visible only when score is 1-1 with exactly 2 sets */}
                  {(() => {
                    const firstTwo = matchForm.sets.slice(0, 2);
                    const aSets = firstTwo.filter(s => parseInt(s.a) > parseInt(s.b)).length;
                    const bSets = firstTwo.filter(s => parseInt(s.b) > parseInt(s.a)).length;
                    const is11 = aSets === 1 && bSets === 1 && matchForm.sets.length <= 3;
                    if (!is11) return null;
                    return (
                      <div
                        onClick={() => setMatchForm(f => ({ ...f, superTieBreak: !f.superTieBreak }))}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, marginTop: 4,
                          background: matchForm.superTieBreak ? C.accent + "18" : C.surface,
                          border: `1px solid ${matchForm.superTieBreak ? C.accent : C.border}`,
                          borderRadius: 8, padding: "10px 12px", cursor: "pointer"
                        }}>
                        <div style={{
                          width: 36, height: 20, borderRadius: 10,
                          background: matchForm.superTieBreak ? C.accent : C.border,
                          position: "relative", transition: "background .2s", flexShrink: 0
                        }}>
                          <div style={{
                            position: "absolute", top: 2, left: matchForm.superTieBreak ? 18 : 2,
                            width: 16, height: 16, borderRadius: "50%", background: "#fff",
                            transition: "left .2s"
                          }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: matchForm.superTieBreak ? C.accent : C.text }}>Super Tie-Break</div>
                          <div style={{ fontSize: 11, color: C.muted }}>Ajoute le score du TB à 10 pts en Set 3 · ×0.70</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <input placeholder="Note (optionnel)" value={matchForm.note} onChange={e => setMatchForm(f => ({ ...f, note: e.target.value }))} />

              <button onClick={submitMatch}
                style={{ background: C.accent, color: "#080E0A", padding: "14px", fontSize: 15, fontWeight: 700, letterSpacing: 1, borderRadius: 8 }}>
                ENREGISTRER LE MATCH
              </button>
            </div>
          )}

          {/* ── HISTORIQUE ── */}
          {tab === "history" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, color: C.accent, marginBottom: 4 }}>
                HISTORIQUE · {matches.length} matchs
              </h2>
              {matches.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>Aucun match enregistré.</p>}
              {[...matches].sort((a, b) => new Date(b.date) - new Date(a.date)).map(m => {
                const aSets = m.sets.filter(s => s.a > s.b).length;
                const bSets = m.sets.filter(s => s.b > s.a).length;
                const aWin = aSets > bSets;
                const dateStr = new Date(m.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
                return (
                  <div key={m.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: C.muted }}>{dateStr}</span>
                        {m.superTieBreak && <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, background: C.accent + "18", border: `1px solid ${C.accent}44`, borderRadius: 4, padding: "1px 6px" }}>STB</span>}
                      </div>
                      {isAdmin && (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {editDateId === m.id ? (
                            <input type="date" defaultValue={new Date(m.date).toISOString().slice(0, 10)}
                              onChange={e => { updateMatchDate(m.id, e.target.value); setEditDateId(null); }}
                              onBlur={() => setEditDateId(null)} autoFocus
                              style={{ fontSize: 11, padding: "2px 4px" }} />
                          ) : (
                            <button onClick={() => setEditDateId(m.id)} style={{ background: "transparent", color: C.muted, fontSize: 13, padding: "2px 6px" }}>✎</button>
                          )}
                          <button onClick={() => deleteMatch(m.id)} style={{ background: "transparent", color: C.muted, fontSize: 11, padding: "2px 6px" }}>✕</button>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, textAlign: "right" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: aWin ? C.green : C.text }}>{pName(m.a1)} / {pName(m.a2)}</span>
                        {aWin && <span style={{ marginLeft: 6 }}><Badge label="WIN" color={C.green} /></span>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 80 }}>
                        <SetScore sets={m.sets} />
                        <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 20, color: C.accent, letterSpacing: 1 }}>{aSets} — {bSets}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        {!aWin && <span style={{ marginRight: 6 }}><Badge label="WIN" color={C.green} /></span>}
                        <span style={{ fontSize: 13, fontWeight: 600, color: !aWin ? C.green : C.text }}>{pName(m.b1)} / {pName(m.b2)}</span>
                      </div>
                    </div>
                    {m.note && <div style={{ marginTop: 8, fontSize: 12, color: C.muted, fontStyle: "italic" }}>{m.note}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── JOUEURS ── */}
          {tab === "players" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <h2 style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: 2, color: C.accent }}>GÉRER LES JOUEURS</h2>

              {/* ── Carte admin ── */}
              <div style={{ background: C.card, border: `1px solid ${isAdmin ? C.green + "66" : C.border}`, borderRadius: 10, padding: 14 }}>
                {isAdmin ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>🔓 Mode admin actif</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Tes modifications sont publiées en ligne pour tout le monde.</div>
                    </div>
                    <button onClick={lockAdmin} style={{ background: C.border, color: C.muted, padding: "8px 12px", fontSize: 12, flexShrink: 0 }}>Verrouiller</button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 8 }}>🔒 Mode lecture</div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Le site est consultable par tous. Pour ajouter des matchs ou des joueurs, entre le code admin.</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input type="password" placeholder="Code admin" value={adminInput} onChange={e => setAdminInput(e.target.value)} onKeyDown={e => e.key === "Enter" && unlockAdmin()} />
                      <button onClick={unlockAdmin} style={{ background: C.accent, color: "#080E0A", padding: "8px 16px", whiteSpace: "nowrap" }}>Déverrouiller</button>
                    </div>
                  </div>
                )}
                {isAdmin && cloudEmpty && (
                  <button onClick={() => persist({ ...data })}
                    style={{ marginTop: 10, width: "100%", background: C.accent, color: "#080E0A", padding: "10px", fontSize: 13, fontWeight: 700 }}>
                    📤 Publier les données initiales sur le cloud
                  </button>
                )}
                {syncing && <div style={{ fontSize: 11, color: C.accent, marginTop: 8 }}>⏳ Synchronisation…</div>}
                {cloudError && <div style={{ fontSize: 11, color: C.red, marginTop: 8 }}>⚠️ Connexion au cloud impossible — données par défaut affichées.</div>}
              </div>
              {isAdmin && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input placeholder="Nom du joueur" value={newPlayer} onChange={e => setNewPlayer(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlayer()} />
                  <button onClick={addPlayer} style={{ background: C.accent, color: "#080E0A", padding: "8px 16px", whiteSpace: "nowrap" }}>Ajouter</button>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {players.length === 0 && <p style={{ color: C.muted, fontSize: 13 }}>Aucun joueur encore.</p>}
                {players.map(p => {
                  const st = eloStats.find(s => s.id === p.id);
                  const editing = editNameId === p.id;
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", gap: 10 }}>
                      {editing ? (
                        <>
                          <input value={editNameVal} onChange={e => setEditNameVal(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") { renamePlayer(p.id, editNameVal); setEditNameId(null); } }}
                            autoFocus style={{ flex: 1, fontSize: 14 }} />
                          <button onClick={() => { renamePlayer(p.id, editNameVal); setEditNameId(null); }} style={{ background: C.green + "22", color: C.green, padding: "4px 10px", fontSize: 12 }}>✓</button>
                          <button onClick={() => setEditNameId(null)} style={{ background: C.border, color: C.muted, padding: "4px 10px", fontSize: 12 }}>✕</button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                          <span style={{ fontSize: 12, color: C.muted }}>{st?.played || 0} match{st?.played !== 1 ? "s" : ""}</span>
                          <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 18, color: C.accent }}>{st?.elo ?? ELO_START}</span>
                          {isAdmin && (
                            <>
                              <button onClick={() => { setEditNameId(p.id); setEditNameVal(p.name); }} style={{ background: "transparent", color: C.muted, fontSize: 14, padding: "4px 6px" }}>✎</button>
                              <button onClick={() => removePlayer(p.id)} style={{ background: C.red + "22", color: C.red, padding: "4px 10px", fontSize: 12 }}>Retirer</button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Barre d'onglets en bas ── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90,
        background: C.surface, borderTop: `1px solid ${C.border}`,
        display: "flex", padding: "6px 4px calc(8px + env(safe-area-inset-bottom))",
        maxWidth: 640, margin: "0 auto",
      }}>
        {mainTabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setMoreOpen(false); }} style={{
            flex: 1, background: "transparent", display: "flex", flexDirection: "column",
            alignItems: "center", gap: 3, padding: "4px 0",
            color: tab === t.id ? C.accent : C.muted,
          }}>
            <span style={{
              fontSize: 19,
              filter: tab === t.id ? "none" : "grayscale(60%) opacity(.75)",
              transform: tab === t.id ? "scale(1.15)" : "none",
              transition: "transform .15s",
            }}>{t.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700 }}>{t.label}</span>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: tab === t.id ? C.accent : "transparent" }} />
          </button>
        ))}
        <button onClick={() => setMoreOpen(v => !v)} style={{
          flex: 1, background: "transparent", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 3, padding: "4px 0",
          color: isMoreTab || moreOpen ? C.accent : C.muted,
        }}>
          <span style={{ fontSize: 19, transform: isMoreTab || moreOpen ? "scale(1.15)" : "none", transition: "transform .15s" }}>
            {isMoreTab ? moreTabs.find(t => t.id === tab)?.icon : "⊞"}
          </span>
          <span style={{ fontSize: 9, fontWeight: 700 }}>Plus</span>
          <span style={{ width: 4, height: 4, borderRadius: "50%", background: isMoreTab || moreOpen ? C.accent : "transparent" }} />
        </button>
      </div>

      {/* ── Menu "Plus" ── */}
      {moreOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 95 }} onClick={() => setMoreOpen(false)}>
          <div className="sheet-up" style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            maxWidth: 640, margin: "0 auto",
            background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px 16px 0 0",
            padding: "16px 16px calc(90px + env(safe-area-inset-bottom))",
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>PLUS D'ONGLETS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {moreTabs.map(t => (
                <button key={t.id} onClick={() => { setTab(t.id); setMoreOpen(false); }} className="tile-press" style={{
                  background: tab === t.id ? C.accent + "18" : C.surface,
                  border: `1px solid ${tab === t.id ? C.accent : C.border}`,
                  borderRadius: 10, padding: "14px 10px",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  color: tab === t.id ? C.accent : C.text,
                }}>
                  <span style={{ fontSize: 24 }}>{t.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Player modal */}
      <PlayerModal player={selectedPlayer} qualifiedOnly={showOnlyQualified} calCount={eloStats.calCount || 0}
        monthTitles={(() => {
          if (!selectedPlayer) return [];
          const { monthly, quarters, years } = computePeriods(players, matches);
          const noms = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
          const now = new Date();
          const nowMonth = now.toISOString().slice(0, 7);
          const nowQ = `${now.getFullYear()}-T${Math.floor(now.getMonth() / 3) + 1}`;
          const nowYear = `${now.getFullYear()}`;
          const titles = [];
          Object.keys(monthly).sort().filter(m => m < nowMonth && monthly[m][0].id === selectedPlayer.id)
            .forEach(m => titles.push(`Mois : ${noms[parseInt(m.split("-")[1])]} ${m.split("-")[0]}`));
          Object.keys(quarters).sort().filter(q => q < nowQ && quarters[q][0].id === selectedPlayer.id)
            .forEach(q => titles.push(`Trimestre : ${q.replace("-", " ")}`));
          Object.keys(years).sort().filter(y => y < nowYear && years[y][0].id === selectedPlayer.id)
            .forEach(y => titles.push(`Année : ${y}`));
          return titles;
        })()}
        onClose={() => setSelectedPlayer(null)} />
    </>
  );
}
