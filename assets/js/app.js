if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

// BET261 Preductor — v2 (VALUE ENGINE)
// - 1X2 odds -> de-vig probabilities
// - Estimate lambdas (λH, λA) from 1X2
// - Poisson score matrix (0..6) -> markets
// - VALUE Engine: EV = p*odd - 1 for Over2.5 / Under2.5 / BTTS if odds provided

const $ = (id) => document.getElementById(id);

function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function round(x, d=2){ const p = Math.pow(10,d); return Math.round(x*p)/p; }

function validateOdds(o){
  return Number.isFinite(o) && o >= 1.01;
}

// De-vig from 1X2 odds (normalize implied probabilities)
function probsFromOdds(odd1, oddX, odd2){
  const p1i = 1/odd1, pXi = 1/oddX, p2i = 1/odd2;
  const s = p1i + pXi + p2i;
  return { p1: p1i/s, pX: pXi/s, p2: p2i/s, overround: s };
}

// Map 1X2 probabilities to expected goals (λH, λA) — heuristic quick model
function lambdasFrom1X2(p1, pX, p2){
  // Total goals: higher draw prob => tighter match => lower totals
  const total = clamp(3.10 - 1.6*pX, 2.1, 3.2);

  // Advantage: map (p1 - p2) -> expected goal diff
  const diff = clamp(2.10*(p1 - p2), -0.9, 0.9);

  let lH = (total + diff)/2;
  let lA = (total - diff)/2;

  // bounds
  lH = clamp(lH, 0.35, 2.60);
  lA = clamp(lA, 0.35, 2.60);

  return { lH, lA, total, diff };
}

function factorial(n){
  let r = 1;
  for(let k=2;k<=n;k++) r*=k;
  return r;
}

