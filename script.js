/* ============================================================
   WORDLE // INFINITE
   Split-flap departure-board style Wordle with endless rounds.
   ============================================================ */

/* ---------- Firebase / leaderboard (Firestore) ---------- */

import { ANSWERS as ANSWER_WORDS_RAW, EXTRA as EXTRA_WORDS_RAW } from "./words.js?v=3";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  initializeFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, onSnapshot,
  increment, arrayUnion, runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBQOworAdvB_cXDE56kGGdgThHEfJYW1Gc",
  authDomain: "wordleinfinite-412f5.firebaseapp.com",
  projectId: "wordleinfinite-412f5",
  storageBucket: "wordleinfinite-412f5.firebasestorage.app",
  messagingSenderId: "539315532118",
  appId: "1:539315532118:web:aab65c1a0735bdffaae6f7",
  measurementId: "G-21P9BWQ4WR"
};

let db = null;
let leaderboardEnabled = true;
try {
  const app = initializeApp(firebaseConfig);
  // Some networks (corporate firewalls, antivirus, certain proxies) block
  // Firestore's default streaming (WebChannel) connection, which makes
  // onSnapshot hang forever with no error. Long-polling is slower per
  // update but works almost everywhere.
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
  });
} catch (e) {
  console.warn("Firebase failed to initialize — leaderboard disabled.", e);
  leaderboardEnabled = false;
}

function docIdFor(name){
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32) || "player";
}

// Writes the player's best streak if it beats their previously stored best.
// Uses merge so this never wipes the player's points field.
async function submitScore(name, best){
  if (!leaderboardEnabled || !name) return null;
  try {
    const ref = doc(db, "leaderboard", docIdFor(name));
    const snap = await getDoc(ref);
    const prevBest = snap.exists() ? (snap.data().best || 0) : 0;
    if (best > prevBest){
      await setDoc(ref, { name: name.trim().slice(0, 16), best, updatedAt: Date.now() }, { merge: true });
      return best;
    }
    return prevBest;
  } catch (e) {
    console.warn("submitScore failed", e);
    return null;
  }
}

// One-time read of a player's stored best + points (used at login).
async function loadPlayerData(name){
  if (!leaderboardEnabled || !name) return { best: 0, points: 0 };
  try {
    const ref = doc(db, "leaderboard", docIdFor(name));
    const snap = await getDoc(ref);
    if (snap.exists()){
      const d = snap.data();
      return { best: d.best || 0, points: d.points || 0 };
    }
  } catch (e) {
    console.warn("loadPlayerData failed", e);
  }
  return { best: 0, points: 0 };
}

// Adds points (global, cumulative, never resets) for passing a round.
async function awardPoints(name, amount){
  if (!leaderboardEnabled || !name) return;
  try {
    const ref = doc(db, "leaderboard", docIdFor(name));
    await setDoc(ref, {
      name: name.trim().slice(0, 16),
      points: increment(amount),
      updatedAt: Date.now()
    }, { merge: true });
  } catch (e) {
    console.warn("awardPoints failed", e);
  }
}

// Writes an absolute new points total (used when spending on a hint).
async function spendPoints(name, newTotal){
  if (!leaderboardEnabled || !name) return;
  try {
    const ref = doc(db, "leaderboard", docIdFor(name));
    await setDoc(ref, {
      name: name.trim().slice(0, 16),
      points: newTotal,
      updatedAt: Date.now()
    }, { merge: true });
  } catch (e) {
    console.warn("spendPoints failed", e);
  }
}

// Subscribes to live top-N leaderboard updates. Calls onUpdate(rows) every
// time the data changes, and onError(err) if the subscription fails.
function subscribeLeaderboard(limitCount, onUpdate, onError){
  if (!leaderboardEnabled){
    onError(new Error("Firebase not initialized"));
    return () => {};
  }
  try {
    const q = query(collection(db, "leaderboard"), orderBy("best", "desc"), limit(limitCount));
    return onSnapshot(
      q,
      (snap) => onUpdate(snap.docs.map(d => d.data())),
      (err) => {
        console.error("Leaderboard subscription error:", err);
        onError(err);
      }
    );
  } catch (e) {
    console.error("Leaderboard subscription failed to start:", e);
    onError(e);
    return () => {};
  }
}

/* ---------- Rooms (shared board with friends — Firestore) ---------- */
//
// A room is one Firestore document, rooms/{code}:
//   { code, answer, round, seq, streak, revealedBy, guesses: [words], updatedAt }
// Everyone in the room subscribes to it live, so all players see the same
// word and the same guesses. It runs over normal HTTPS through Firebase,
// so it works on any network, and nobody has to keep a tab open.
//
// `seq` increments every time a new round starts. Any player's browser can
// start the next round; a transaction makes sure only the first one wins.
// (Streaks are not counted inside rooms — the `streak` field stays at 0.)
//
// Each player's in-progress typing/hints are shown to friends through a
// separate small document per player (see "Live presence" below).

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

function randomRoomCode(){
  let code = "";
  for (let i = 0; i < 5; i++){
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function roomRef(code){
  return doc(db, "rooms", code.toUpperCase());
}

// The seq of the round we're currently showing (null until first snapshot).
let roomLastSeq = null;

function makeRoomHandle(code, isHost){
  const ref = roomRef(code);
  let unsubscribe = null;

  const handle = {
    code: code.toUpperCase(),
    isHost,

    // Every guess (yours or a friend's) goes through the shared document;
    // each browser applies it when the live update arrives.
    sendGuess(word){
      updateDoc(ref, { guesses: arrayUnion(word), updatedAt: Date.now() })
        .catch(e => {
          console.warn("sendGuess failed", e);
          showToast("Couldn't send guess");
        });
    },

    // Ends the round for everyone by revealing the answer.
    revealAnswer(){
      updateDoc(ref, { revealedBy: state.playerName || "someone", updatedAt: Date.now() })
        .catch(e => console.warn("revealAnswer failed", e));
    },

    // Starts the next shared round. Every browser tries this when a round
    // ends; the seq check means only the first one actually takes effect.
    async startNextRound(seqAtEnd, lost){
      const answer = pickAnswer();
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const d = snap.data();
          if (d.seq !== seqAtEnd) return; // someone else already advanced
          tx.update(ref, {
            answer,
            round: lost ? 1 : (d.round || 0) + 1,
            seq: d.seq + 1,
            guesses: [],
            revealedBy: "",
            updatedAt: Date.now()
          });
        });
      } catch (e) {
        console.warn("startNextRound failed", e);
      }
    },

    // Host-only manual restart (↺ button).
    async restartRoom(){
      const answer = pickAnswer();
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const d = snap.data();
          tx.update(ref, {
            answer, round: 1, seq: d.seq + 1, guesses: [], revealedBy: "", updatedAt: Date.now()
          });
        });
      } catch (e) {
        console.warn("restartRoom failed", e);
      }
    },

    getSeq(){ return roomLastSeq; },

    _subscribe(){
      unsubscribe = onSnapshot(
        ref,
        (snap) => { if (snap.exists()) handleRoomSnapshot(snap.data()); },
        (err) => {
          console.error("Room subscription error:", err);
          showToast("Lost connection to the room");
        }
      );
    },

    leave(){
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      roomLastSeq = null;
    }
  };

  return handle;
}

