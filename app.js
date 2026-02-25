/* Cyber Arena — hardened build (robust correctness + null-safe picker + patched Team mode) */
(() => {
  // ===== PWA =====
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // ===== Storage Keys =====
  const K = {
    profile: "ca_profile_v1",
    stats: "ca_stats_v1",
    soloHistory: "ca_solo_history_v1",
    teamStats: "ca_team_stats_v1",
    vault: "ca_vault_v1",
    seen: "ca_seen_v1",
    theme: "ca_theme_v1"
  };

  const $ = (id) => document.getElementById(id);
  const screens = {
    home: $("screenHome"),
    solo: $("screenSolo"),
    team: $("screenTeam"),
    quizbowl: $("screenQuizbowl"),
    stats: $("screenStats"),
    theme: $("screenTheme"),
  };

  // ===== Utilities =====
  function save(key, obj) { localStorage.setItem(key, JSON.stringify(obj)); }
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function now(){ return performance.now(); }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i=a.length-1; i>0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function escapeHtml(str){
    return (str||"").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }

  function fmtMs(ms){
    if (ms == null) return "—";
    return `${Math.round(ms)}ms`;
  }

  function avg(a){
    if (!a || !a.length) return null;
    return a.reduce((s,x)=>s+x,0)/a.length;
  }

  // ===== Theme =====
  const themeState = load(K.theme, { accent: "cyan", clean: false, intensity: "cinematic" });

  function setAccent(a) {
    themeState.accent = a;
    const map = {
      cyan: ["#35d0ff", "rgba(53,208,255,.18)"],
      purple: ["#a56bff", "rgba(165,107,255,.18)"],
      green: ["#3dff9b", "rgba(61,255,155,.16)"],
      red: ["#ff3b4f", "rgba(255,59,79,.14)"],
      gold: ["#ffd166", "rgba(255,209,102,.16)"],
      soft: ["#8bd3ff", "rgba(139,211,255,.16)"]
    };
    const [acc, acc2] = map[a] || map.cyan;
    document.documentElement.style.setProperty("--accent", acc);
    document.documentElement.style.setProperty("--accent2", acc2);
    save(K.theme, themeState);
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-clean", themeState.clean ? "true" : "false");
    document.body.setAttribute("data-intensity", themeState.intensity);
    setAccent(themeState.accent);
    $("btnModeToggle").textContent = themeState.clean ? "Clean" : "Dark Pro";
  }

  // ===== Profile / Stats =====
  const profile = load(K.profile, { username: "", accent: "cyan", intensity: "cinematic" });
  const stats = load(K.stats, {
    bestSoloScore: 0,
    bestSoloAcc: 0,
    bestSoloRT: null,
    totalRuns: 0,
    totalQuestions: 0,
    totalCorrect: 0,
    qbBest: 0,
    teamBest: 0
  });

  function saveProfileUI() {
    profile.username = $("username").value.trim().slice(0,24);
    profile.accent = $("accent").value;
    profile.intensity = $("intensity").value;
    save(K.profile, profile);

    themeState.accent = profile.accent;
    themeState.intensity = profile.intensity;
    save(K.theme, themeState);
    applyTheme();

    $("homeStatus").textContent = "Saved locally on this device.";
  }

  // ===== Question Bank =====
  let BANK = [];
  let BANK_TITLE = "Quizbowl 2026";
  let seenPool = load(K.seen, { ids: [], ts: Date.now() }); // anti-repeat window

  function estimateDifficulty(q, choices) {
    const s = (q + " " + choices.join(" ")).toLowerCase();
    const tokens = [
      "hypervisor","virtualization","uefi","rs-232","db-9","smb","vlan","wpa3","cipher",
      "certificate","hash","sha","rsa","aes","kerberos","ntfs","powershell","ldap","dns","dhcp"
    ];
    let score = 0;
    tokens.forEach(t => { if (s.includes(t)) score += 1; });
    if (q.length > 120) score += 1;
    if (choices.some(c => c.length > 40)) score += 1;
    if (score >= 4) return "HARD";
    if (score >= 2) return "MED";
    return "EASY";
  }

  function inferCategory(q, choices) {
    const s = (q + " " + choices.join(" ")).toLowerCase();
    if (s.includes("cloud") || s.includes("virtual") || s.includes("hypervisor") || s.includes("vm")) return "Cloud/Virtualization";
    if (s.includes("bios") || s.includes("uefi") || s.includes("firmware") || s.includes("motherboard") || s.includes("cpu") || s.includes("ram")) return "Hardware";
    if (s.includes("windows") || s.includes("linux") || s.includes("mac") || s.includes("ntfs") || s.includes("cmd") || s.includes("powershell")) return "OS/Tools";
    if (s.includes("port") || s.includes("tcp") || s.includes("udp") || s.includes("dns") || s.includes("dhcp") || s.includes("ip") || s.includes("ethernet")) return "Networking";
    if (s.includes("encryption") || s.includes("hash") || s.includes("sha") || s.includes("rsa") || s.includes("aes") || s.includes("certificate")) return "Crypto/Auth";
    if (s.includes("malware") || s.includes("phishing") || s.includes("ransom") || s.includes("ddos") || s.includes("attack")) return "Security";
    return "General IT";
  }

  function normalizeCorrectKey(correctKeyRaw) {
    const k = (correctKeyRaw || "").toString().trim().toUpperCase();
    return (k === "A" || k === "B" || k === "C" || k === "D") ? k : "";
  }

  function normalizeBank(raw) {
    // Accepts your cleaned Gimkit export:
    // { title, questions:[{n,question,A,B,C,D,correct_choice,correct_text}] }
    const qs = raw?.questions || [];
    const out = [];

    for (let idx=0; idx<qs.length; idx++){
      const q = qs[idx];
      if (!q) continue;

      const question = (q.question || q.text || "").toString().trim();
      if (!question) continue;

      const choices = [
        { key:"A", text: (q.A ?? q.answers?.[0]?.text ?? "").toString().trim() },
        { key:"B", text: (q.B ?? q.answers?.[1]?.text ?? "").toString().trim() },
        { key:"C", text: (q.C ?? q.answers?.[2]?.text ?? "").toString().trim() },
        { key:"D", text: (q.D ?? q.answers?.[3]?.text ?? "").toString().trim() }
      ].filter(c => c.text.length > 0);

      // Must have at least 2 choices
      if (choices.length < 2) continue;

      // Determine correctKey robustly
      let correctKey = normalizeCorrectKey(q.correct_choice);

      if (!correctKey && q.correct_text) {
        const ct = q.correct_text.toString().trim().toLowerCase();
        const matchExact = choices.find(c => c.text.toLowerCase() === ct);
        const matchContains = choices.find(c => c.text.toLowerCase().includes(ct));
        correctKey = normalizeCorrectKey(matchExact?.key || matchContains?.key || "");
      }

      // If still missing, skip the question (prevents “everything wrong” failure)
      if (!correctKey) continue;

      const id = "Q" + (q.n || (idx+1));
      const difficulty = estimateDifficulty(question, choices.map(c=>c.text));
      const category = inferCategory(question, choices.map(c=>c.text));

      out.push({
        id,
        question,
        choices,
        correctKey,
        correctText: (q.correct_text || "").toString(),
        difficulty,
        category
      });
    }

    return out;
  }

  async function loadBank() {
    try {
      const res = await fetch("./question-bank.json", { cache: "no-store" });
      const raw = await res.json();
      BANK_TITLE = raw.title || "Quizbowl 2026";
      BANK = normalizeBank(raw);

      if (!BANK.length) {
        $("bankStatus").textContent = `Loaded file but 0 usable questions (missing correct keys / malformed).`;
      } else {
        $("bankStatus").textContent = `${BANK_TITLE} loaded: ${BANK.length} questions`;
      }
    } catch {
      $("bankStatus").textContent = `Bank not found. Put question-bank.json in the same folder.`;
      BANK = [];
    }
  }

  // Anti-repeat window
  function updateSeen(id, windowN=70){
    seenPool.ids.push(id);
    if (seenPool.ids.length > windowN) seenPool.ids = seenPool.ids.slice(-windowN);
    seenPool.ts = Date.now();
    save(K.seen, seenPool);
  }

  function pickQuestion({ preferHard=false, weakCats=[], avoidIds=[] } = {}) {
    // Null-safe always returns a question if BANK has any items
    if (!BANK.length) return null;

    const avoid = new Set([...avoidIds, ...seenPool.ids]);
    let pool = BANK.filter(q => !avoid.has(q.id));
    if (pool.length < 10) pool = BANK.filter(q => !avoidIds.includes(q.id));
    if (!pool.length) pool = BANK.slice(); // hard fallback

    const weighted = [];
    for (const q of pool) {
      let w = 1;
      if (weakCats.includes(q.category)) w += 2;
      if (preferHard && q.difficulty === "HARD") w += 2;
      if (q.difficulty === "MED") w += 0.5;
      weighted.push({ q, w });
    }

    const total = weighted.reduce((s,x)=>s+x.w,0);
    let r = Math.random()*total;
    for (const x of weighted) {
      r -= x.w;
      if (r <= 0) return x.q;
    }
    return weighted[weighted.length-1].q;
  }

  function renderChoices(container, q, onPick){
    // Perfect correctness: shuffle keeps original A/B/C/D keys.
    container.innerHTML = "";

    // Shuffle choice objects while keeping .key
    const shuffled = shuffle(q.choices);

    // Equalize display a bit (anti “longest answer” cue)
    const maxLen = Math.max(...shuffled.map(s=>s.text.length), 1);
    const display = shuffled.map(s => ({
      ...s,
      pad: s.text + " ".repeat(Math.max(0, Math.min(12, Math.floor((maxLen - s.text.length)/8))))
    }));

    display.forEach(s => {
      const btn = document.createElement("button");
      btn.className = "choice";
      // letter shown is still A/B/C/D for familiarity, but correctness is key-based
      btn.innerHTML = `<span class="letter">${s.key}</span><span class="txt">${escapeHtml(s.pad)}</span>`;
      btn.addEventListener("click", () => onPick({ key: s.key, text: s.text, isCorrect: (s.key === q.correctKey) }));
      container.appendChild(btn);
    });
  }

  function computeWeakCats(misses){
    const counts = {};
    for (const m of misses) counts[m.category] = (counts[m.category]||0)+1;
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]);
  }

  function rankFromScore(score, acc){
    if (acc < 0.65) return "Trainee";
    if (score < 15) return "Analyst";
    if (score < 30) return "Defender";
    if (score < 45) return "Strategist";
    if (score < 60) return "Architect";
    if (score < 80) return "Sentinel";
    return "Root Authority";
  }

  // ===== Navigation =====
  function show(name) {
    Object.values(screens).forEach(el => el.classList.add("hidden"));
    screens[name].classList.remove("hidden");
  }

  document.querySelectorAll("[data-back]").forEach(btn => {
    btn.addEventListener("click", () => show("home"));
  });

  document.querySelectorAll(".panel").forEach(p => {
    p.addEventListener("click", () => {
      const to = p.getAttribute("data-nav");
      if (to === "solo") show("solo");
      if (to === "team") show("team");
      if (to === "quizbowl") show("quizbowl");
    });
  });

  // ===== Vault =====
  function addToVault(id){
    const v = load(K.vault, { items: [] });
    const found = v.items.find(x => x.id === id);
    if (found) found.failCount = (found.failCount||0)+1;
    else v.items.push({ id, failCount: 1, ts: Date.now() });
    save(K.vault, v);
  }

  // ===== Cold Open =====
  const cold = { q: null, timer: null, timeLeft: 5, answered: false };

  function startColdOpen(){
    if (!BANK.length) return;
    $("coldOpen").classList.remove("hidden");
    $("btnColdContinue").disabled = true;
    $("coldFeedback").textContent = "";
    cold.answered = false;
    cold.timeLeft = 5;

    cold.q = pickQuestion({ preferHard:true });
    $("coldQuestion").textContent = cold.q.question;
    $("coldTag").textContent = cold.q.difficulty;

    renderChoices($("coldChoices"), cold.q, (pick) => {
      if (cold.answered) return;
      cold.answered = true;
      stopColdTimer();
      $("coldFeedback").textContent = pick.isCorrect ? "Correct. Good." : "Wrong. Remember it.";
      $("btnColdContinue").disabled = false;
      updateSeen(cold.q.id);
    });

    startColdTimer();
  }

  function startColdTimer(){
    $("coldTimer").textContent = `${cold.timeLeft}s`;
    cold.timer = setInterval(() => {
      cold.timeLeft--;
      $("coldTimer").textContent = `${cold.timeLeft}s`;
      if (cold.timeLeft <= 0){
        stopColdTimer();
        if (!cold.answered){
          cold.answered = true;
          $("coldFeedback").textContent = "Time. No warm-up.";
          $("btnColdContinue").disabled = false;
          updateSeen(cold.q.id);
        }
      }
    }, 1000);
  }

  function stopColdTimer(){
    if (cold.timer) clearInterval(cold.timer);
    cold.timer = null;
  }

  $("btnColdSkip").addEventListener("click", () => {
    stopColdTimer();
    $("coldOpen").classList.add("hidden");
  });
  $("btnColdContinue").addEventListener("click", () => {
    $("coldOpen").classList.add("hidden");
  });

  // ===== Home Wiring =====
  $("btnSaveProfile").addEventListener("click", saveProfileUI);
  $("btnViewStats").addEventListener("click", () => {
    renderStats();
    $("screenStats").classList.remove("hidden");
  });
  $("btnCloseStats").addEventListener("click", () => $("screenStats").classList.add("hidden"));

  // Theme modal
  $("btnTheme").addEventListener("click", () => $("screenTheme").classList.remove("hidden"));
  $("btnCloseTheme").addEventListener("click", () => $("screenTheme").classList.add("hidden"));
  $("btnModeToggle").addEventListener("click", () => {
    themeState.clean = !themeState.clean;
    save(K.theme, themeState);
    applyTheme();
  });
  $("btnToggleClean").addEventListener("click", () => {
    themeState.clean = !themeState.clean;
    save(K.theme, themeState);
    applyTheme();
    $("themeNote").textContent = themeState.clean ? "Clean mode enabled." : "Dark Pro enabled.";
  });
  $("btnToggleIntensity").addEventListener("click", () => {
    themeState.intensity = (themeState.intensity === "cinematic") ? "minimal" : "cinematic";
    save(K.theme, themeState);
    applyTheme();
    $("themeNote").textContent = `Intensity: ${themeState.intensity}`;
  });

  document.querySelectorAll("[data-accent]").forEach(b => {
    b.addEventListener("click", () => {
      setAccent(b.getAttribute("data-accent"));
      $("themeNote").textContent = `Accent set: ${themeState.accent}`;
    });
  });

  // Reset
  $("btnReset").addEventListener("click", () => {
    if (!confirm("Reset local stats + vault on this device?")) return;
    localStorage.removeItem(K.stats);
    localStorage.removeItem(K.soloHistory);
    localStorage.removeItem(K.teamStats);
    localStorage.removeItem(K.vault);
    localStorage.removeItem(K.seen);
    location.reload();
  });

  // ===== SOLO ENGINE =====
  const solo = {
    active:false,total:0,idx:0,score:0,correct:0,wrong:0,streak:0,
    rts:[],timer:null,timeLeft:0,perQ:5,feedback:"batched",mods:"standard",
    misses:[],weakCats:[],avoidIds:[], current:null, currentStart:0
  };

  $("soloConf").addEventListener("input", () => {
    const v = Number($("soloConf").value);
    $("soloConfLabel").textContent = v === 1 ? "LOW" : (v===2 ? "MED" : "HIGH");
  });

  $("btnStartSolo").addEventListener("click", () => startSolo(false));
  $("btnSoloVault").addEventListener("click", () => startSolo(true));
  $("btnSoloSkip").addEventListener("click", () => submitSolo(null, true));
  $("btnSoloEnd").addEventListener("click", () => endSolo("Ended"));

  function soloConfig(fromVault){
    solo.total = Number($("soloLen").value);
    solo.perQ = Number($("soloTimer").value);
    solo.feedback = $("soloFeedback").value;
    solo.mods = $("soloMods").value;
    if (solo.mods === "hardcore") solo.perQ = 2;

    $("soloHint").textContent = fromVault
      ? "Vault Run: drills your missed questions first."
      : "Adaptive Run: weak categories appear more often.";
  }

  function startSolo(fromVault){
    if (!BANK.length) { alert("Missing/invalid bank. Add question-bank.json."); return; }
    soloConfig(fromVault);

    solo.active = true;
    solo.idx = 0; solo.score = 0; solo.correct = 0; solo.wrong = 0; solo.streak = 0;
    solo.rts = []; solo.misses = []; solo.avoidIds = []; solo.weakCats = [];

    $("soloResults").classList.add("hidden");
    $("soloHUD").classList.remove("hidden");
    $("soloCard").classList.remove("hidden");
    $("soloTotal").textContent = String(solo.total);

    nextSolo(fromVault);
  }

  function startSoloTimer(){
    stopSoloTimer();
    solo.timeLeft = solo.perQ;
    $("soloTime").textContent = `${solo.timeLeft}s`;
    solo.timer = setInterval(() => {
      solo.timeLeft--;
      $("soloTime").textContent = `${solo.timeLeft}s`;
      if (solo.timeLeft <= 0){
        stopSoloTimer();
        submitSolo({ isCorrect:false, key:"", text:"(timeout)" }, false, true);
      }
    }, 1000);
  }
  function stopSoloTimer(){ if (solo.timer) clearInterval(solo.timer); solo.timer=null; }

  function nextSolo(fromVault){
    if (!solo.active) return;
    if (solo.idx >= solo.total) return endSolo("Complete");

    solo.idx++;
    $("soloIdx").textContent = String(solo.idx);

    solo.weakCats = computeWeakCats(solo.misses);

    let q = null;
    const v = load(K.vault, { items: [] });

    if (fromVault && v.items.length){
      const candidates = v.items
        .sort((a,b)=> (b.failCount||0)-(a.failCount||0))
        .map(x => x.id)
        .filter(id => !solo.avoidIds.includes(id));

      const pickId = candidates[0];
      q = BANK.find(x => x.id === pickId) || null;
    }

    if (!q){
      const preferHard = solo.score >= 20 || solo.mods === "hardcore";
      q = pickQuestion({ preferHard, weakCats: solo.weakCats, avoidIds: solo.avoidIds });
    }

    if (!q) return endSolo("No questions available"); // extra safety

    solo.current = q;
    solo.avoidIds.push(q.id);
    updateSeen(q.id);

    $("soloTag").textContent = `${q.difficulty} • ${q.category}`;
    $("soloQuestion").textContent = q.question;

    const blindDelay = (solo.mods === "blind") ? 1200 : 0;
    $("soloChoices").innerHTML = "";
    $("soloFeedbackBox").textContent = "";

    solo.currentStart = now();
    startSoloTimer();

    if (blindDelay > 0){
      setTimeout(() => {
        if (!solo.active || solo.current !== q) return;
        renderChoices($("soloChoices"), q, (pick) => submitSolo(pick, false));
      }, blindDelay);
    } else {
      renderChoices($("soloChoices"), q, (pick) => submitSolo(pick, false));
    }
  }

  function updateSoloHUD(){
    $("soloScore").textContent = String(solo.score);
    const total = solo.correct + solo.wrong;
    const acc = total ? Math.round((solo.correct/total)*100) : 0;
    $("soloAcc").textContent = `${acc}%`;
    $("soloStreak").textContent = String(solo.streak);
    $("soloRT").textContent = fmtMs(avg(solo.rts));
  }

  function submitSolo(pick, isSkip=false, isTimeout=false){
    if (!solo.active) return;
    stopSoloTimer();

    const q = solo.current;
    const rt = now() - solo.currentStart;
    solo.rts.push(rt);

    const conf = Number($("soloConf").value);
    const confMult = (conf === 1 ? {ok:0, bad:-0} : conf===2 ? {ok:1, bad:-1} : {ok:2, bad:-2});

    let ok = false;
    if (!isSkip) ok = !!pick?.isCorrect;

    if (solo.mods === "survival" && !ok && !isSkip){
      solo.wrong++;
      solo.misses.push(q);
      addToVault(q.id);
      return endSolo("Survival ended");
    }

    if (isSkip){
      solo.streak = 0;
      $("soloFeedbackBox").textContent = "Skipped.";
    } else if (ok){
      solo.correct++;
      solo.streak++;
      let base = (q.difficulty === "HARD" ? 5 : q.difficulty === "MED" ? 3 : 1);
      const speedBonus = rt <= 2000 ? 1 : rt <= 3500 ? 0.5 : 0;
      const streakBonus = solo.streak >= 10 ? 2 : solo.streak >= 5 ? 1 : 0;
      solo.score += Math.round(base + speedBonus + streakBonus + confMult.ok);
      if (solo.feedback === "instant"){
        $("soloFeedbackBox").textContent = `Correct (+${Math.round(base + speedBonus + streakBonus + confMult.ok)})`;
      }
    } else {
      solo.wrong++;
      solo.streak = 0;
      solo.misses.push(q);
      addToVault(q.id);
      let penalty = (q.difficulty === "HARD" ? -2 : q.difficulty === "MED" ? -1 : -1);
      penalty += confMult.bad;
      solo.score += penalty;
      if (solo.feedback === "instant"){
        $("soloFeedbackBox").textContent = isTimeout ? `Time. (${penalty})` : `Wrong. (${penalty})`;
      }
    }

    updateSoloHUD();
    setTimeout(() => nextSolo(false), 180);
  }

  function endSolo(reason){
    solo.active = false;
    stopSoloTimer();

    const total = solo.correct + solo.wrong;
    const acc = total ? (solo.correct/total) : 0;
    const avgRT = avg(solo.rts);

    stats.totalRuns += 1;
    stats.totalQuestions += total;
    stats.totalCorrect += solo.correct;

    if (solo.score > stats.bestSoloScore) stats.bestSoloScore = solo.score;
    if (acc > stats.bestSoloAcc) stats.bestSoloAcc = Math.round(acc*100);
    if (stats.bestSoloRT == null || (avgRT != null && avgRT < stats.bestSoloRT)) stats.bestSoloRT = avgRT;

    save(K.stats, stats);

    const rank = rankFromScore(solo.score, acc);
    const weakCats = computeWeakCats(solo.misses);

    $("soloCard").classList.add("hidden");
    $("soloHUD").classList.add("hidden");

    const res = [];
    res.push(`<div class="cardTitle">Solo Results — ${escapeHtml(reason)}</div>`);
    res.push(`<div class="row wrap">
      <div class="statBox"><div class="statTitle">Score</div><div class="statVal">${solo.score}</div></div>
      <div class="statBox"><div class="statTitle">Accuracy</div><div class="statVal">${Math.round(acc*100)}%</div></div>
      <div class="statBox"><div class="statTitle">Avg Reaction</div><div class="statVal">${fmtMs(avgRT)}</div></div>
      <div class="statBox"><div class="statTitle">Rank</div><div class="statVal">${escapeHtml(rank)}</div></div>
    </div>`);

    res.push(`<div class="micro">Weak domains: <b>${weakCats.length ? weakCats.join(", ") : "None detected"}</b></div>`);

    if (solo.misses.length){
      const list = solo.misses.slice(-10).map(m => {
        const correct = m.choices.find(c => c.key === m.correctKey)?.text || m.correctText || "(unknown)";
        return `<li><b>${escapeHtml(m.category)}</b> — ${escapeHtml(m.question)} <span class="micro">| Correct: ${escapeHtml(correct)}</span></li>`;
      }).join("");
      res.push(`<div class="micro" style="margin-top:10px"><b>Recent Misses:</b></div><ol>${list}</ol>`);
    } else {
      res.push(`<div class="micro" style="margin-top:10px"><b>No misses.</b></div>`);
    }

    $("soloResults").innerHTML = res.join("");
    $("soloResults").classList.remove("hidden");
  }

  // ===== TEAM ENGINE (patched + strict) =====
  const team = {
    active:false,total:0,idx:0,score:0,sync:0,
    unanimousCorrect:0,unanimousWrong:0,
    phase:"VOTE",timer:null,timeLeft:0,
    voteTime:7,debateTime:10,
    q:null, votes:{p1:null,p2:null,p3:null},
    currentVoter:null, avoidIds:[], debated:false
  };

  $("btnStartTeam").addEventListener("click", startTeam);
  $("btnTeamReset").addEventListener("click", () => {
    localStorage.removeItem(K.teamStats);
    $("teamHint").textContent = "Team stats reset on this device.";
  });

  $("btnTeamVote1").addEventListener("click", () => openVote("p1"));
  $("btnTeamVote2").addEventListener("click", () => openVote("p2"));
  $("btnTeamVote3").addEventListener("click", () => openVote("p3"));
  $("btnTeamLock").addEventListener("click", () => lockTeamAnswer(false));
  $("btnTeamEnd").addEventListener("click", () => endTeam("Ended"));

  function startTeam(){
    if (!BANK.length) { alert("Missing/invalid bank. Add question-bank.json."); return; }
    const p1 = $("tP1").value.trim().slice(0,24);
    const p2 = $("tP2").value.trim().slice(0,24);
    const p3 = $("tP3").value.trim().slice(0,24);
    if (!p1 || !p2 || !p3) { alert("Enter all 3 player names."); return; }

    save(K.teamStats, { p1, p2, p3, best: load(K.teamStats, {best:0}).best || 0 });

    team.total = Number($("teamLen").value);
    team.voteTime = Number($("teamVoteTime").value);
    team.debateTime = Number($("teamDebateTime").value);

    team.active = true;
    team.idx = 0; team.score = 0; team.sync = 0;
    team.unanimousCorrect = 0; team.unanimousWrong = 0;
    team.avoidIds = [];

    $("teamResults").classList.add("hidden");
    $("teamHUD").classList.remove("hidden");
    $("teamCard").classList.remove("hidden");
    $("teamTotal").textContent = String(team.total);

    nextTeam();
  }

  function resetTeamVotes(){
    team.votes = { p1:null, p2:null, p3:null };
    team.currentVoter = null;
    $("btnTeamLock").disabled = true;
    $("teamFeedback").textContent = "Silent vote: each player presses their vote button, then picks an answer.";
  }
  function votesCount(){ return Object.values(team.votes).filter(Boolean).length; }

  function startTeamPhase(name, seconds){
    team.phase = name;
    team.timeLeft = seconds;
    $("teamPhase").textContent = name;
    $("teamPhaseTimer").textContent = `${team.timeLeft}s`;
    stopTeamTimer();
    team.timer = setInterval(() => {
      team.timeLeft--;
      $("teamPhaseTimer").textContent = `${team.timeLeft}s`;
      if (team.timeLeft <= 0){
        stopTeamTimer();
        onTeamPhaseTimeout();
      }
    }, 1000);
  }
  function stopTeamTimer(){ if (team.timer) clearInterval(team.timer); team.timer=null; }

  function onTeamPhaseTimeout(){
    const filled = votesCount();

    // strict: if not all voted, penalty and move on
    if (filled < 3){
      team.score -= 1;
      $("teamScore").textContent = String(team.score);
      $("teamFeedback").textContent = `Timeout: not all voted (${filled}/3). Penalty -1. Next.`;
      addToVault(team.q.id);
      setTimeout(nextTeam, 260);
      return;
    }

    // all voted but no lock pressed in time -> force finalize
    lockTeamAnswer(true);
  }

  function nextTeam(){
    if (!team.active) return;
    if (team.idx >= team.total) return endTeam("Complete");

    team.idx++;
    team.debated = false;

    $("teamIdx").textContent = String(team.idx);
    $("teamScore").textContent = String(team.score);
    $("teamSync").textContent = String(team.sync);
    $("teamUni").textContent = String(team.unanimousCorrect);
    $("teamGt").textContent = String(team.unanimousWrong);

    resetTeamVotes();

    const preferHard = team.score >= 15;
    team.q = pickQuestion({ preferHard, weakCats: [], avoidIds: team.avoidIds });
    if (!team.q) return endTeam("No questions available");

    team.avoidIds.push(team.q.id);
    updateSeen(team.q.id);

    $("teamQuestion").textContent = team.q.question;

    renderChoices($("teamChoices"), team.q, (pick) => {
      if (!team.currentVoter) return;
      team.votes[team.currentVoter] = pick;
      team.currentVoter = null;

      const filled = votesCount();
      if (filled === 3) $("btnTeamLock").disabled = false;
      $("teamFeedback").textContent = `Votes submitted: ${filled}/3`;
    });

    startTeamPhase("VOTE", team.voteTime);
  }

  function openVote(p){
    if (!team.active) return;
    team.currentVoter = p;
    $("teamFeedback").textContent = `Now voting: ${p.toUpperCase()} — pick an answer.`;
  }

  function lockTeamAnswer(force){
    if (!team.active) return;
    stopTeamTimer();

    const picks = [team.votes.p1, team.votes.p2, team.votes.p3].filter(Boolean);
    const filled = picks.length;
    if (filled < 3 && !force){
      $("teamFeedback").textContent = "All 3 must vote (or wait for timer).";
      return;
    }

    const counts = {};
    picks.forEach(p => { counts[p.key] = (counts[p.key]||0)+1; });
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
    const [topKey, topCount] = sorted[0] || [null,0];

    const isUnanimous = topCount === 3;
    const isTwoOne = topCount === 2;
    const isThreeWaySplit = topCount === 1 && Object.keys(counts).length === 3;

    // first pass split -> debate + force clean re-vote once
    if (team.phase === "VOTE" && (isTwoOne || isThreeWaySplit) && !team.debated && !force){
      team.debated = true;
      resetTeamVotes();
      $("teamFeedback").textContent =
        "Split detected. DEBATE window: minority speaks first. Then re-vote silently (all 3 must vote again).";
      startTeamPhase("DEBATE", team.debateTime);
      return;
    }

    // still 1-1-1 after debate -> no-consensus penalty
    if (team.phase === "DEBATE" && isThreeWaySplit){
      team.score -= 2;
      $("teamScore").textContent = String(team.score);
      $("teamFeedback").textContent = "No consensus (1-1-1). Penalty -2. Next.";
      addToVault(team.q.id);
      setTimeout(nextTeam, 260);
      return;
    }

    const finalPick = picks.find(p => p.key === topKey) || picks[0];
    const ok = !!finalPick?.isCorrect;

    if (ok){
      team.score += isUnanimous ? 2 : 1;
      team.sync += isUnanimous ? 2 : 1;
      if (isUnanimous) team.unanimousCorrect++;
      $("teamFeedback").textContent = isUnanimous ? "Unanimous correct (+2, +sync)" : "Correct (+1)";
    } else {
      const penalty = isUnanimous ? -3 : -1;
      team.score += penalty;
      if (isUnanimous) team.unanimousWrong++;
      $("teamFeedback").textContent = isUnanimous ? "Unanimous wrong (groupthink -3)" : `Wrong (${penalty})`;
      addToVault(team.q.id);
    }

    $("teamScore").textContent = String(team.score);
    $("teamSync").textContent = String(team.sync);
    $("teamUni").textContent = String(team.unanimousCorrect);
    $("teamGt").textContent = String(team.unanimousWrong);

    setTimeout(nextTeam, 260);
  }

  function endTeam(reason){
    team.active = false;
    stopTeamTimer();

    $("teamCard").classList.add("hidden");
    $("teamHUD").classList.add("hidden");

    const st = load(K.teamStats, {best:0});
    st.best = Math.max(st.best || 0, team.score);
    save(K.teamStats, st);

    stats.teamBest = Math.max(stats.teamBest, team.score);
    save(K.stats, stats);

    $("teamResults").innerHTML = `
      <div class="cardTitle">Team Results — ${escapeHtml(reason)}</div>
      <div class="row wrap">
        <div class="statBox"><div class="statTitle">Score</div><div class="statVal">${team.score}</div></div>
        <div class="statBox"><div class="statTitle">Sync Score</div><div class="statVal">${team.sync}</div></div>
        <div class="statBox"><div class="statTitle">Unanimous+</div><div class="statVal">${team.unanimousCorrect}</div></div>
        <div class="statBox"><div class="statTitle">Groupthink-</div><div class="statVal">${team.unanimousWrong}</div></div>
      </div>
      <div class="micro">Best team score on this device: <b>${st.best || 0}</b></div>
      <div class="micro">Strict discipline: if someone doesn’t vote before timer, penalty triggers.</div>
    `;
    $("teamResults").classList.remove("hidden");
  }

  // ===== QUIZBOWL ENGINE =====
  const qb = {
    active:false, struct:"20-20-10", perQ:7, lock:"on",
    round:1, total:0, idx:0, score:0,
    timer:null, timeLeft:0, avoidIds:[], misses:[]
  };

  $("btnStartQB").addEventListener("click", startQB);
  $("btnQBEnd").addEventListener("click", () => endQB("Ended"));

  function computeQBTotal(struct){
    if (struct === "20-20-10") return 50;
    if (struct === "30-0-10") return 40;
    if (struct === "40-0-0") return 40;
    return 50;
  }

  function currentRoundFromIdx(idx, struct){
    if (struct === "20-20-10"){
      if (idx <= 20) return 1;
      if (idx <= 40) return 2;
      return 3;
    }
    if (struct === "30-0-10"){
      if (idx <= 30) return 1;
      return 2;
    }
    return 1;
  }

  function startQB(){
    if (!BANK.length) { alert("Missing/invalid bank. Add question-bank.json."); return; }
    qb.struct = $("qbStruct").value;
    qb.perQ = Number($("qbTimer").value);
    qb.lock = $("qbLock").value;

    qb.active = true;
    qb.round = 1;
    qb.idx = 0;
    qb.score = 0;
    qb.avoidIds = [];
    qb.misses = [];

    $("qbResults").classList.add("hidden");
    $("qbHUD").classList.remove("hidden");
    $("qbCard").classList.remove("hidden");

    qb.total = computeQBTotal(qb.struct);
    $("qbTotal").textContent = String(qb.total);

    nextQB();
  }

  function startQBTimer(){
    stopQBTimer();
    qb.timeLeft = qb.perQ;
    $("qbTime").textContent = `${qb.timeLeft}s`;
    $("qbTimerPill").textContent = `${qb.timeLeft}s`;
    qb.timer = setInterval(() => {
      qb.timeLeft--;
      $("qbTime").textContent = `${qb.timeLeft}s`;
      $("qbTimerPill").textContent = `${qb.timeLeft}s`;
      if (qb.timeLeft <= 0){
        stopQBTimer();
        submitQB({ isCorrect:false, key:"", text:"(timeout)" });
      }
    }, 1000);
  }
  function stopQBTimer(){ if (qb.timer) clearInterval(qb.timer); qb.timer=null; }

  function nextQB(){
    if (!qb.active) return;
    if (qb.idx >= qb.total) return endQB("Complete");

    qb.idx++;
    qb.round = currentRoundFromIdx(qb.idx, qb.struct);
    $("qbRound").textContent = String(qb.round);
    $("qbIdx").textContent = String(qb.idx);
    $("qbScore").textContent = String(qb.score);

    const isBoss = (qb.struct === "20-20-10" && qb.idx > 40) || (qb.struct === "30-0-10" && qb.idx > 30);
    const preferHard = isBoss || qb.score > 15;

    const q = pickQuestion({ preferHard, weakCats: [], avoidIds: qb.avoidIds });
    qb.q = q;
    if (!qb.q) return endQB("No questions available");

    qb.avoidIds.push(q.id);
    updateSeen(q.id);

    $("qbTag").textContent = `${q.difficulty}${isBoss ? " • BOSS" : ""}`;
    $("qbQuestion").textContent = q.question;

    renderChoices($("qbChoices"), q, (pick) => submitQB(pick));
    startQBTimer();
  }

  function submitQB(pick){
    if (!qb.active) return;
    stopQBTimer();

    const ok = !!pick?.isCorrect;
    if (ok){
      qb.score += 1;
    } else {
      qb.score -= 1;
      qb.misses.push(qb.q);
      addToVault(qb.q.id);
    }

    $("qbScore").textContent = String(qb.score);
    setTimeout(nextQB, 140);
  }

  function endQB(reason){
    qb.active = false;
    stopQBTimer();

    $("qbCard").classList.add("hidden");
    $("qbHUD").classList.add("hidden");

    stats.qbBest = Math.max(stats.qbBest, qb.score);
    save(K.stats, stats);

    const weakCats = computeWeakCats(qb.misses);

    const missList = qb.misses.slice(-10).map(m => {
      const correct = m.choices.find(c => c.key === m.correctKey)?.text || m.correctText || "(unknown)";
      return `<li><b>${escapeHtml(m.category)}</b> — ${escapeHtml(m.question)} <span class="micro">| Correct: ${escapeHtml(correct)}</span></li>`;
    }).join("");

    $("qbResults").innerHTML = `
      <div class="cardTitle">Quizbowl Results — ${escapeHtml(reason)}</div>
      <div class="row wrap">
        <div class="statBox"><div class="statTitle">Score</div><div class="statVal">${qb.score}</div></div>
        <div class="statBox"><div class="statTitle">Weak Domains</div><div class="statVal">${escapeHtml(weakCats.join(", ") || "None")}</div></div>
        <div class="statBox"><div class="statTitle">Misses</div><div class="statVal">${qb.misses.length}</div></div>
        <div class="statBox"><div class="statTitle">Best (device)</div><div class="statVal">${stats.qbBest}</div></div>
      </div>
      <div class="micro"><b>No mid-round help.</b> This sim is meant to feel like the event.</div>
      ${qb.misses.length ? `<div class="micro" style="margin-top:10px"><b>Recent Misses:</b></div><ol>${missList}</ol>` : `<div class="micro" style="margin-top:10px"><b>No misses.</b></div>`}
    `;
    $("qbResults").classList.remove("hidden");
  }

  // ===== Stats Screen =====
  function renderStats(){
    const v = load(K.vault, { items: [] });
    const teamSt = load(K.teamStats, null);
    const acc = stats.totalQuestions ? Math.round((stats.totalCorrect/stats.totalQuestions)*100) : 0;

    $("statsBody").innerHTML = `
      <div class="statBox">
        <div class="statTitle">Best Solo Score</div>
        <div class="statVal">${stats.bestSoloScore}</div>
        <div class="micro">Best Solo Accuracy: ${stats.bestSoloAcc}%</div>
        <div class="micro">Best Solo Avg RT: ${fmtMs(stats.bestSoloRT)}</div>
      </div>
      <div class="statBox">
        <div class="statTitle">Total Runs</div>
        <div class="statVal">${stats.totalRuns}</div>
        <div class="micro">Lifetime Accuracy: ${acc}%</div>
        <div class="micro">Total Questions Answered: ${stats.totalQuestions}</div>
      </div>
      <div class="statBox">
        <div class="statTitle">Quizbowl Best</div>
        <div class="statVal">${stats.qbBest}</div>
      </div>
      <div class="statBox">
        <div class="statTitle">Team Best</div>
        <div class="statVal">${stats.teamBest}</div>
        <div class="micro">${teamSt ? `Players: ${escapeHtml(teamSt.p1)}, ${escapeHtml(teamSt.p2)}, ${escapeHtml(teamSt.p3)}` : "No team run saved"}</div>
      </div>
      <div class="statBox">
        <div class="statTitle">Vault Size</div>
        <div class="statVal">${v.items.length}</div>
        <div class="micro">Missed questions saved locally for drilling.</div>
      </div>
      <div class="statBox">
        <div class="statTitle">Bank</div>
        <div class="statVal">${escapeHtml(BANK_TITLE)}</div>
        <div class="micro">Questions loaded: ${BANK.length}</div>
      </div>
    `;
  }

  // ===== Init =====
  function initUI(){
    $("username").value = profile.username || "";
    $("accent").value = profile.accent || "cyan";
    $("intensity").value = profile.intensity || "cinematic";

    themeState.accent = profile.accent || themeState.accent;
    themeState.intensity = profile.intensity || themeState.intensity;
    applyTheme();
  }

  // Boot
  (async () => {
    initUI();
    await loadBank();
    if (BANK.length) startColdOpen();
  })();
})();
