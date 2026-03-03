// ==UserScript==
// @name         Bet261 Virtual • ALL MATCHES Preductor PRO (Tour Memory)
// @namespace    bet261-preductor
// @version      5.6
// @description  Form(3) + Classement + Local cache (tour memory). Keeps last results to follow tour.
// @match        https://bet261.mg/virtual/category/instant-league/8042/*
// @match        https://www.bet261.mg/virtual/category/instant-league/8042/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ===== SETTINGS =====
  const NEED_RESULTS = 3;          // must have 3 results to pick
  const KEEP_MATCHES = 180;        // cache size (50..300 ok)
  const PREDICT_EVERY_MS = 1200;
  const DATA_REFRESH_MS  = 20000;

  const PICK_EDGE = 0.35;
  const DRAW_BAND = 0.20;

  const TOP_N = 6;
  const BONUS_WIN_TOP = 0.25;
  const BONUS_DRAW_TOP = 0.10;

  // ===== Storage keys =====
  const KEY = "bet261_8042_tour_cache_v1"; // league-specific

  // ===== UI =====
  const css = `
  #pred_box{position:fixed;right:10px;bottom:70px;z-index:999999;width:min(760px,calc(100vw - 20px));
    max-height:52vh;overflow:auto;background:#0b1220;color:#e9eefc;border:1px solid #22304f;border-radius:14px;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
  #pred_box b{font-size:13px}
  #pred_box .muted{opacity:.85;font-size:12px}
  #pred_btn,#pred_clear{margin-top:8px;width:100%;padding:10px;border-radius:12px;border:1px solid #2a3a61;background:#1a2742;color:#e9eefc;font-weight:900;cursor:pointer}
  #pred_clear{background:#2a1212;border-color:#5a2020}
  #pred_box table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
  #pred_box th,#pred_box td{border-bottom:1px solid #22304f;padding:7px 6px;text-align:left;vertical-align:top}
  .pill{display:inline-block;margin-left:10px;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:900;border:1px solid #22304f}
  .ok{color:#75ffa1;background:#10241a;border-color:#2a7a4a}
  .mid{color:#ffd875;background:#251f10}
  .bad{color:#ff7d7d;background:#2a1212}
  .wait{color:#8fb3ff;background:#101a2a;border-color:#2b5cff}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "pred_box";
  box.innerHTML = `
    <b>ALL MATCHES • Preductor PRO (Form3 + Classement + Tour Memory)</b>
    <div class="muted" id="pred_status">Init…</div>
    <button id="pred_btn">Force refresh data (Résultats + Classement)</button>
    <button id="pred_clear">Clear cache (reset tour memory)</button>
    <div class="muted" id="pred_debug">debug: —</div>
    <table>
      <thead><tr><th>Match</th><th>Pick</th><th>Rationale</th></tr></thead>
      <tbody id="pred_tbody"></tbody>
    </table>
  `;
  document.body.appendChild(box);

  const statusEl = box.querySelector("#pred_status");
  const debugEl  = box.querySelector("#pred_debug");
  const btnEl    = box.querySelector("#pred_btn");
  const clearEl  = box.querySelector("#pred_clear");
  const tbodyEl  = box.querySelector("#pred_tbody");

  // ===== Helpers =====
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const textOf = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function esc(s){
    return String(s ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function findTab(re) {
    return [...document.querySelectorAll("button,a,div,span")]
      .filter((e) => e.offsetParent !== null)
      .find((e) => re.test(textOf(e)));
  }
  function clickTab(re) {
    const el = findTab(re);
    if (el) { el.click(); return true; }
    return false;
  }

  async function autoScrollLoad(steps = 5) {
    for (let i = 0; i < steps; i++) { window.scrollBy(0, 900); await wait(220); }
    for (let i = 0; i < 2; i++) { window.scrollBy(0, -700); await wait(180); }
  }

  // ===== Cache I/O =====
  function loadCache(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return { matches: [], rank: {} };
      const obj = JSON.parse(raw);
      if(!obj || !Array.isArray(obj.matches) || typeof obj.rank !== "object") return { matches: [], rank: {} };
      return obj;
    }catch{
      return { matches: [], rank: {} };
    }
  }
  function saveCache(cache){
    try{ localStorage.setItem(KEY, JSON.stringify(cache)); }catch{}
  }

  function clearCache(){
    localStorage.removeItem(KEY);
  }

  // ===== Runtime state =====
  let rankMap = new Map();     // team -> rank
  let formMap = new Map();     // team -> ["W","D","L"...] newest-first
  let oppMap  = new Map();     // team -> [{oppKey,res}] newest-first

  // ===== Parse Résultats (from page) -> list of match objects =====
  function parseResultsMatchesFromPage() {
    const nodes = [...document.querySelectorAll("div,li,tr")].filter(n => n.offsetParent !== null);
    const seen = new Set();
    const out = [];

    for (const n of nodes) {
      const t = textOf(n);
      if (!t) continue;

      const sm = t.match(/(\d+)\s*-\s*(\d+)/);
      if (!sm) continue;

      const parts = t.split(sm[0]).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) continue;

      const home = parts[0].replace(/[^\p{L}\p{N}\s.'-]/gu, "").trim();
      const away = parts[1].replace(/[^\p{L}\p{N}\s.'-]/gu, "").trim();
      if (!home || !away) continue;
      if (home.length > 28 || away.length > 28) continue;

      const hs = parseInt(sm[1], 10);
      const as = parseInt(sm[2], 10);

      const id = `${norm(home)}_${hs}-${as}_${norm(away)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      out.push({ id, h: norm(home), a: norm(away), hs, as, ts: Date.now() });
    }
    return out; // newest-first-ish depends on page order
  }

  function buildTeamFormsFromCacheMatches(matches) {
    const localForm = new Map();
    const localOpp  = new Map();

    // sort newest-first by ts
    const sorted = [...matches].sort((x,y)=> (y.ts||0) - (x.ts||0));

    for (const m of sorted) {
      const homeRes = m.hs > m.as ? "W" : (m.hs < m.as ? "L" : "D");
      const awayRes = m.hs < m.as ? "W" : (m.hs > m.as ? "L" : "D");

      if (!localForm.has(m.h)) localForm.set(m.h, []);
      if (!localForm.has(m.a)) localForm.set(m.a, []);
      if (!localOpp.has(m.h))  localOpp.set(m.h, []);
      if (!localOpp.has(m.a))  localOpp.set(m.a, []);

      // push newest-first, but prevent infinite size
      if (localForm.get(m.h).length < 12) {
        localForm.get(m.h).push(homeRes);
        localOpp.get(m.h).push({ oppKey: m.a, res: homeRes });
      }
      if (localForm.get(m.a).length < 12) {
        localForm.get(m.a).push(awayRes);
        localOpp.get(m.a).push({ oppKey: m.h, res: awayRes });
      }
    }

    return { form: localForm, opp: localOpp };
  }

  // ===== Parse Classement =====
  function parseClassementFromPage() {
    const map = new Map();
    const nodes = [...document.querySelectorAll("tr,li,div")].filter(n => n.offsetParent !== null);
    let rowsFound = 0;

    for (const n of nodes) {
      const t = textOf(n);
      if (!t) continue;
      const m = t.match(/^\s*(\d{1,2})\b/);
      if (!m) continue;

      const rank = parseInt(m[1], 10);
      if (!(rank >= 1 && rank <= 30)) continue;

      const rest = t.replace(/^\s*\d{1,2}\b/, "").trim();
      if (!rest) continue;

      const team = rest.split(/\b\d+\b/)[0].trim();
      if (!team || team.length > 28) continue;

      map.set(norm(team), rank);
      rowsFound++;
    }
    return { map, rowsFound };
  }

  // ===== Match cards detection =====
  const oddsRe = /\b\d{1,2}[.,]\d{2}\b/g;

  function splitCamelConcat(s) {
    const str = String(s).trim();
    if (str.length < 6) return [str];
    const idx = str.search(/[a-zà-ÿ][A-ZÀ-Ý]/);
    if (idx === -1) return [str];
    const a = str.slice(0, idx+1).trim();
    const b = str.slice(idx+1).trim();
    return (a && b) ? [a, b] : [str];
  }

  function extractTeamsFromOddsCard(block) {
    const t = textOf(block);
    const oddsTxt = (t.match(oddsRe) || []);
    if (oddsTxt.length < 3) return null;

    const raw = [...block.querySelectorAll("*")]
      .filter(e => e.offsetParent !== null)
      .map(e => textOf(e))
      .map(s => s.replace(/\s+/g," ").trim())
      .filter(s => s && s.length <= 32 && /[A-Za-zÀ-ÿ]/.test(s) && !oddsRe.test(s));

    const names = [];
    const seen = new Set();
    for (const s of raw) {
      for (const part of splitCamelConcat(s)) {
        const k = norm(part);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        names.push(part);
        if (names.length >= 2) break;
      }
      if (names.length >= 2) break;
    }
    if (names.length < 2) return null;
    return { home: names[0], away: names[1] };
  }

  function findVisibleMatchCards(limit = 14) {
    const nodes = [...document.querySelectorAll("div,li,tr")].filter(n => n.offsetParent !== null);
    const out = [];
    for (const n of nodes) {
      const t = textOf(n);
      if (!t) continue;
      const odds = t.match(oddsRe);
      if (!odds || odds.length < 3) continue;
      if (t.length > 420) continue;
      out.push(n);
      if (out.length >= limit) break;
    }
    // dedupe
    const uniq = [];
    const seen = new Set();
    for (const n of out) {
      const key = textOf(n).slice(0,180);
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(n);
    }
    return uniq;
  }

  function ensurePill(block) {
    let pill = block.querySelector(".pill");
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "pill wait";
      pill.textContent = "PRED: …";
      block.appendChild(pill);
    }
    return pill;
  }
  function setPill(pill, txt, cls) {
    pill.classList.remove("ok","mid","bad","wait");
    pill.classList.add(cls);
    pill.textContent = txt;
  }

  // ===== Decision: Form3 + bonus vs top =====
  function seqString(arr3){
    return arr3.map(r => r==="W" ? "✓" : (r==="D" ? "=" : "×")).join("");
  }
  function seqScore(arr3){
    return arr3.reduce((acc,r)=> acc + (r==="W"?1:(r==="D"?0.5:0)), 0); // 0..3
  }

  function opponentBonus(teamKey){
    const list = oppMap.get(teamKey);
    if (!list || list.length < NEED_RESULTS) return 0;

    const last3 = list.slice(0, NEED_RESULTS);
    let bonus = 0;
    for (const it of last3) {
      const oppRank = rankMap.get(it.oppKey);
      if (!Number.isFinite(oppRank)) continue;
      const isTop = oppRank <= TOP_N;
      if (it.res === "W" && isTop) bonus += BONUS_WIN_TOP;
      if (it.res === "D" && isTop) bonus += BONUS_DRAW_TOP;
    }
    return bonus;
  }

  function decide(home, away) {
    const hKey = norm(home), aKey = norm(away);
    const hr = rankMap.get(hKey);
    const ar = rankMap.get(aKey);
    const hArr = formMap.get(hKey);
    const aArr = formMap.get(aKey);

    if (!hArr || !aArr || hArr.length < NEED_RESULTS || aArr.length < NEED_RESULTS || !Number.isFinite(hr) || !Number.isFinite(ar)) {
      return { pick:"—", cls:"wait", why:`need3 • rank(${hr ?? "?"}/${ar ?? "?"}) • form(${hArr? hArr.length:0}/${aArr? aArr.length:0})` };
    }

    const h3 = hArr.slice(0, NEED_RESULTS);
    const a3 = aArr.slice(0, NEED_RESULTS);

    const hS = seqScore(h3);
    const aS = seqScore(a3);

    const hB = opponentBonus(hKey);
    const aB = opponentBonus(aKey);

    const rankEdge = (ar - hr) / 10; // scale

    const totalH = hS + hB + rankEdge;
    const totalA = aS + aB - rankEdge;

    const diff = totalH - totalA;

    if (Math.abs(diff) <= DRAW_BAND) {
      return { pick:"X", cls:"mid", why:`form ${seqString(h3)} vs ${seqString(a3)} • rank ${hr}/${ar} • bonus ${hB.toFixed(2)}/${aB.toFixed(2)}` };
    }
    if (diff >= PICK_EDGE) {
      return { pick:"1", cls:"ok", why:`form ${seqString(h3)}>${seqString(a3)} • rank ${hr}/${ar} • bonus ${hB.toFixed(2)}/${aB.toFixed(2)}` };
    }
    if (diff <= -PICK_EDGE) {
      return { pick:"2", cls:"ok", why:`form ${seqString(h3)}<${seqString(a3)} • rank ${hr}/${ar} • bonus ${hB.toFixed(2)}/${aB.toFixed(2)}` };
    }
    return { pick:"X", cls:"bad", why:`weak • form ${seqString(h3)} vs ${seqString(a3)} • rank ${hr}/${ar}` };
  }

  // ===== Refresh Data: page -> cache -> rebuild forms =====
  async function refreshData() {
    const hasRes = !!findTab(/résultats/i);
    const hasCla = !!findTab(/classement/i);

    if (!hasRes || !hasCla) {
      statusEl.textContent = "❌ Tsy eo amin’ny écran misy 'Résultats | Matches | Classement' ianao.";
      return;
    }

    const cache = loadCache();

    // Résultats
    statusEl.textContent = "Refreshing: Résultats (auto-scroll) → cache…";
    clickTab(/résultats/i);
    await wait(650);
    await autoScrollLoad(5);
    const pageMatches = parseResultsMatchesFromPage();

    // merge into cache
    const byId = new Map(cache.matches.map(m => [m.id, m]));
    for (const m of pageMatches) byId.set(m.id, m);
    cache.matches = [...byId.values()].sort((x,y)=> (y.ts||0)-(x.ts||0)).slice(0, KEEP_MATCHES);

    // Classement
    statusEl.textContent = "Refreshing: Classement (auto-scroll) → cache…";
    clickTab(/classement/i);
    await wait(650);
    await autoScrollLoad(5);
    const cla = parseClassementFromPage();
    const rankObj = {};
    for (const [k,v] of cla.map.entries()) rankObj[k] = v;
    cache.rank = rankObj;

    saveCache(cache);

    // rebuild runtime maps from cache
    rankMap = new Map(Object.entries(cache.rank || {}).map(([k,v]) => [k, v]));
    const built = buildTeamFormsFromCacheMatches(cache.matches || []);
    formMap = built.form;
    oppMap  = built.opp;

    lastDataRefresh = Date.now();

    const ok = (cache.matches.length >= 20 && rankMap.size >= 10);
    statusEl.textContent = ok
      ? `✅ TOUR MEMORY READY • cacheMatches=${cache.matches.length}`
      : `⚠️ DATA WEAK • scroll bebe kokoa ao Résultats/Classement`;

    debugEl.textContent = `debug: cacheMatches=${cache.matches.length} • formTeams=${formMap.size} • rankTeams=${rankMap.size}`;
  }

  function annotateMatches() {
    const cards = findVisibleMatchCards(14);
    const rows = [];

    for (const c of cards) {
      const m = extractTeamsFromOddsCard(c);
      if (!m) continue;

      const dec = decide(m.home, m.away);
      const pill = ensurePill(c);

      if (dec.cls === "wait") setPill(pill, `PRED: —`, "wait");
      else setPill(pill, `PRED: ${dec.pick}`, dec.cls);

      rows.push({ match:`${m.home} vs ${m.away}`, pick:dec.pick, why:dec.why, cls:dec.cls });
    }

    tbodyEl.innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td><b>${esc(r.match)}</b></td>
        <td><span class="${r.cls}">${esc(r.pick)}</span></td>
        <td class="muted">${esc(r.why)}</td>
      </tr>
    `).join("") : `<tr><td colspan="3" class="muted">Scroll kely amin’ny liste 1X2 mba hiseho match cards.</td></tr>`;
  }

  // ===== Buttons =====
  btnEl.addEventListener("click", refreshData);
  clearEl.addEventListener("click", () => {
    clearCache();
    statusEl.textContent = "Cache cleared ✅ (tour memory reset).";
    debugEl.textContent = "debug: cacheMatches=0 • formTeams=0 • rankTeams=0";
    formMap = new Map(); oppMap = new Map(); rankMap = new Map();
  });

  // ===== Boot =====
  refreshData();
  setInterval(annotateMatches, PREDICT_EVERY_MS);
  setInterval(refreshData, DATA_REFRESH_MS);

})();