// Called on every live update of the room document.
function handleRoomSnapshot(data){
  if (data.seq !== roomLastSeq){
    // First update after joining, or a brand-new round started.
    roomLastSeq = data.seq;
    applyRoomState(data);
  } else {
    // Same round: show any guesses we haven't displayed yet.
    const guesses = Array.isArray(data.guesses) ? data.guesses : [];
    for (let i = state.guesses.length; i < guesses.length; i++){
      if (state.guesses.length >= MAX_GUESSES || state.guesses.includes(state.answer)) break;
      commitGuess(guesses[i]);
    }
  }
  // Someone in the room paid to reveal the answer — end the round for all.
  if (data.revealedBy) showRevealedAnswer();
}

// Sets up the shared round from the room document: the shared answer and
// round number, plus a silent replay of guesses already made (no animation,
// no points — those were handled when they were first made).
function applyRoomState(data){
  if (data.answer && LENGTHS.includes(data.answer.length)) setWordLength(data.answer.length, { silent: true });
  const guesses = Array.isArray(data.guesses) ? data.guesses : [];
  state.round = data.round;
  newRound(true, data.answer);
  guesses.forEach(w => replayGuess(w));
  state.gameOver = guesses.includes(data.answer) || guesses.length >= MAX_GUESSES;
  renderBoard();
  renderKeyboard();
  updateCounters();
}

// Creates a new room from the round currently on screen. Returns the code.
// Firestore can hang forever when it can't reach the server, so give up after a while.
function withTimeout(promise, ms = 10000){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("timed out"), { code: "timeout" })), ms))
  ]);
}

function describeRoomError(e){
  const code = e && e.code ? String(e.code) : "";
  if (code.includes("permission")) return "Firestore blocked it (permission-denied). The security rules must allow the \"rooms\" and \"roomPlayers\" collections.";
  if (code === "timeout" || code.includes("unavailable")) return "Couldn't reach the server. Check your connection and try again.";
  return `${code || (e && e.message) || "unknown error"}`;
}

async function createRoom(){
  if (!leaderboardEnabled) throw new Error("Firebase not initialized");
  let code = null;
  for (let i = 0; i < 5 && !code; i++){
    const candidate = randomRoomCode();
    const snap = await withTimeout(getDoc(roomRef(candidate)));
    if (!snap.exists()) code = candidate;
  }
  if (!code) throw new Error("Couldn't find a free room code");

  await withTimeout(setDoc(roomRef(code), {
    code,
    answer: state.answer,
    round: state.round,
    seq: 1,
    streak: 0,
    revealedBy: "",
    guesses: state.guesses.slice(),
    updatedAt: Date.now()
  }));

  roomLastSeq = 1; // we're already on this round — don't reset our board
  const handle = makeRoomHandle(code, true);
  activeRoom = handle;
  handle._subscribe();
  startPresence();
  updateCounters();
  return code;
}

// Joins an existing room by code.
async function joinRoom(code){
  if (!leaderboardEnabled) throw new Error("Firebase not initialized");
  const snap = await withTimeout(getDoc(roomRef(code)));
  if (!snap.exists()) throw new Error("No room found with that code");

  roomLastSeq = null; // first snapshot will load the room's round
  const handle = makeRoomHandle(code, false);
  activeRoom = handle;
  handle._subscribe();
  startPresence();
  updateCounters();
}

/* ---------- Live presence (everyone sees everyone's movement) ---------- */
//
// Each player writes one small document to "roomPlayers" describing what
// they're currently typing, which letters came from hints, and their most
// recent action. Everyone in the room watches all of those documents, so
// every participant sees the same live roster.

const PRESENCE_COLLECTION = "roomPlayers";
const PRESENCE_STALE_MS = 3 * 60 * 1000;   // hide players silent for 3 min
const PRESENCE_HEARTBEAT_MS = 60 * 1000;   // re-announce ourselves every minute

let presenceUnsub = null;
let presenceTimer = null;
let presenceHeartbeat = null;
let lastPlayers = [];            // every player's presence doc (including ours)

function presenceDocRef(code){
  return doc(db, PRESENCE_COLLECTION, `${code.toUpperCase()}_${docIdFor(state.playerName || "player")}`);
}

// Debounced so fast typing doesn't spam the database. Our own row on
// screen updates instantly; friends see it about a fifth of a second later.
function schedulePresence(){
  if (!activeRoom || !state.playerName) return;
  renderFriends();
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(writePresence, 200);
}

function writePresence(){
  if (!activeRoom || !state.playerName || !leaderboardEnabled) return;
  const data = {
    room: activeRoom.code,
    name: state.playerName.slice(0, 16),
    typed: state.slots.map(s => s || " ").join(""),
    locked: state.locked.map(b => (b ? "1" : "0")).join(""),
    updatedAt: Date.now()
  };
  setDoc(presenceDocRef(activeRoom.code), data)
    .catch(e => console.warn("presence write failed", e));
}

function startPresence(){
  stopPresence();
  if (!activeRoom || !leaderboardEnabled) return;
  const q = query(collection(db, PRESENCE_COLLECTION), where("room", "==", activeRoom.code));
  presenceUnsub = onSnapshot(q, (snap) => {
    const me = (state.playerName || "").toLowerCase();
    lastPlayers = snap.docs.map(d => d.data());

    renderFriends();
  }, (err) => console.warn("presence subscription error", err));

  presenceHeartbeat = setInterval(() => { renderFriends(); writePresence(); }, PRESENCE_HEARTBEAT_MS);
  writePresence();
}

function stopPresence(){
  clearTimeout(presenceTimer);
  clearInterval(presenceHeartbeat);
  if (presenceUnsub) presenceUnsub();
  presenceUnsub = null;
  presenceHeartbeat = null;
  lastPlayers = [];
}

// Removes our presence document (called when leaving a room).
function clearMyPresence(code){
  if (!leaderboardEnabled || !code || !state.playerName) return;
  deleteDoc(presenceDocRef(code)).catch(e => console.warn("presence delete failed", e));
}

function miniTilesHtml(typed, locked){
  const len = Math.max((typed || "").length, 1);
  const t = (typed || "").padEnd(len, " ");
  const l = (locked || "").padEnd(len, "0");
  return t.split("").map((ch, i) => {
    const letter = ch.trim();
    const isHint = l[i] === "1";
    return `<span class="mini-tile${letter ? " filled" : ""}${isHint ? " hint" : ""}">${escapeHtml(letter)}</span>`;
  }).join("");
}

function renderFriends(){
  if (!activeRoom){
    friendsPanel.style.display = "none";
    return;
  }
  friendsPanel.style.display = "block";

  const me = state.playerName || "You";
  const now = Date.now();
  const others = lastPlayers.filter(p =>
    (p.name || "").toLowerCase() !== me.toLowerCase() &&
    now - (p.updatedAt || 0) < PRESENCE_STALE_MS
  );

  // Our own row comes straight from the live board, so it never lags.
  const rows = [
    { name: me, isSelf: true,
      typed: state.slots.map(s => s || " ").join(""),
      locked: state.locked.map(b => (b ? "1" : "0")).join("") },
    ...others
  ];

  let html = `<div class="friends-title">LIVE IN ROOM · ${rows.length} ${rows.length === 1 ? "PLAYER" : "PLAYERS"}</div>`;
  html += rows.map(p => `
    <div class="friend-row${p.isSelf ? " self" : ""}">
      <span class="friend-name">${escapeHtml(p.name || "—")}${p.isSelf ? " (you)" : ""}</span>
      <span class="mini-tiles">${miniTilesHtml(p.typed, p.locked)}</span>
    </div>`).join("");

  if (!others.length){
    html += `<div class="friends-empty">Waiting for friends to join…</div>`;
  }
  friendsPanel.innerHTML = html;
}