function pois(k, lambda){
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

// Build score matrix P(i,j), i,j=0..maxG and renormalize tail
function scoreMatrix(lH, lA, maxG=6){
  const ph = [];
  const pa = [];
  for(let i=0;i<=maxG;i++){
    ph.push(pois(i, lH));
    pa.push(pois(i, lA));
  }

  const P = [];
  let mass = 0;
  for(let i=0;i<=maxG;i++){
    P[i] = [];
    for(let j=0;j<=maxG;j++){
      const pij = ph[i]*pa[j];
      P[i][j] = pij;
      mass += pij;
    }
  }

  // Renormalize within 0..maxG grid
  for(let i=0;i<=maxG;i++){
    for(let j=0;j<=maxG;j++){
      P[i][j] /= mass;
    }
  }
  return P;
}

function marketsFromMatrix(P){
  const maxG = P.length - 1;

  let p1=0, pX=0, p2=0;
  let pGG=0;
  const over = {}; // thresholds 0.5..5.5
  const clean = { homeCS:0, awayCS:0, homeWinToNil:0, awayWinToNil:0 };
  const correctScores = [];

  for(let i=0;i<=maxG;i++){
    for(let j=0;j<=maxG;j++){
      const pij = P[i][j];

      if(i>j) p1 += pij;
      else if(i===j) pX += pij;
      else p2 += pij;

      if(i>=1 && j>=1) pGG += pij;

      if(j===0) clean.homeCS += pij;
      if(i===0) clean.awayCS += pij;
      if(i>j && j===0) clean.homeWinToNil += pij;
      if(j>i && i===0) clean.awayWinToNil += pij;

      correctScores.push({ score: `${i}-${j}`, p: pij });
    }
  }

  for(let t=0.5; t<=5.5; t+=1){
    let pOver=0;
    for(let i=0;i<=maxG;i++){
      for(let j=0;j<=maxG;j++){
        if(i+j > t) pOver += P[i][j];
      }
    }
    over[`${t.toFixed(1)}`] = pOver;
  }

  correctScores.sort((a,b)=>b.p-a.p);

  return {
    oneXtwo: { p1, pX, p2 },
    doubleChance: { p1X: p1+pX, p12: p1+p2, pX2: pX+p2 },
    btts: { pGG, pNG: 1-pGG },
    over,
    clean,
    correctScores
  };
}

// Decision thresholds
function thresholds(riskMode){
  if(riskMode === "safe") return { minEdge: 0.06, minProb: 0.52 };
  if(riskMode === "aggressive") return { minEdge: 0.02, minProb: 0.45 };
  return { minEdge: 0.04, minProb: 0.48 }; // standard
}

function badgeFromDecision(dec){
  if(dec === "BET") return `<span class="badge ok">BET</span>`;
  if(dec === "NO BET") return `<span class="badge no">NO BET</span>`;
  return `<span class="badge warn">WATCH</span>`;
}

function decision(p, marketOdd, mode){
  const { minEdge, minProb } = thresholds(mode);
  const pMarket = 1/marketOdd;
  const edge = p - pMarket;

  if(p >= minProb && edge >= minEdge) return "BET";
  if(p >= (minProb - 0.05) && edge >= (minEdge - 0.02)) return "WATCH";
  return "NO BET";
}

function pct(x){ return `${round(100*x,1)}%`; }
function fairOdd(p){ return round(1/p, 2); }

// VALUE ENGINE
function valueLine(label, p, odd){
  if(!validateOdds(odd)) return "";
  const ev = p * odd - 1;
  const edgePct = (p - (1/odd)) * 100;
  const status = ev > 0 ? "VALUE" : "NO VALUE";
  const cls = ev > 0 ? "ok" : "no";
  return `
    <div class="row">
      <div><b>${label}</b> — P: ${pct(p)} | Odd: ${round(odd,2)} | EV: ${round(ev,3)} | Edge: ${round(edgePct,1)}%</div>
      <span class="badge ${cls}">${status}</span>
    </div>
  `;
}

function renderOutput(ctx){
  const { home, away, odd1, oddX, odd2, riskMode } = ctx;

  const oddOver25  = Number($("oddOver25").value);
  const oddUnder25 = Number($("oddUnder25").value);
  const oddBTTS    = Number($("oddBTTS").value);

  const { p1, pX, p2, overround } = probsFromOdds(odd1, oddX, odd2);
  const lam = lambdasFrom1X2(p1, pX, p2);
  const P = scoreMatrix(lam.lH, lam.lA, 6);
  const mk = marketsFromMatrix(P);

  const d1 = decision(mk.oneXtwo.p1, odd1, riskMode);
  const dX = decision(mk.oneXtwo.pX, oddX, riskMode);
  const d2 = decision(mk.oneXtwo.p2, odd2, riskMode);

  const overall = (d1==="NO BET" && dX==="NO BET" && d2==="NO BET") ? "NO BET" : "WATCH/BET";
  const topScores = mk.correctScores.slice(0, 8);

  // VALUE section (only shows lines if odds filled)
  let valueSection = "";
  valueSection += valueLine("Over 2.5", mk.over["2.5"], oddOver25);
  valueSection += valueLine("Under 2.5", 1 - mk.over["2.5"], oddUnder25);
  valueSection += valueLine("BTTS (GG)", mk.btts.pGG, oddBTTS);

  if(valueSection.trim() === ""){
    valueSection = `<div class="small">Ampidiro ny odds (Over 2.5 / Under 2.5 / BTTS) raha tianao hivoaka VALUE.</div>`;
  }

  const html = `
    <div class="kpi">
      <div class="pill"><b>${home}</b> vs <b>${away}</b></div>
      <div class="pill">Overround: <b>${round(overround,3)}</b> (dé-vig)</div>
      <div class="pill">λ Home: <b>${round(lam.lH,2)}</b></div>
      <div class="pill">λ Away: <b>${round(lam.lA,2)}</b></div>
      <div class="pill">Mode: <b>${riskMode.toUpperCase()}</b></div>
      <div class="pill">Global: <b>${overall}</b></div>
    </div>

    <div class="row"><div><b>1 (Domicile)</b> — ${pct(mk.oneXtwo.p1)} <span class="small">(fair odd ~ ${fairOdd(mk.oneXtwo.p1)})</span></div>${badgeFromDecision(d1)}</div>
    <div class="row"><div><b>X (Nul)</b> — ${pct(mk.oneXtwo.pX)} <span class="small">(fair odd ~ ${fairOdd(mk.oneXtwo.pX)})</span></div>${badgeFromDecision(dX)}</div>
    <div class="row"><div><b>2 (Extérieur)</b> — ${pct(mk.oneXtwo.p2)} <span class="small">(fair odd ~ ${fairOdd(mk.oneXtwo.p2)})</span></div>${badgeFromDecision(d2)}</div>

    <div class="divider"></div>

    <div class="row"><div><b>Double chance 1X</b> — ${pct(mk.doubleChance.p1X)}</div><span class="badge">INFO</span></div>
    <div class="row"><div><b>Double chance 12</b> — ${pct(mk.doubleChance.p12)}</div><span class="badge">INFO</span></div>
    <div class="row"><div><b>Double chance X2</b> — ${pct(mk.doubleChance.pX2)}</div><span class="badge">INFO</span></div>

    <div class="divider"></div>

    <div class="row"><div><b>GG (BTTS Oui)</b> — ${pct(mk.btts.pGG)} <span class="small">(fair odd ~ ${fairOdd(mk.btts.pGG)})</span></div><span class="badge">INFO</span></div>
    <div class="row"><div><b>NG (BTTS Non)</b> — ${pct(mk.btts.pNG)} <span class="small">(fair odd ~ ${fairOdd(mk.btts.pNG)})</span></div><span class="badge">INFO</span></div>

    <div class="divider"></div>

    <table>
      <thead><tr><th>Over/Under</th><th>Over</th><th>Under</th></tr></thead>
      <tbody>
        ${["0.5","1.5","2.5","3.5","4.5","5.5"].map(t=>{
          const pOver = mk.over[t];
          const pUnder = 1 - pOver;
          return `<tr><td><b>${t}</b></td><td>${pct(pOver)} <span class="small">(odd~${fairOdd(pOver)})</span></td><td>${pct(pUnder)} <span class="small">(odd~${fairOdd(pUnder)})</span></td></tr>`;
        }).join("")}
      </tbody>
    </table>

    <div class="divider"></div>

    <div class="row"><div><b>Clean sheet Home</b> — ${pct(mk.clean.homeCS)}</div><span class="badge">INFO</span></div>
    <div class="row"><div><b>Clean sheet Away</b> — ${pct(mk.clean.awayCS)}</div><span class="badge">INFO</span></div>
    <div class="row"><div><b>Home win to nil</b> — ${pct(mk.clean.homeWinToNil)}</div><span class="badge">INFO</span></div>
    <div class="row"><div><b>Away win to nil</b> — ${pct(mk.clean.awayWinToNil)}</div><span class="badge">INFO</span></div>

    <div class="divider"></div>

    <div><b>VALUE ENGINE</b> <span class="small">(EV = p×odd − 1)</span></div>
    ${valueSection}

    <div class="divider"></div>

    <div><b>Top scores exacts</b> <span class="small">(Top 8)</span></div>
    <table>
      <thead><tr><th>Score</th><th>Probabilité</th><th>Odd “fair”</th></tr></thead>
      <tbody>
        ${topScores.map(s=>`<tr><td><b>${s.score}</b></td><td>${pct(s.p)}</td><td>${fairOdd(s.p)}</td></tr>`).join("")}
      </tbody>
    </table>

    <div class="hint">
      Mode Quick: λ estimé avy amin’ny odds 1X2.  
      Raha te-hahery kokoa: Mode PRO = calibration amin’ny historique (dataset).
    </div>
  `;

  $("output").classList.remove("empty");
  $("output").innerHTML = html;
}

function resetUI(){
  $("homeTeam").value = "Home FC";
  $("awayTeam").value = "Away FC";
  $("odd1").value = "2.10";
  $("oddX").value = "3.20";
  $("odd2").value = "3.60";
  $("oddOver25").value = "";
  $("oddBTTS").value = "";
  $("oddUnder25").value = "";
  $("riskMode").value = "standard";
  $("bankroll").value = "10000";
  $("output").classList.add("empty");
  $("output").innerHTML = "Clique sur <b>Predict</b>…";
}

$("btnPredict").addEventListener("click", () => {
  const home = $("homeTeam").value.trim() || "Home";
  const away = $("awayTeam").value.trim() || "Away";

  const odd1 = Number($("odd1").value);
  const oddX = Number($("oddX").value);
  const odd2 = Number($("odd2").value);

  const riskMode = $("riskMode").value;

  if(!validateOdds(odd1) || !validateOdds(oddX) || !validateOdds(odd2)){
    $("output").classList.remove("empty");
    $("output").innerHTML = `<span class="badge no">ERREUR</span> Odds 1X2 invalides. Mets des valeurs ≥ 1.01`;
    return;
  }

  renderOutput({ home, away, odd1, oddX, odd2, riskMode });
});

$("btnReset").addEventListener("click", resetUI);
