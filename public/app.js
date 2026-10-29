const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let connected = false,
  pollTimer,
  syncing = false,
  serverOffset = 0,
  autoHide;
let state = null,
  tab = new URLSearchParams(location.search).has("room") ? "join" : "create",
  peek = false,
  selected = null,
  busy = false,
  toastTimer;
let session = null;
try {
  session = JSON.parse(sessionStorage.getItem("undercover-session"));
} catch {
  /* storage may be disabled */
}
let serviceStatus = "checking",
  serviceMessage = "Checking room availability…";
const queryCode = new URLSearchParams(location.search).get("room") || "";
function saveSession(value) {
  session = value;
  try {
    if (value)
      sessionStorage.setItem("undercover-session", JSON.stringify(value));
    else sessionStorage.removeItem("undercover-session");
  } catch {
    /* still works until refresh */
  }
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
function connection(ok, label) {
  connected = ok;
  $(".connection").classList.toggle("online", ok);
  $("#connection-label").textContent =
    label || (ok ? "Connected" : "Reconnecting");
}
function availability(status, message) {
  serviceStatus = status;
  serviceMessage = message;
  const notice = $("#service-notice"),
    text = $("#service-message"),
    retry = $("#service-retry");
  if (notice) {
    notice.hidden = status === "ready";
    text.textContent = message;
    retry.hidden = status === "checking";
    retry.disabled = status === "checking";
  }
  const submit = $("#entry button[type=submit]");
  if (submit) submit.disabled = status !== "ready" || busy;
}
async function checkHealth() {
  availability("checking", "Checking room availability…");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json();
    if (response.ok && result.ok) {
      availability("ready", "");
      connection(true, "Ready to play");
    } else {
      const setup = result.code === "STORAGE_NOT_CONFIGURED";
      availability(
        setup ? "setup" : "offline",
        setup
          ? "Rooms aren’t set up yet. Ask the host to finish connecting game storage."
          : "Rooms are offline right now. Check the connection and try again.",
      );
      connection(false, setup ? "Setup needed" : "Rooms offline");
    }
  } catch {
    availability(
      "offline",
      "Can’t reach the room service. Check your internet connection, then retry.",
    );
    connection(false, "Rooms offline");
  } finally {
    clearTimeout(timeout);
  }
}
function requestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}
async function request(type, data = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        data,
        code: session?.code,
        token: session?.token,
        phaseKey: state?.phaseKey,
        requestId: requestId(),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const result = await response.json();
    if (response.status === 503) {
      availability(
        result.code === "STORAGE_NOT_CONFIGURED" ? "setup" : "offline",
        result.error,
      );
    } else if (result.ok) {
      availability("ready", "");
    }
    if (result.serverTime)
      serverOffset = result.serverTime - (started + Date.now()) / 2;
    connection(
      response.status < 500,
      response.status >= 500 ? "Temporarily unavailable" : undefined,
    );
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
async function send(type, data = {}) {
  try {
    const result = await request(type, data);
    if (!result.ok) {
      toast(result.error);
      if ($("#entry-error")) $("#entry-error").textContent = result.error;
      if (session) await sync();
      return null;
    }
    if (result.session) saveSession(result.session);
    if (result.state) acceptState(result.state);
    schedulePoll();
    return result;
  } catch {
    connection(false);
    toast("Connection interrupted. Reconnecting to your room…");
    schedulePoll(2000);
    return null;
  }
}
function acceptState(next) {
  if (state && next.version < state.version) return;
  const changed = !state || state.phaseKey !== next.phaseKey;
  const previous = state;
  state = next;
  if (changed) {
    peek = false;
    selected = null;
    clearTimeout(autoHide);
  }
  history.replaceState({}, "", `?room=${state.code}`);
  const visibleSnapshot = (s) => {
    if (!s) return null;
    const { version, ...visible } = s;
    return JSON.stringify(visible);
  };
  if (visibleSnapshot(previous) !== visibleSnapshot(next)) {
    render();
    if (changed && previous && previous.phase !== next.phase) {
      $("#app").focus({ preventScroll: true });
      $("#phase-announcement").textContent = `${next.phase} phase`;
    }
  }
}
function schedulePoll(delay) {
  clearTimeout(pollTimer);
  if (session)
    pollTimer = setTimeout(
      sync,
      delay ??
        (document.hidden ? 15000 : state?.phase === "lobby" ? 3000 : 1500),
    );
}
async function sync() {
  if (syncing || busy) {
    schedulePoll(500);
    return;
  }
  if (!session) return;
  syncing = true;
  try {
    const result = await request("sync");
    if (result.ok) acceptState(result.state);
    else if (
      result.error?.includes("expired") ||
      result.error?.includes("removed") ||
      result.error?.includes("not found")
    )
      reset(result.error);
  } catch {
    connection(false);
  } finally {
    syncing = false;
    schedulePoll();
  }
}
function togglePeek() {
  peek = !peek;
  clearTimeout(autoHide);
  if (peek)
    autoHide = setTimeout(() => {
      peek = false;
      render();
    }, 8000);
  render();
}
function player(id) {
  return state?.players.find((p) => p.id === id);
}
function isHost() {
  return state?.me === state?.hostId;
}
function eyes() {
  return '<span class="eyes" aria-hidden="true"><i></i><i></i></span>';
}
function landing() {
  $("#app").innerHTML =
    `<div class="hero-grid"><section><div class="badge"><i></i> YOUR NEXT OFFICE BREAK, SORTED</div><h1>Same team.<br>Different <em>secrets.</em></h1><p class="intro">One word. One outsider. A room full of very suspicious colleagues.</p><div class="facts"><span>◉ <b>4–10 players</b></span><span>◷ <b>5–10 min</b></span><span>↗ <b>No downloads</b></span></div><div class="dossier"><img src="/agents.svg" width="600" height="320" alt="Three playful undercover agents on colourful personnel cards"></div></section><section class="entry-card"><div class="card-heading"><span class="eyebrow">THE BREAK ROOM</span><span>01 / JOIN THE FUN</span></div><h2>Who’s in on it?</h2><p class="muted">Bring your colleagues. Leave your poker face on.</p><div class="tabs" role="group" aria-label="Room action"><button aria-pressed="${tab === "create"}" data-tab="create" class="${tab === "create" ? "active" : ""}">Create a room</button><button aria-pressed="${tab === "join"}" data-tab="join" class="${tab === "join" ? "active" : ""}">Join a room</button></div><form id="entry"><div class="service-notice" id="service-notice" role="status" ${serviceStatus === "ready" ? "hidden" : ""}><p id="service-message">${escape(serviceMessage)}</p><button type="button" class="text-button" id="service-retry" ${serviceStatus === "checking" ? "hidden" : ""}>Check again ↻</button></div><p class="invite-notice">${tab === "join" ? "You’re invited. Enter your name to take a seat." : "Start a private room. Invite your team next."}</p><div class="field"><label for="name">YOUR NAME</label><input id="name" name="name" placeholder="What do they call you at work?" minlength="2" maxlength="20" autocomplete="nickname" required></div>${tab === "join" ? `<div class="field"><label for="code">ROOM CODE</label><input class="code-input" id="code" name="code" value="${escape(queryCode.toUpperCase())}" placeholder="ABC234" minlength="6" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" required></div>` : ""}<button class="primary full" type="submit" ${serviceStatus !== "ready" ? "disabled" : ""}>${tab === "create" ? "Create the room" : "Join the room"} <span>↗</span></button><p id="entry-error" class="error-inline" role="alert"></p><p class="micro">No account. No app. Just a little healthy suspicion.</p></form><div class="mini-divider">NEW TO UNDERCVR?</div><button class="secondary full" data-rules>Get the 30-second briefing ↗</button></section></div><section class="how-strip"><div class="step"><span class="step-number">01 —</span><div><b>Keep your word close.</b><p>Everyone gets a secret word.<br>One person’s is a little different.</p></div></div><div class="step"><span class="step-number">02 —</span><div><b>Read between the clues.</b><p>Say a hint out loud. Listen closely.<br>Who doesn’t quite fit in?</p></div></div><div class="step"><span class="step-number">03 —</span><div><b>Vote your suspicions.</b><p>Find the Undercover before<br>they blend into the final three.</p></div></div></section>`;
  try {
    $("#name").value = localStorage.getItem("undercover-name") || "";
  } catch {}
  document.querySelectorAll("[data-tab]").forEach(
    (el) =>
      (el.onclick = () => {
        const name = $("#name").value;
        tab = el.dataset.tab;
        landing();
        $("#name").value = name;
      }),
  );
  $("#entry").onsubmit = async (e) => {
    e.preventDefault();
    if (busy || serviceStatus !== "ready") return;
    busy = true;
    const button = e.submitter;
    button.disabled = true;
    const name = $("#name").value.trim();
    if (name.length < 2) {
      $("#entry-error").textContent =
        "Enter a name with at least 2 characters.";
      busy = false;
      button.disabled = false;
      return;
    }
    button.textContent = tab === "create" ? "Creating room…" : "Joining room…";
    try {
      localStorage.setItem("undercover-name", name);
    } catch {}
    const result = await send(tab, {
      name,
      code: $("#code")?.value.trim().toUpperCase(),
    });
    if (result) saveSession(result.session);
    busy = false;
    if (button.isConnected) {
      button.disabled = serviceStatus !== "ready";
      button.textContent =
        tab === "create" ? "Create the room ↗" : "Join the room ↗";
    }
  };
  if ($("#service-retry")) $("#service-retry").onclick = checkHealth;
  bindCommon();
}
function roster() {
  return state.players
    .map(
      (p) =>
        `<div class="player ${!p.alive ? "out" : ""}"><span class="avatar">${escape(p.name.slice(0, 2).toUpperCase())}</span><span class="player-name"><b>${escape(p.name)}${p.id === state.me ? ' <span class="subtext">(you)</span>' : ""}</b><small>${p.id === state.hostId ? "Host · " : ""}${!p.connected ? "Reconnecting" : !p.alive ? "Spectating" : state.phase === "lobby" ? (p.ready ? "Ready for suspicion" : "Getting settled") : "In the game"}</small></span><span class="status ${!p.connected ? "offline" : ""}">${!p.connected ? "○" : state.phase === "lobby" ? (p.ready ? "✓" : "…") : !p.alive ? "Out" : state.phase === "reveal" ? (p.revealed ? "✓" : "…") : state.phase === "voting" ? (state.voted.includes(p.id) ? "Voted" : "…") : state.speaker === p.id ? "Speaking" : "●"}</span>${state.phase === "lobby" && isHost() && p.id !== state.me ? `<button class="icon-button" data-kick="${p.id}" aria-label="Remove ${escape(p.name)}">×</button>` : ""}</div>`,
    )
    .join("");
}
function roomTop() {
  return `<div class="room-top"><div><span class="eyebrow">${state.phase === "lobby" ? "THE BREAK ROOM" : `GAME ${state.match} · ROUND ${state.round || "—"}`}</span><h1>${state.phase === "lobby" ? "The usual suspects." : "Trust is overrated."}</h1><span class="subtext">ROOM <b class="room-code">${state.code}</b></span></div>${state.phase === "lobby" ? '<button class="secondary" data-action="leave">Leave room ↗</button>' : isHost() ? '<button class="text-button" data-action="cancel">End game</button>' : ""}</div>`;
}
const packLabels = {
  office: "Office life",
  food: "Food & drinks",
  everyday: "Everyday things",
  hinglish: "Hinglish mix",
};
function lobby() {
  const me = player(state.me),
    readyCount = state.players.filter((p) => p.ready && p.connected).length;
  const allReady =
    state.players.length >= 4 && readyCount === state.players.length;
  const needed = Math.max(0, 4 - state.players.length);
  const reason = needed
    ? `Invite ${needed} more ${needed === 1 ? "colleague" : "colleagues"} to start.`
    : !allReady
      ? `Waiting for ${state.players.length - readyCount} ${state.players.length - readyCount === 1 ? "player" : "players"} to get ready.`
      : "Everyone’s here. Let the suspicion begin.";
  const packIcons = { office: "▤", food: "☕", everyday: "◈", hinglish: "अ" };
  return `${roomTop()}
 <div class="lobby-steps"><span class="done">01 · Room created</span><span class="${needed ? "current" : "done"}">02 · Invite the team</span><span class="${!needed ? "current" : ""}">03 · Get ready</span></div>
 <div class="room-grid">
 <section class="panel invite-panel"><div class="panel-head"><div><span class="eyebrow">INVITE YOUR INNER CIRCLE</span><h2>Save them a seat.</h2><p class="muted">Share the link or scan the code. Every player needs their own phone.</p></div></div>
 <div class="invite-card"><img class="qr" src="/api/qr?room=${state.code}" alt="Scan to join room ${state.code}"><div><span class="subtext">YOUR PRIVATE ROOM</span><button class="room-code code-copy" id="copy-code" aria-label="Copy room code ${state.code}">${state.code} <span>⧉</span></button><span class="subtext">No accounts. Just your name.</span></div></div>
 <div class="share-actions"><button class="primary" id="copy-link">Copy invite link ↗</button><button class="secondary" id="share">Share ↗</button></div>
 <div class="team-heading"><h3>The guest list</h3><span class="pill green">${state.players.length} / 10</span></div><div class="player-list">${roster()}</div>
 ${needed ? `<div class="empty-seats" aria-label="${needed} more players needed">${Array.from({ length: needed }, () => "<span>＋<small>Seat open</small></span>").join("")}</div>` : ""}</section>
 <aside class="settings-sidebar"><section class="panel"><span class="eyebrow">${isHost() ? "HOST’S DESK" : "YOUR HOST’S PICKS"}</span><h2>Set the mood.</h2><p class="muted">Familiar words. Unexpected suspects.</p><div class="room-settings"><div><label for="pack">WORD PACK</label><div class="pack-preview" aria-hidden="true">${packIcons[state.pack]}</div><select id="pack" ${!isHost() ? "disabled" : ""}>${Object.entries(
   packLabels,
 )
   .map(
     ([id, name]) =>
       `<option value="${id}" ${state.pack === id ? "selected" : ""}>${name}</option>`,
   )
   .join(
     "",
   )}</select><p class="subtext">${state.pack === "hinglish" ? "Roman Hindi + English. Easy to say out loud." : "20 original pairs · Family & office friendly"}</p></div><div><label for="seconds">TIME PER CLUE</label><select id="seconds" ${!isHost() ? "disabled" : ""}>${[30, 45, 60].map((n) => `<option value="${n}" ${state.seconds === n ? "selected" : ""}>${n} seconds${n === 45 ? " · Recommended" : ""}</option>`).join("")}</select></div></div><div class="rule-mini"><b>1 outsider. Zero trust.</b><p>Speak your clues out loud. Vote on your phone. Catch the Undercover before the final three.</p><button class="text-button" data-rules>How to play ↗</button></div></section></aside></div>
 <section class="ready-bar" aria-label="Ready and start"><div><b>${readyCount} of ${state.players.length} ready</b><p id="start-reason">${reason}</p></div><div class="ready-buttons"><button class="${me.ready ? "secondary" : "primary"}" data-action="ready">${me.ready ? "✓ Ready · Undo" : "I’m ready ↗"}</button>${isHost() ? `<button class="primary" data-action="start" aria-describedby="start-reason" ${!allReady ? "disabled" : ""}>Start game ↗</button>` : `<span class="subtext">${escape(player(state.hostId)?.name)} will start.</span>`}</div></section>`;
}
function timer() {
  return state.deadline
    ? '<div class="timer" aria-label="Seconds remaining" id="countdown"></div>'
    : "";
}
function peekButton() {
  return `<div class="word-peek"><button class="secondary" id="peek">${peek ? "Hide my word" : "Peek at my word"}</button>${peek ? `<p><b>${escape(state.word)}</b></p>` : ""}</div>`;
}
function phaseBody() {
  const me = player(state.me),
    host = isHost();
  if (state.phase === "reveal")
    return `<div class="graphic-seal" aria-hidden="true">◈</div><span class="eyebrow">EYES ON YOUR OWN SCREEN</span><h2>Your secret starts here.</h2><p class="muted">You might be the Undercover. Your word is your only clue.</p><button id="secret" aria-pressed="${peek}" class="secret-card ${peek ? "" : "covered"}" aria-label="${peek ? "Hide" : "Reveal"} secret word">${peek ? `<span class="eyebrow">YOUR WORD</span><span class="secret-word">${escape(state.word)}</span><span class="subtext">Auto-hides in 8 seconds · Tap to hide</span>` : `${eyes()}<b>Tap to reveal</b><span class="subtext">Only you should see this.</span>`}</button><div class="game-actions"><button class="primary" data-action="revealed" ${me.revealed ? "disabled" : !peek ? "disabled" : ""}>${me.revealed ? "✓ Waiting for everyone" : "Hide word & continue ↗"}</button></div><p class="micro">${state.players.filter((p) => p.revealed).length} / ${state.players.length} words memorised · Clues start automatically after 2 minutes.</p>`;
  if (state.phase === "clues") {
    const speaker = player(state.speaker),
      myTurn = state.speaker === state.me;
    return `<span class="eyebrow">DROP A HINT. KEEP A SECRET.</span>${timer()}<h2>${myTurn ? "You’re up. Act natural." : `${escape(speaker?.name)} has the floor.`}</h2><p class="muted">${myTurn ? "Say a short clue out loud. Don’t say your secret word." : "Listen closely. Does their clue fit your word?"}</p>${!speaker?.connected ? '<div class="warning">This player is reconnecting. The host can skip their turn.</div>' : ""}<div class="speaker-line">${state.order.map((id, i) => `<span class="speaker-chip ${id === state.speaker ? "speaking" : i < state.order.indexOf(state.speaker) ? "done" : ""}" aria-label="${escape(player(id)?.name)}${id === state.speaker ? ", speaking" : ""}">${i < state.order.indexOf(state.speaker) ? "✓" : escape(player(id)?.name.slice(0, 2).toUpperCase())}</span>`).join("")}</div><span class="pill">Speaker ${state.order.indexOf(state.speaker) + 1} of ${state.order.length}</span><div class="game-actions">${myTurn || host ? `<button class="primary" data-action="clue-done">${myTurn ? "Clue given · Next player" : "Skip to next player"} ↗</button>` : '<p class="waiting">Your turn will come around. Stay suspicious.</p>'}</div>${me.alive ? peekButton() : '<p class="muted">You’re spectating. Keep what you know a secret!</p>'}`;
  }
  if (state.phase === "discussion")
    return `<span class="eyebrow">TIME TO COMPARE NOTES</span>${timer()}<h2>Something doesn’t add up.</h2><p class="muted">Who sounded a little different? Talk it through together.<br>Keep your exact word to yourself.</p><div class="game-actions">${host ? '<button class="primary" data-action="open-vote">Let’s vote ↗</button>' : '<p class="waiting">Voting opens when the host is ready, or when time runs out.</p>'}</div>${me.alive ? peekButton() : ""}`;
  if (state.phase === "voting") {
    const eligible = me.alive && !state.myVote;
    return `<span class="eyebrow">${state.runoff ? "IT’S A TIE · ONE MORE VOTE" : "THE MOMENT OF SUSPICION"}</span>${timer()}<h2>${!me.alive ? "Watch the votes roll in." : state.myVote ? "Your suspicion is locked." : "Who’s the Undercover?"}</h2><p class="muted">${state.runoff ? "Vote among the tied players. Another tie means nobody leaves." : "Votes stay private until everyone votes or the timer ends."}</p><div class="vote-grid">${state.players
      .filter((p) => state.candidates.includes(p.id))
      .map(
        (p) =>
          `<button class="player vote-choice ${selected === p.id || state.myVote === p.id ? "selected" : ""}" data-vote="${p.id}" ${!eligible || p.id === state.me ? "disabled" : ""}><span class="avatar">${escape(p.name.slice(0, 2).toUpperCase())}</span><span class="player-name"><b>${escape(p.name)}</b><small>${p.id === state.me ? "You can’t vote for yourself" : state.myVote === p.id ? "Your vote" : selected === p.id ? "Selected" : "Suspicious?"}</small></span></button>`,
      )
      .join(
        "",
      )}</div>${eligible ? `<button class="primary full" id="lock-vote" ${!selected ? "disabled" : ""}>Lock my vote ↗</button>` : ""}<p class="micro">${state.voted.length} / ${state.players.filter((p) => p.alive).length} votes locked</p>`;
  }
  if (state.phase === "result") {
    const r = state.lastResult,
      eliminated = player(r.eliminated);
    return `<span class="eyebrow">ROUND ${state.round} · THE VERDICT</span><h2>${eliminated ? `${escape(eliminated.name)} is out.` : "Nobody’s leaving. Yet."}</h2><p class="muted">${eliminated ? "They were a Civilian. The Undercover is still among you." : "The vote was tied or nobody voted. Take another round of clues."}</p>${voteLog(r.counts)}<div class="game-actions">${host ? '<button class="primary" data-action="next">Next round of clues ↗</button>' : '<p class="waiting">Waiting for the host to start the next round.</p>'}</div>`;
  }
  const spy = player(state.solution.spyId);
  return `<div class="win-graphic" aria-hidden="true">✧<span>◈</span>✧</div><span class="eyebrow">CASE CLOSED · GAME ${state.match}</span><h2>${state.winner === "civilians" ? "Cover blown. Team wins!" : "They played you. Brilliantly."}</h2><p class="muted">${escape(spy?.name)} was the Undercover.${state.winner === "undercover" ? " They survived to the final three." : " Nice detective work, everyone."}</p><div class="reveal-row"><div class="answer"><small>CIVILIAN WORD</small><strong>${escape(state.solution.words[0])}</strong></div><div class="answer spy"><small>UNDERCOVER WORD</small><strong>${escape(state.solution.words[1])}</strong></div></div>${state.lastResult ? voteLog(state.lastResult.counts) : ""}<div class="leaderboard"><span class="eyebrow">BREAK ROOM LEADERBOARD</span><ul class="vote-log">${[
    ...state.players,
  ]
    .sort((a, b) => b.score - a.score)
    .map(
      (p) =>
        `<li><span>${escape(p.name)} ${p.id === state.solution.spyId ? "· Undercover" : ""}</span><strong>${p.score} ${p.score === 1 ? "win" : "wins"}</strong></li>`,
    )
    .join(
      "",
    )}</ul></div><div class="game-actions">${host ? '<button class="primary" data-action="lobby">Back to lobby · Play again ↗</button>' : '<p class="waiting">Waiting for the host to open the lobby.</p>'}</div>`;
}
function voteLog(counts) {
  return `<ul class="vote-log">${
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([id, n]) =>
          `<li><span>${escape(player(id)?.name)}</span><b>${n} ${n === 1 ? "vote" : "votes"}</b></li>`,
      )
      .join("") || "<li>No votes cast.</li>"
  }</ul>`;
}
function game() {
  const index = [
    "reveal",
    "clues",
    "discussion",
    "voting",
    "result",
    "finished",
  ].indexOf(state.phase);
  return `${roomTop()}<div class="game-layout"><nav class="phase-bar" aria-label="Game progress">${["Secret word", "Give clues", "Discuss", "Vote", "Verdict"].map((s, i) => `<span class="${Math.min(index, 4) === i ? "current" : ""}">${String(i + 1).padStart(2, "0")} ${s}</span>`).join("")}</nav><section class="panel game-main">${phaseBody()}</section><details class="panel game-info"><summary>Team status · ${state.players.filter((p) => p.alive).length} still in</summary><div class="player-list">${roster()}</div></details></div>`;
}
function render() {
  if (!state) {
    landing();
    return;
  }
  const detailsOpen = $(".game-info")?.open;
  const focusId = document.activeElement?.id;
  $("#app").innerHTML = state.phase === "lobby" ? lobby() : game();
  if (detailsOpen && $(".game-info")) $(".game-info").open = true;
  if (focusId && document.getElementById(focusId))
    document.getElementById(focusId).focus({ preventScroll: true });
  bindCommon();
  updateTimer();
  document.querySelectorAll("[data-action]").forEach(
    (el) =>
      (el.onclick = async () => {
        const type = el.dataset.action;
        if (
          type === "cancel" &&
          !confirm(
            "End this game and return everyone to the lobby? No points will be awarded.",
          )
        )
          return;
        if (busy) return;
        busy = true;
        el.disabled = true;
        if (type === "revealed") {
          peek = false;
          clearTimeout(autoHide);
          render();
        }
        const result = await send(type);
        busy = false;
        if (type === "leave" && result) {
          saveSession(null);
          state = null;
          history.replaceState({}, "", location.pathname);
          render();
        } else if (el.isConnected) el.disabled = false;
      }),
  );
  document.querySelectorAll("[data-kick]").forEach(
    (el) =>
      (el.onclick = () => {
        if (confirm(`Remove ${player(el.dataset.kick)?.name} from the lobby?`))
          send("kick", { target: el.dataset.kick });
      }),
  );
  if ($("#pack"))
    for (const id of ["pack", "seconds"])
      $("#" + id).onchange = () =>
        send("settings", {
          pack: $("#pack").value,
          seconds: Number($("#seconds").value),
        });
  if ($("#copy-link")) $("#copy-link").onclick = copyLink;
  if ($("#copy-code"))
    $("#copy-code").onclick = () => copyText(state.code, "Room code copied.");
  if ($("#share"))
    $("#share").onclick = async () => {
      const url = inviteLink();
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Join our UNDERCVR game",
            text: `Room ${state.code} · Trust nobody.`,
            url,
          });
        } catch (e) {
          if (e.name !== "AbortError") copyLink();
        }
      } else copyLink();
    };
  if ($("#secret")) $("#secret").onclick = togglePeek;
  if ($("#peek")) $("#peek").onclick = togglePeek;
  document.querySelectorAll("[data-vote]").forEach(
    (el) =>
      (el.onclick = () => {
        selected = el.dataset.vote;
        render();
      }),
  );
  if ($("#lock-vote"))
    $("#lock-vote").onclick = async () => {
      const button = $("#lock-vote");
      button.disabled = true;
      busy = true;
      const result = await send("vote", { target: selected });
      busy = false;
      if (!result && button.isConnected) button.disabled = false;
    };
}
function inviteLink() {
  const url = new URL(location.origin);
  url.searchParams.set("room", state.code);
  return url.href;
}
async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    prompt("Copy and share:", text);
  }
}
async function copyLink() {
  await copyText(
    inviteLink(),
    "Invite link copied. Send it to your colleagues.",
  );
}
function bindCommon() {
  document
    .querySelectorAll("[data-rules]")
    .forEach((el) => (el.onclick = () => $("#rules").showModal()));
}
function updateTimer() {
  const el = $("#countdown");
  if (el && state?.deadline)
    el.textContent = Math.max(
      0,
      Math.ceil((state.deadline - (Date.now() + serverOffset)) / 1000),
    );
}
setInterval(updateTimer, 250);
$("#rules-open").onclick = () => $("#rules").showModal();
$("#rules-close").onclick = $("#rules-got").onclick = () => $("#rules").close();
function reset(message) {
  saveSession(null);
  state = null;
  peek = false;
  clearTimeout(pollTimer);
  history.replaceState({}, "", location.pathname);
  render();
  toast(message);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    peek = false;
    if (state) render();
    schedulePoll();
  } else sync();
});
window.addEventListener("online", () => (session ? sync() : checkHealth()));
render();
if (session) sync();
else checkHealth();