/* ---------- Word lists (see words.js) ---------- */

const LENGTHS = [4, 5, 6];
const ANSWER_WORDS = {};
const VALID_GUESSES = {};
LENGTHS.forEach((n) => {
  const answers = ANSWER_WORDS_RAW[n].split(" ");
  ANSWER_WORDS[n] = answers;
  VALID_GUESSES[n] = new Set(answers.concat(EXTRA_WORDS_RAW[n].split(" ")));
});

/* ---------- Persistent best score & player name ---------- */

const BEST_KEY = "wordleInfiniteBest";
const NAME_KEY = "wordleInfiniteName";

function loadBest(){
  try{
    const saved = localStorage.getItem(BEST_KEY);
    return saved ? parseInt(saved, 10) || 0 : 0;
  } catch (e){
    return 0;
  }
}

function saveBest(value){
  try{
    localStorage.setItem(BEST_KEY, String(value));
  } catch (e){
    // storage unavailable (e.g. private browsing) — best just won't persist
  }
}

function loadName(){
  try{
    return localStorage.getItem(NAME_KEY) || "";
  } catch (e){
    return "";
  }
}

function saveName(name){
  try{
    localStorage.setItem(NAME_KEY, name);
  } catch (e){
    // storage unavailable — name just won't be remembered next visit
  }
}

/* ---------- Game state ---------- */

const LENGTH_KEY = "wordleInfiniteLength";
const REVEAL_COSTS = { 4: 400, 5: 500, 6: 600 };

function loadLength(){
  try {
    const n = parseInt(localStorage.getItem(LENGTH_KEY), 10);
    return LENGTHS.includes(n) ? n : 5;
  } catch (e){ return 5; }
}

// Current word length (4, 5 or 6). Changes with the picker, or follows the
// shared answer when we're in a room.
let WORD_LENGTH = loadLength();
const revealCost = () => REVEAL_COSTS[WORD_LENGTH];
const MAX_GUESSES = 6;
const HINT_COST = 150;
const ROUND_WIN_POINTS = 500;

const state = {
  answer: "",
  round: 1,
  streak: 0,
  best: loadBest(),
  points: 0,
  playerName: loadName(),
  guesses: [],        // array of submitted guesses
  results: [],         // array of result arrays (one per submitted guess) e.g. ['correct','absent',...]
  slots: [],           // current (unsubmitted) guess, letter per position
  locked: [],          // which slots were filled by a hint
  gameOver: false,
  keyStatus: {}        // letter -> 'correct' | 'present' | 'absent'
};

// The active room, or null when not in one. Set by createRoom / joinRoom
// above (see makeRoomHandle for its methods).
let activeRoom = null;



/* ---------- DOM refs ---------- */

const boardEl = document.getElementById("board");
const keyboardEl = document.getElementById("keyboard");
const toastEl = document.getElementById("toast");
const messageRail = document.getElementById("messageRail");
const roundValueEl = document.getElementById("roundValue");
const streakValueEl = document.getElementById("streakValue");
const bestValueEl = document.getElementById("bestValue");
const pointsValueEl = document.getElementById("pointsValue");
const restartBtn = document.getElementById("restartBtn");
const subtitleText = document.getElementById("subtitleText");
const hintBtn = document.getElementById("hintBtn");
const revealBtn = document.getElementById("revealBtn");
const revealCostEl = document.getElementById("revealCost");
const lengthPicker = document.getElementById("lengthPicker");
const friendsPanel = document.getElementById("friendsPanel");
const roomCodeBig = document.getElementById("roomCodeBig");
const roomCopyBtn = document.getElementById("roomCopyBtn");

const nameOverlay = document.getElementById("nameOverlay");
const nameInput = document.getElementById("nameInput");
const nameSubmitBtn = document.getElementById("nameSubmitBtn");
const nameHint = document.getElementById("nameHint");

const leaderboardPanel = document.getElementById("leaderboardPanel");
const leaderboardList = document.getElementById("leaderboardList");
const leaderboardDot = document.getElementById("leaderboardDot");

const roomBtn = document.getElementById("roomBtn");
const roomLabel = document.getElementById("roomLabel");
const roomOverlay = document.getElementById("roomOverlay");
const roomStatusText = document.getElementById("roomStatusText");
const roomJoinFields = document.getElementById("roomJoinFields");
const roomCodeInput = document.getElementById("roomCodeInput");
const roomJoinBtn = document.getElementById("roomJoinBtn");
const roomCreateBtn = document.getElementById("roomCreateBtn");
const roomLeaveBtn = document.getElementById("roomLeaveBtn");
const roomHint = document.getElementById("roomHint");
const roomCloseBtn = document.getElementById("roomCloseBtn");

const KEY_ROWS = [
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l"],
  ["enter","z","x","c","v","b","n","m","back"]
];

/* ---------- Name entry ---------- */

async function startWithName(name){
  const trimmed = name.trim().slice(0, 16);
  if (!trimmed){
    nameHint.textContent = "Please enter a name.";
    return;
  }
  state.playerName = trimmed;
  saveName(trimmed);
  subtitleText.textContent = `playing as ${trimmed}`;
  nameOverlay.classList.remove("show");
  newRound(true);
  updateCounters();

  const cloudData = await loadPlayerData(trimmed);
  state.best = Math.max(state.best, cloudData.best);
  state.points = cloudData.points;
  saveBest(state.best);
  updateCounters();
}

nameSubmitBtn.addEventListener("click", () => startWithName(nameInput.value));
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startWithName(nameInput.value);
});

function showNameOverlay(){
  nameInput.value = state.playerName || "";
  nameHint.textContent = "";
  nameOverlay.classList.add("show");
  nameInput.focus();
}

/* ---------- Leaderboard panel (live) ---------- */

function renderLeaderboardRows(rows){
  if (!rows.length){
    leaderboardList.innerHTML = `<li class="leaderboard-empty">No scores yet — be the first!</li>`;
    return;
  }
  leaderboardList.innerHTML = "";
  rows.forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "leaderboard-row";
    if (state.playerName && row.name && row.name.toLowerCase() === state.playerName.toLowerCase()){
      li.classList.add("me");
    }
    li.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(row.name || "—")}</span>
      <span class="lb-score">${row.best ?? 0}</span>
      <span class="lb-points">${row.points ?? 0}</span>
    `;
    leaderboardList.appendChild(li);
  });
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function startLeaderboardSubscription(){
  let settled = false;

  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    leaderboardDot.classList.remove("live");
    leaderboardDot.classList.add("error");
    leaderboardList.innerHTML = `<li class="leaderboard-empty">Couldn't connect to the leaderboard.<br>Check your network/firewall, or see the console (F12).</li>`;
  }, 8000);

  subscribeLeaderboard(
    10,
    (rows) => {
      settled = true;
      clearTimeout(timeoutId);
      leaderboardDot.classList.remove("error");
      leaderboardDot.classList.add("live");
      renderLeaderboardRows(rows);
    },
    (err) => {
      settled = true;
      clearTimeout(timeoutId);
      leaderboardDot.classList.remove("live");
      leaderboardDot.classList.add("error");
      leaderboardList.innerHTML = `<li class="leaderboard-empty">Couldn't load leaderboard.<br>Check the browser console (F12) for details.</li>`;
    }
  );
}

/* ---------- Play with friends (room) ---------- */

function refreshRoomUI(){
  if (activeRoom){
    roomBtn.classList.add("in-room");
    roomLabel.textContent = `ROOM: ${activeRoom.code}`;
    roomStatusText.textContent = `${WORD_LENGTH}-letter room — share the code with friends`;
    roomCodeBig.textContent = activeRoom.code;
    roomCodeBig.style.display = "block";
    roomCopyBtn.style.display = "block";
    roomJoinFields.style.display = "none";
    roomLeaveBtn.style.display = "block";
  } else {
    roomBtn.classList.remove("in-room");
    roomLabel.textContent = "PLAY WITH FRIENDS";
    roomStatusText.textContent = "Not in a room";
    roomCodeBig.style.display = "none";
    roomCopyBtn.style.display = "none";
    roomJoinFields.style.display = "block";
    roomLeaveBtn.style.display = "none";
  }
  renderFriends();
  updateCounters();
  refreshLengthPicker();
}

function leaveRoom(){
  if (activeRoom){
    clearMyPresence(activeRoom.code);
    activeRoom.leave();
  }
  stopPresence();
  activeRoom = null;
  refreshRoomUI();
}

// Best-effort cleanup if the tab is closed while in a room.
window.addEventListener("beforeunload", () => {
  if (activeRoom) clearMyPresence(activeRoom.code);
});

roomBtn.addEventListener("click", () => {
  roomHint.textContent = "";
  roomCodeInput.value = "";
  roomModeChoice = WORD_LENGTH;
  refreshRoomModes();
  refreshRoomUI();
  roomOverlay.classList.add("show");
});

roomCloseBtn.addEventListener("click", () => {
  roomOverlay.classList.remove("show");
});

// The mode (word length) the host picks for a new room.
let roomModeChoice = WORD_LENGTH;
const roomModes = document.getElementById("roomModes");

function refreshRoomModes(){
  roomModes.querySelectorAll("button").forEach((b) => {
    const on = Number(b.dataset.len) === roomModeChoice;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

roomModes.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-len]");
  if (!btn) return;
  roomModeChoice = Number(btn.dataset.len);
  refreshRoomModes();
});

roomCreateBtn.addEventListener("click", async () => {
  roomCreateBtn.disabled = true;
  roomHint.textContent = "Creating room…";
  const prevLength = WORD_LENGTH;
  try {
    // A new room starts fresh in the chosen mode.
    if (roomModeChoice !== WORD_LENGTH){
      setWordLength(roomModeChoice);
      newRound(true);
    }
    const code = await createRoom();
    refreshRoomUI();
    roomHint.textContent = `Room created (${roomModeChoice}-letter mode)! Friends can join with code ${code}.`;
  } catch (e) {
    console.error("createRoom failed:", e);
    if (prevLength !== WORD_LENGTH){ setWordLength(prevLength); newRound(true); }
    roomHint.textContent = `Couldn't create a room: ${describeRoomError(e)}`;
  } finally {
    roomCreateBtn.disabled = false;
  }
});

roomJoinBtn.addEventListener("click", async () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length < 4){
    roomHint.textContent = "Enter a valid room code.";
    return;
  }
  roomHint.textContent = "Joining…";
  try {
    await joinRoom(code);
    refreshRoomUI();
    roomHint.textContent = `Joined room ${code} (${WORD_LENGTH}-letter mode)!`;
  } catch (e) {
    console.error("joinRoom failed:", e);
    roomHint.textContent = e && e.message === "No room found with that code"
      ? "No room found with that code."
      : `Couldn't join: ${describeRoomError(e)}`;
  }
});

roomLeaveBtn.addEventListener("click", () => {
  leaveRoom();
  roomHint.textContent = "Left the room.";
});

roomCopyBtn.addEventListener("click", async () => {
  if (!activeRoom) return;
  try {
    await navigator.clipboard.writeText(activeRoom.code);
    roomHint.textContent = "Room code copied!";
  } catch (e) {
    roomHint.textContent = "Couldn't copy — select the code and copy it manually.";
  }
});

hintBtn.addEventListener("click", useHint);
revealBtn.addEventListener("click", useReveal);

/* ---------- Init ---------- */

function pickAnswer(len = WORD_LENGTH){
  const list = ANSWER_WORDS[len];
  return list[Math.floor(Math.random() * list.length)];
}

/* ---------- Word length picker ---------- */

function refreshLengthPicker(){
  document.querySelectorAll("#lengthPicker button, #startModes button").forEach((b) => {
    const on = Number(b.dataset.len) === WORD_LENGTH;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    // Only the host picks the word in a room, so everyone else follows.
    b.disabled = Boolean(activeRoom && !activeRoom.isHost);
  });
}

function setWordLength(n, { silent = false } = {}){
  if (!LENGTHS.includes(n)) return;
  WORD_LENGTH = n;
  if (!silent){
    try { localStorage.setItem(LENGTH_KEY, String(n)); } catch (e) { /* ignore */ }
  }
  refreshLengthPicker();
}

lengthPicker.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-len]");
  if (!btn || btn.disabled) return;
  const n = Number(btn.dataset.len);
  if (n === WORD_LENGTH) return;
  if (state.guesses.length > 0 && !state.gameOver){
    if (!confirm(`Switch to ${n}-letter words? The current round will be replaced with a new one.`)) return;
  }
  setWordLength(n);
  if (activeRoom){
    if (activeRoom.isHost) activeRoom.restartRoom();
    return;
  }
  newRound(true);
});

function newRound(keepRoundNumber, forcedAnswer){
  state.answer = forcedAnswer || pickAnswer();
  state.guesses = [];
  state.results = [];
  state.slots = new Array(WORD_LENGTH).fill("");
  state.locked = new Array(WORD_LENGTH).fill(false);
  state.gameOver = false;
  state.keyStatus = {};
  if (!keepRoundNumber) state.round += 1;
  schedulePresence();
  renderBoard();
  renderKeyboard();
  updateCounters();
  setMessage("");
}

function resetSession(){
  // In a room, only the host is allowed to pick the word — resetting
  // locally would desync from the shared board, so route it through
  // the room (host) or block it entirely (everyone else).
  if (activeRoom){
    if (activeRoom.isHost) activeRoom.restartRoom();
    return;
  }
  state.round = 1;
  state.streak = 0;
  newRound(true);
}

/* ---------- Rendering ---------- */

function renderBoard(){
  boardEl.innerHTML = "";
  boardEl.style.setProperty("--cols", WORD_LENGTH);
  for (let r = 0; r < MAX_GUESSES; r++){
    const rowEl = document.createElement("div");
    rowEl.className = "board-row";
    rowEl.id = `row-${r}`;
    const isActiveRow = r === state.guesses.length;
    const word = state.guesses[r] ?? (isActiveRow ? state.slots.join("") : "");
    const rowResult = state.results[r]; // undefined for rows not yet submitted
    for (let c = 0; c < WORD_LENGTH; c++){
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.id = `tile-${r}-${c}`;
      const inner = document.createElement("div");
      inner.className = "tile-inner";
      inner.textContent = word[c] ?? "";
      if (word[c] && isActiveRow) tile.classList.add("filled");
      if (isActiveRow && state.locked[c]) tile.classList.add("hint");
      if (rowResult){
        tile.classList.add(rowResult[c]);
        tile.style.setProperty("--reveal-bg", `var(--${rowResult[c]})`);
      }
      tile.appendChild(inner);
      rowEl.appendChild(tile);
    }
    boardEl.appendChild(rowEl);
  }
}

function renderKeyboard(){
  keyboardEl.innerHTML = "";
  KEY_ROWS.forEach(row => {
    const rowEl = document.createElement("div");
    rowEl.className = "key-row";
    row.forEach(k => {
      const keyEl = document.createElement("button");
      keyEl.type = "button";
      keyEl.dataset.key = k;
      keyEl.className = "key";
      if (k === "enter" || k === "back") keyEl.classList.add("wide");
      keyEl.textContent = k === "back" ? "⌫" : (k === "enter" ? "ENTER" : k);
      const status = state.keyStatus[k];
      if (status) keyEl.classList.add(status);
      keyEl.addEventListener("click", () => handleKey(k));
      rowEl.appendChild(keyEl);
    });
    keyboardEl.appendChild(rowEl);
  });
}

function updateCounters(){
  roundValueEl.textContent = String(state.round).padStart(3, "0");
  streakValueEl.textContent = activeRoom ? "—" : String(state.streak);
  bestValueEl.textContent = String(state.best);
  pointsValueEl.textContent = String(state.points);
  hintBtn.disabled = state.points < HINT_COST || state.gameOver;
  revealBtn.disabled = state.points < revealCost() || state.gameOver;
  revealCostEl.textContent = `${revealCost()} pts`;
}

function setMessage(html, kind){
  messageRail.innerHTML = html;
  messageRail.className = "message-rail" + (kind ? " " + kind : "");
}

function showToast(text){
  toastEl.textContent = text;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 1400);
}

/* ---------- Input handling ---------- */

function handleKey(key){
  if (state.gameOver) return;
  if (nameOverlay.classList.contains("show")) return;
  if (roomOverlay.classList.contains("show")) return;
  if (themeOverlay.classList.contains("show")) return;

  if (key === "back"){
    for (let i = WORD_LENGTH - 1; i >= 0; i--){
      if (state.slots[i] !== "" && !state.locked[i]){
        state.slots[i] = "";
        break;
      }
    }
    updateCurrentRow();
    return;
  }

  if (key === "enter"){
    submitGuess();
    return;
  }

  if (/^[a-z]$/.test(key)){
    const firstEmpty = state.slots.findIndex(s => s === "");
    if (firstEmpty !== -1){
      state.slots[firstEmpty] = key;
      updateCurrentRow();
    }
  }
}

function useHint(){
  if (state.gameOver){
    showToast("No active round");
    return;
  }
  if (state.points < HINT_COST){
    showToast("Not enough points");
    return;
  }
  const known = new Set();
  state.results.forEach(res => res.forEach((s, i) => { if (s === "correct") known.add(i); }));
  state.locked.forEach((isLocked, i) => { if (isLocked) known.add(i); });
  const remaining = Array.from({ length: WORD_LENGTH }, (_, i) => i).filter(i => !known.has(i));
  if (remaining.length === 0){
    showToast("Every letter is already revealed");
    return;
  }
  const idx = remaining[Math.floor(Math.random() * remaining.length)];
  state.slots[idx] = state.answer[idx];
  state.locked[idx] = true;
  state.points -= HINT_COST;
  updateCounters();
  updateCurrentRow();
  if (state.playerName){
    spendPoints(state.playerName, state.points);
  }
}

// Ends the round by showing the answer. No points are awarded, and the
// streak is left as it is. Called directly when the paying player clicks
// the button, and for everyone else in a room when the live update arrives.
function showRevealedAnswer(){
  if (state.gameOver) return;
  state.gameOver = true;
  updateCounters();
  setMessage(`THE ANSWER WAS <span class="answer-reveal">${state.answer.toUpperCase()}</span>`, "reveal");
  const seqAtEnd = activeRoom ? activeRoom.getSeq() : null;
  setTimeout(() => advanceRound(seqAtEnd, false), 5000);
}

function useReveal(){
  if (state.gameOver){
    showToast("No active round");
    return;
  }
  if (state.points < revealCost()){
    showToast("Not enough points");
    return;
  }
  const msg = activeRoom
    ? `Reveal the answer for ${revealCost()} points? This ends the round for everyone in the room, and no points are awarded.`
    : `Reveal the answer for ${revealCost()} points? No points are awarded for this round.`;
  if (!confirm(msg)) return;

  state.points -= revealCost();
  if (state.playerName) spendPoints(state.playerName, state.points);
  if (activeRoom){
    activeRoom.revealAnswer();
  }
  showRevealedAnswer();
}

function updateCurrentRow(){
  const r = state.guesses.length;
  const rowEl = document.getElementById(`row-${r}`);
  if (!rowEl) return;
  for (let c = 0; c < WORD_LENGTH; c++){
    const tile = document.getElementById(`tile-${r}-${c}`);
    const inner = tile.querySelector(".tile-inner");
    const letter = state.slots[c] ?? "";
    inner.textContent = letter;
    tile.classList.toggle("filled", Boolean(letter));
    tile.classList.toggle("hint", Boolean(state.locked[c]));
  }
  schedulePresence();
}

function shakeRow(r){
  const rowEl = document.getElementById(`row-${r}`);
  rowEl.querySelectorAll(".tile").forEach(t => {
    t.classList.add("shake");
    setTimeout(() => t.classList.remove("shake"), 400);
  });
}

function submitGuess(){
  const r = state.guesses.length;

  if (state.slots.some(s => s === "")){
    showToast("Not enough letters");
    shakeRow(r);
    return;
  }

  const guess = state.slots.join("");

  if (!VALID_GUESSES[WORD_LENGTH].has(guess)){
    showToast("Not in word list");
    shakeRow(r);
    return;
  }

  if (activeRoom){
    // In a room, the guess goes through the shared document and shows up
    // on every board (ours included) when the live update arrives.
    activeRoom.sendGuess(guess);
  } else {
    commitGuess(guess);
  }
}

// Applies a guess (ours, a roommate's, or the host's) to the board:
// evaluates it, reveals the row, updates the keyboard, and handles
// win/loss. Used for every guess in both solo and room play.
function commitGuess(guess){
  const r = state.guesses.length;
  const result = evaluateGuess(guess, state.answer);
  state.guesses.push(guess);
  state.results.push(result);
  state.slots = new Array(WORD_LENGTH).fill("");
  state.locked = new Array(WORD_LENGTH).fill(false);
  schedulePresence();

  revealRow(r, guess, result, () => {
    result.forEach((status, i) => {
      const letter = guess[i];
      const rank = { absent: 0, present: 1, correct: 2 };
      if (!state.keyStatus[letter] || rank[status] > rank[state.keyStatus[letter]]){
        state.keyStatus[letter] = status;
      }
    });
    renderKeyboard();

    const won = guess === state.answer;
    const lost = !won && state.guesses.length >= MAX_GUESSES;

    if (won){
      state.gameOver = true;
      state.points += ROUND_WIN_POINTS;
      if (state.playerName) awardPoints(state.playerName, ROUND_WIN_POINTS);
      // Streaks are only counted in solo play, not inside rooms.
      if (!activeRoom){
        state.streak += 1;
        state.best = Math.max(state.best, state.streak);
        saveBest(state.best);
        if (state.playerName) submitScore(state.playerName, state.best);
      }
      updateCounters();
      setMessage(`Solved in ${state.guesses.length}/${MAX_GUESSES} — +${ROUND_WIN_POINTS} points — next round starting…`, "win");
      const seqAtEnd = activeRoom ? activeRoom.getSeq() : null;
      setTimeout(() => advanceRound(seqAtEnd, false), 1600);
    } else if (lost){
      state.gameOver = true;
      if (!activeRoom) state.streak = 0;
      state.round = 0;
      updateCounters();
      setMessage(`THE ANSWER WAS <span class="answer-reveal">${state.answer.toUpperCase()}</span>`, "lose");
      const seqAtEnd = activeRoom ? activeRoom.getSeq() : null;
      setTimeout(() => advanceRound(seqAtEnd, true), 5000);
    } else {
      renderBoard();
    }
  });
}

// Moves on to the next round. Solo play always picks its own word.
// In a room, only the host picks the next word (and broadcasts it) —
// everyone else just waits for that broadcast so the whole room stays
// on the same word.
function advanceRound(seqAtEnd, lost){
  if (activeRoom){
    activeRoom.startNextRound(seqAtEnd, lost);
  } else {
    newRound(false);
  }
}

// Silently applies an already-submitted guess when catching up on a
// round in progress (e.g. just joined a room mid-round). No animation,
// no win/loss bookkeeping or points — those already happened for
// whoever was present when it was first submitted.
function replayGuess(guess){
  const result = evaluateGuess(guess, state.answer);
  state.guesses.push(guess);
  state.results.push(result);
  result.forEach((status, i) => {
    const letter = guess[i];
    const rank = { absent: 0, present: 1, correct: 2 };
    if (!state.keyStatus[letter] || rank[status] > rank[state.keyStatus[letter]]){
      state.keyStatus[letter] = status;
    }
  });
}

function evaluateGuess(guess, answer){
  const result = new Array(WORD_LENGTH).fill("absent");
  const answerLetters = answer.split("");
  const used = new Array(WORD_LENGTH).fill(false);

  // First pass: correct letters
  for (let i = 0; i < WORD_LENGTH; i++){
    if (guess[i] === answerLetters[i]){
      result[i] = "correct";
      used[i] = true;
    }
  }
  // Second pass: present letters
  for (let i = 0; i < WORD_LENGTH; i++){
    if (result[i] === "correct") continue;
    const idx = answerLetters.findIndex((l, j) => l === guess[i] && !used[j]);
    if (idx !== -1){
      result[i] = "present";
      used[idx] = true;
    }
  }
  return result;
}

function revealRow(r, guess, result, onDone){
  for (let c = 0; c < WORD_LENGTH; c++){
    const tile = document.getElementById(`tile-${r}-${c}`);
    tile.style.setProperty("--flip-delay", `${c * 0.12}s`);
    tile.style.setProperty("--reveal-bg", `var(--${result[c]})`);
    tile.classList.add("flip");
    tile.classList.add(result[c]);
  }
  const totalDelay = WORD_LENGTH * 120 + 550;
  setTimeout(onDone, totalDelay);
}

/* ---------- Event listeners ---------- */

document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "backspace") handleKey("back");
  else if (k === "enter") handleKey("enter");
  else if (/^[a-z]$/.test(k)) handleKey(k);
});

restartBtn.addEventListener("click", resetSession);


/* ---------- Theme (background, font and game colours) ---------- */

const THEME_KEY = "wordleInfiniteTheme";
const MAX_STOPS = 5;

const DEFAULT_TILES = { correct: "#5c8f6b", present: "#c9a227", absent: "#34383f" };
const DEFAULT_ACCENT = "#c9a227";

const bgPreset = (stops, angle = 135, shape = "linear") => ({ stops, angle, shape });
const fontAuto = { auto: true, stops: ["#f2efe9"], angle: 90 };
const fontOf = (...stops) => ({ auto: false, stops, angle: 90 });

const DEFAULT_THEME = {
  bg: bgPreset(["#1c2128", "#14171c"], 160, "radial"),
  text: fontAuto,
  accent: null,   // null = default gold
  tiles: null     // null = default green / gold / grey
};

const THEME_PRESETS = [
  { name: "Default",   bg: bgPreset(["#1c2128", "#14171c"], 160, "radial"), text: fontAuto },
  { name: "Sunset",    bg: bgPreset(["#ff7e5f", "#feb47b", "#7f53ac"]), text: fontOf("#ffffff") },
  { name: "Ocean",     bg: bgPreset(["#0f2027", "#203a43", "#2c5364"], 160), text: fontOf("#a8edea", "#fed6e3") },
  { name: "Neon",      bg: bgPreset(["#0b0b1a"]), text: fontOf("#00f5d4", "#f15bb5", "#fee440"), accent: "#f15bb5" },
  { name: "Paper",     bg: bgPreset(["#f4efe6"]), text: fontOf("#2b2a28") },
  { name: "Forest",    bg: bgPreset(["#134e5e", "#71b280"], 150), text: fontOf("#fdfbf3") },
  { name: "Berry",     bg: bgPreset(["#42275a", "#734b6d"]), text: fontOf("#ffd6e8", "#fff2a8") },
  { name: "Rainbow",   bg: bgPreset(["#ff4d4d", "#ffd93d", "#4dff88", "#4da6ff", "#b44dff"], 90), text: fontOf("#ffffff"), accent: "#ffffff" },
  { name: "Aurora",    bg: bgPreset(["#0f0c29", "#302b63", "#24c6dc", "#514a9d"], 160), text: fontOf("#c9fff1", "#e0c3fc"), accent: "#24c6dc" },
  { name: "Candy",     bg: bgPreset(["#ffafbd", "#ffc3a0", "#c2e9fb"]), text: fontOf("#5a2a4a"), accent: "#e0457b" },
  { name: "Lava",      bg: bgPreset(["#200122", "#6f0000", "#ff512f"], 160), text: fontOf("#fff1d6", "#ffd166"), accent: "#ff9f1c" },
  { name: "Mint",      bg: bgPreset(["#d4fc79", "#96e6a1"]), text: fontOf("#12372a"), accent: "#1b998b" },
  { name: "Midnight",  bg: bgPreset(["#000428", "#004e92"], 160), text: fontOf("#e6f0ff"), accent: "#4ea8de" },
  { name: "Cherry",    bg: bgPreset(["#3a0519", "#8e1b3a"]), text: fontOf("#ffe3ea", "#ffb3c6"), accent: "#ff758f" },
  { name: "Gold",      bg: bgPreset(["#1a1305", "#3a2a07"], 160), text: fontOf("#ffe9a8", "#ffd34d", "#f6b100"), accent: "#ffd34d" },
  { name: "Lavender",  bg: bgPreset(["#e0c3fc", "#8ec5fc"]), text: fontOf("#2d1e4f"), accent: "#7b4bd6" },
  { name: "Peach",     bg: bgPreset(["#ffecd2", "#fcb69f"]), text: fontOf("#5c2a1e"), accent: "#d1553a" },
  { name: "Slate",     bg: bgPreset(["#2c3e50", "#4ca1af"]), text: fontOf("#ffffff") },
  { name: "Cyber",     bg: bgPreset(["#0d0221", "#261447", "#ff2a6d"], 135), text: fontOf("#05d9e8", "#ff2a6d"), accent: "#05d9e8",
    tiles: { correct: "#05d9e8", present: "#ff2a6d", absent: "#2a1a4a" } },
  { name: "Monochrome", bg: bgPreset(["#ffffff", "#d9d9d9"]), text: fontOf("#111111"), accent: "#111111",
    tiles: { correct: "#111111", present: "#777777", absent: "#bbbbbb" } },
  { name: "Tropical",  bg: bgPreset(["#00c9ff", "#92fe9d"]), text: fontOf("#06323a"), accent: "#ff6f61" },
  { name: "Galaxy",    bg: bgPreset(["#0b0c2a", "#3b1c5a", "#8e2de2", "#4a00e0"], 160), text: fontOf("#f3e8ff", "#a5f3fc"), accent: "#c084fc" }
];

const SWATCHES = [
  "#000000", "#14171c", "#2b2a28", "#4a4e57", "#8b8f97", "#d9d9d9", "#f2efe9", "#ffffff",
  "#7f1d1d", "#ef4444", "#ff7e5f", "#f97316", "#ffb347", "#facc15", "#fff2a8", "#a3e635",
  "#166534", "#22c55e", "#4dff88", "#14b8a6", "#24c6dc", "#06b6d4", "#4da6ff", "#2563eb",
  "#1e3a8a", "#4338ca", "#7c3aed", "#b44dff", "#c084fc", "#ec4899", "#ff758f", "#f15bb5"
];

const themeBtn = document.getElementById("themeBtn");
const themeOverlay = document.getElementById("themeOverlay");
const themePresetsEl = document.getElementById("themePresets");
const themePreviewEl = document.getElementById("themePreview");
const themePreviewTextEl = document.getElementById("themePreviewText");
const themeCloseBtn = document.getElementById("themeCloseBtn");
const themeResetBtn = document.getElementById("themeResetBtn");
const bgStopsEl = document.getElementById("bgStops");
const bgSwatchesEl = document.getElementById("bgSwatches");
const bgAngleRow = document.getElementById("bgAngleRow");
const bgAngleInput = document.getElementById("bgAngle");
const bgShapeSel = document.getElementById("bgShape");
const textAutoInput = document.getElementById("textAuto");
const textStopsWrap = document.getElementById("textStopsWrap");
const textStopsEl = document.getElementById("textStops");
const textSwatchesEl = document.getElementById("textSwatches");
const textAngleRow = document.getElementById("textAngleRow");
const textAngleInput = document.getElementById("textAngle");
const accentInput = document.getElementById("accentColor");
const tileCorrectInput = document.getElementById("tileCorrect");
const tilePresentInput = document.getElementById("tilePresent");
const tileAbsentInput = document.getElementById("tileAbsent");
const gameColorsResetBtn = document.getElementById("gameColorsReset");

const clone = (o) => JSON.parse(JSON.stringify(o));
const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const clampAngle = (v, fallback) => Number.isFinite(+v) ? Math.max(0, Math.min(360, +v)) : fallback;

function sanitizeTheme(t){
  const out = clone(DEFAULT_THEME);
  if (!t || typeof t !== "object") return out;
  const cleanStops = (arr, fallback) => {
    const list = Array.isArray(arr) ? arr.filter(isHex).slice(0, MAX_STOPS) : [];
    return list.length ? list : fallback;
  };
  if (t.bg){
    out.bg.stops = cleanStops(t.bg.stops, out.bg.stops);
    out.bg.angle = clampAngle(t.bg.angle, out.bg.angle);
    out.bg.shape = t.bg.shape === "radial" ? "radial" : "linear";
  }
  if (t.text){
    out.text = { auto: Boolean(t.text.auto), stops: cleanStops(t.text.stops, fontAuto.stops.slice()), angle: clampAngle(t.text.angle, 90) };
  }
  out.accent = isHex(t.accent) ? t.accent : null;
  if (t.tiles && isHex(t.tiles.correct) && isHex(t.tiles.present) && isHex(t.tiles.absent)){
    out.tiles = { correct: t.tiles.correct, present: t.tiles.present, absent: t.tiles.absent };
  }
  return out;
}

function loadTheme(){
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw ? sanitizeTheme(JSON.parse(raw)) : clone(DEFAULT_THEME);
  } catch (e){
    return clone(DEFAULT_THEME);
  }
}

function saveTheme(){
  try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch (e) { /* ignore */ }
}

let theme = loadTheme();

function hexLuminance(hex){
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function gradientCss(cfg){
  const stops = cfg.stops;
  if (stops.length === 1) return `linear-gradient(${stops[0]}, ${stops[0]})`;
  const list = stops.join(", ");
  return cfg.shape === "radial"
    ? `radial-gradient(circle at 50% 0%, ${list})`
    : `linear-gradient(${cfg.angle}deg, ${list})`;
}

function applyTheme(){
  const root = document.documentElement;
  const avgLum = theme.bg.stops.reduce((sum, c) => sum + hexLuminance(c), 0) / theme.bg.stops.length;
  const lightSurface = avgLum > 0.4;

  root.style.setProperty("--page-bg", gradientCss(theme.bg));

  let paper;
  let gradientText = false;
  if (theme.text.auto){
    paper = lightSurface ? "#1a1d22" : "#f2efe9";
  } else {
    paper = theme.text.stops[0];
    gradientText = theme.text.stops.length > 1;
  }
  // Panels switch to the light style when the text is dark (and vice versa),
  // so text always has a contrasting surface behind it.
  const darkText = theme.text.auto ? lightSurface : theme.text.stops.reduce((a, c) => a + hexLuminance(c), 0) / theme.text.stops.length < 0.4;
  root.dataset.surface = darkText ? "light" : "dark";
  root.style.setProperty("--paper", paper);
  root.style.setProperty("--paper-dim", `color-mix(in srgb, ${paper} 68%, transparent)`);
  root.style.setProperty("--text-gradient",
    gradientText ? gradientCss({ stops: theme.text.stops, angle: theme.text.angle, shape: "linear" }) : "none");
  root.classList.toggle("text-gradient", gradientText);

  // Game colours: inline values only when customised, so the defaults
  // (and the light-surface adjustments in the CSS) still apply otherwise.
  const setOrClear = (name, value) => value ? root.style.setProperty(name, value) : root.style.removeProperty(name);
  setOrClear("--accent", theme.accent);
  setOrClear("--correct", theme.tiles && theme.tiles.correct);
  setOrClear("--present", theme.tiles && theme.tiles.present);
  setOrClear("--absent", theme.tiles && theme.tiles.absent);
  setOrClear("--absent-text", theme.tiles && (hexLuminance(theme.tiles.absent) > 0.4 ? "#1a1d22" : "#8b8f97"));

  // Live preview swatch inside the theme panel.
  themePreviewEl.style.backgroundImage = gradientCss(theme.bg);
  if (gradientText){
    themePreviewTextEl.style.backgroundImage = gradientCss({ stops: theme.text.stops, angle: theme.text.angle, shape: "linear" });
    themePreviewTextEl.style.webkitBackgroundClip = "text";
    themePreviewTextEl.style.backgroundClip = "text";
    themePreviewTextEl.style.color = "transparent";
  } else {
    themePreviewTextEl.style.backgroundImage = "none";
    themePreviewTextEl.style.color = paper;
  }
  themePreviewEl.style.setProperty("--pv-accent", theme.accent || (darkText ? "#b8860b" : DEFAULT_ACCENT));
  const t = theme.tiles || DEFAULT_TILES;
  themePreviewEl.style.setProperty("--pv-correct", t.correct);
  themePreviewEl.style.setProperty("--pv-present", t.present);
  themePreviewEl.style.setProperty("--pv-absent", t.absent);
}

// Which colour box is selected in each editor (swatches paint the selected one).
const activeStop = new WeakMap();

function renderStopEditor(container, stops, onChange){
  container.innerHTML = "";
  if (!activeStop.has(container) || activeStop.get(container) >= stops.length) activeStop.set(container, 0);
  stops.forEach((color, i) => {
    const wrap = document.createElement("div");
    wrap.className = "stop" + (activeStop.get(container) === i ? " active" : "");
    const input = document.createElement("input");
    input.type = "color";
    input.value = color;
    input.setAttribute("aria-label", `Colour ${i + 1}`);
    const select = () => {
      activeStop.set(container, i);
      container.querySelectorAll(".stop").forEach((el, k) => el.classList.toggle("active", k === i));
    };
    input.addEventListener("focus", select);
    input.addEventListener("click", select);
    input.addEventListener("input", () => { stops[i] = input.value; select(); onChange(false); });
    wrap.appendChild(input);
    if (stops.length > 1){
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "stop-remove";
      rm.textContent = "×";
      rm.title = "Remove colour";
      rm.setAttribute("aria-label", `Remove colour ${i + 1}`);
      rm.addEventListener("click", () => { stops.splice(i, 1); onChange(true); });
      wrap.appendChild(rm);
    }
    container.appendChild(wrap);
  });
  if (stops.length < MAX_STOPS){
    const add = document.createElement("button");
    add.type = "button";
    add.className = "stop-add";
    add.textContent = "+";
    add.title = "Add colour (makes a gradient)";
    add.setAttribute("aria-label", "Add colour");
    add.addEventListener("click", () => {
      stops.push(stops[stops.length - 1]);
      activeStop.set(container, stops.length - 1);
      onChange(true);
    });
    container.appendChild(add);
  }
}

function renderSwatches(container, stopsContainer, getStops){
  if (container.childElementCount) return;
  SWATCHES.forEach((hex) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = hex;
    b.title = hex;
    b.setAttribute("aria-label", `Use ${hex}`);
    b.addEventListener("click", () => {
      const stops = getStops();
      stops[activeStop.get(stopsContainer) ?? 0] = hex;
      syncThemeUI(true);
    });
    container.appendChild(b);
  });
}

function syncThemeUI(rebuildStops){
  if (rebuildStops){
    renderStopEditor(bgStopsEl, theme.bg.stops, syncThemeUI);
    renderStopEditor(textStopsEl, theme.text.stops, syncThemeUI);
  }
  const bgGradient = theme.bg.stops.length > 1;
  bgAngleRow.style.display = bgGradient ? "flex" : "none";
  bgAngleInput.disabled = theme.bg.shape === "radial";
  bgAngleInput.value = theme.bg.angle;
  bgShapeSel.value = theme.bg.shape;

  textAutoInput.checked = theme.text.auto;
  textStopsWrap.style.display = theme.text.auto ? "none" : "block";
  textAngleRow.style.display = (!theme.text.auto && theme.text.stops.length > 1) ? "flex" : "none";
  textAngleInput.value = theme.text.angle;

  accentInput.value = theme.accent || DEFAULT_ACCENT;
  const t = theme.tiles || DEFAULT_TILES;
  tileCorrectInput.value = t.correct;
  tilePresentInput.value = t.present;
  tileAbsentInput.value = t.absent;

  applyTheme();
  saveTheme();
}

function renderPresets(){
  themePresetsEl.innerHTML = "";
  THEME_PRESETS.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "preset";
    b.title = p.name;
    b.style.background = gradientCss(p.bg);
    const label = document.createElement("span");
    label.textContent = "Aa";
    if (!p.text.auto && p.text.stops.length > 1){
      label.style.backgroundImage = `linear-gradient(90deg, ${p.text.stops.join(", ")})`;
      label.style.webkitBackgroundClip = "text";
      label.style.backgroundClip = "text";
      label.style.color = "transparent";
    } else {
      label.style.color = p.text.auto ? "#f2efe9" : p.text.stops[0];
    }
    b.appendChild(label);
    const name = document.createElement("small");
    name.textContent = p.name;
    const presetLum = p.bg.stops.reduce((sum, col) => sum + hexLuminance(col), 0) / p.bg.stops.length;
    name.style.color = presetLum > 0.4 ? "#2b2a28" : "#ffffff";
    b.appendChild(name);
    b.addEventListener("click", () => {
      theme = sanitizeTheme(p);
      syncThemeUI(true);
    });
    themePresetsEl.appendChild(b);
  });
}

function openThemeOverlay(){
  syncThemeUI(true);
  themeOverlay.classList.add("show");
}

function closeThemeOverlay(){
  themeOverlay.classList.remove("show");
}

themeBtn.addEventListener("click", openThemeOverlay);
themeCloseBtn.addEventListener("click", closeThemeOverlay);
themeOverlay.addEventListener("click", (e) => { if (e.target === themeOverlay) closeThemeOverlay(); });
themeOverlay.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape") closeThemeOverlay();
});
themeResetBtn.addEventListener("click", () => {
  theme = clone(DEFAULT_THEME);
  syncThemeUI(true);
});
gameColorsResetBtn.addEventListener("click", () => {
  theme.accent = null;
  theme.tiles = null;
  syncThemeUI(false);
});
bgAngleInput.addEventListener("input", () => { theme.bg.angle = +bgAngleInput.value; syncThemeUI(false); });
bgShapeSel.addEventListener("change", () => { theme.bg.shape = bgShapeSel.value; syncThemeUI(false); });
textAutoInput.addEventListener("change", () => { theme.text.auto = textAutoInput.checked; syncThemeUI(false); });
textAngleInput.addEventListener("input", () => { theme.text.angle = +textAngleInput.value; syncThemeUI(false); });
accentInput.addEventListener("input", () => { theme.accent = accentInput.value; syncThemeUI(false); });
function onTileInput(){
  theme.tiles = { correct: tileCorrectInput.value, present: tilePresentInput.value, absent: tileAbsentInput.value };
  syncThemeUI(false);
}
[tileCorrectInput, tilePresentInput, tileAbsentInput].forEach((el) => el.addEventListener("input", onTileInput));

renderPresets();
renderSwatches(bgSwatchesEl, bgStopsEl, () => theme.bg.stops);
renderSwatches(textSwatchesEl, textStopsEl, () => theme.text.stops);
applyTheme();

/* ---------- Start screen: mode + mood ---------- */

const startModes = document.getElementById("startModes");
const startMoods = document.getElementById("startMoods");

startModes.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-len]");
  if (btn) setWordLength(Number(btn.dataset.len));
});

function renderMoods(){
  startMoods.innerHTML = "";
  THEME_PRESETS.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mood";
    b.title = p.name;
    b.style.background = gradientCss(p.bg);
    const lum = p.bg.stops.reduce((sum, c) => sum + hexLuminance(c), 0) / p.bg.stops.length;
    b.style.color = lum > 0.4 ? "#2b2a28" : "#ffffff";
    b.textContent = p.name;
    b.addEventListener("click", () => {
      theme = sanitizeTheme(p);
      syncThemeUI(true);
      startMoods.querySelectorAll(".mood").forEach((m) => m.classList.toggle("active", m === b));
    });
    startMoods.appendChild(b);
  });
}

renderMoods();

/* ---------- Boot ---------- */

refreshLengthPicker();
updateCounters();
startLeaderboardSubscription();
showNameOverlay();
