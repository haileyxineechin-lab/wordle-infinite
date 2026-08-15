/* ============================================================
   WORDLE // INFINITE
   Split-flap departure-board style Wordle with endless rounds.
   ============================================================ */

/* ---------- Firebase / leaderboard (Firestore) ---------- */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDQlqDEy_XKPsvz6PeMIG-I_2bsqJ7Cvgk",
  authDomain: "wordle-infinite-7a04f.firebaseapp.com",
  projectId: "wordle-infinite-7a04f",
  storageBucket: "wordle-infinite-7a04f.firebasestorage.app",
  messagingSenderId: "955539970175",
  appId: "1:955539970175:web:47bc5d50300284fac3074a",
  measurementId: "G-BNVY2QYBJ3"
};

let db = null;
let leaderboardEnabled = true;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase failed to initialize — leaderboard disabled.", e);
  leaderboardEnabled = false;
}

function docIdFor(name){
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32) || "player";
}

// Writes the player's score if it beats their previously stored best.
async function submitScore(name, best){
  if (!leaderboardEnabled || !name) return null;
  try {
    const ref = doc(db, "leaderboard", docIdFor(name));
    const snap = await getDoc(ref);
    const prevBest = snap.exists() ? (snap.data().best || 0) : 0;
    if (best > prevBest){
      await setDoc(ref, { name: name.trim().slice(0, 16), best, updatedAt: Date.now() });
      return best;
    }
    return prevBest;
  } catch (e) {
    console.warn("submitScore failed", e);
    return null;
  }
}

// Returns an array of { name, best } sorted by best descending.
async function fetchLeaderboard(limitCount = 10){
  if (!leaderboardEnabled) return [];
  try {
    const q = query(collection(db, "leaderboard"), orderBy("best", "desc"), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  } catch (e) {
    console.warn("fetchLeaderboard failed", e);
    return [];
  }
}

function isLeaderboardEnabled(){
  return leaderboardEnabled;
}

/* ---------- Word lists ---------- */

// Words that can appear as the answer.
const ANSWER_WORDS = [
  "about","above","actor","adapt","admit","adult","after","again","agent","agree",
  "ahead","alarm","album","alert","alike","alive","allow","alone","along","alter",
  "among","angel","anger","angle","angry","apple","apply","arena","argue","arise",
  "array","aside","asset","avoid","awake","award","aware","badge","baker","basic",
  "beach","begin","being","below","bench","berry","birth","black","blade","blame",
  "blank","blast","bleed","blend","bless","blind","block","blood","board","boost",
  "booth","bound","brain","brand","brave","bread","break","breed","brick","bride",
  "brief","bring","broad","broke","brown","brush","build","built","bunch","burst",
  "cabin","cable","camel","camera","candy","canal","candy","carry","catch","cause",
  "chain","chair","chalk","champ","chaos","charm","chart","chase","cheap","check",
  "cheer","chess","chest","chief","child","chill","chose","civic","claim","clash",
  "class","clean","clear","clerk","click","cliff","climb","cling","cloak","clock",
  "close","cloth","cloud","coach","coast","color","comic","corn","couch","could",
  "count","court","cover","crack","craft","crane","crash","crawl","cream","creek",
  "crest","crime","crisp","cross","crowd","crown","crude","cruel","crush","curve",
  "cycle","daily","dance","dealt","death","debut","decay","delay","depth","derby",
  "diary","dizzy","doubt","dozen","draft","drain","drama","drank","dream","dress",
  "dried","drift","drink","drive","drone","drove","dwell","eager","early","earth",
  "eight","elbow","elder","elect","elite","empty","enemy","enjoy","enter","entry",
  "equal","error","essay","event","every","exact","exist","extra","fable","faith",
  "false","fancy","fault","favor","feast","fence","fever","field","fifth","fight",
  "final","first","fixed","flame","flash","fleet","flesh","float","flock","flood",
  "floor","flour","fluid","flush","focus","force","forge","forth","forum","found",
  "frame","fraud","fresh","front","frost","fruit","fuel","funny","gauge","ghost",
  "giant","given","glass","gleam","globe","glory","glove","goose","grace","grade",
  "grain","grand","grant","grape","graph","grasp","grass","great","greed","green",
  "greet","grief","grill","grind","gross","group","grove","grown","guard","guess",
  "guest","guide","habit","happy","harsh","heart","heavy","hedge","hello","hence",
  "honor","horse","hotel","house","human","humor","hurry","ideal","image","imply",
  "index","inner","input","irony","issue","ivory","jelly","joint","judge","juice",
  "jumbo","knife","knock","known","label","labor","large","laser","later","laugh",
  "layer","learn","least","leave","legal","lemon","level","light","limit","linen",
  "liver","local","lodge","logic","loose","lucky","lunar","lunch","lyric","magic",
  "major","maker","march","match","maybe","mayor","medal","media","merit","metal",
  "meter","might","minor","minus","mirror","mixed","model","month","moral","motor",
  "mount","mouse","mouth","moved","movie","music","naive","naked","nerve","never",
  "newly","niche","noble","noise","north","novel","nurse","nylon","ocean","offer",
  "often","olive","onion","opera","orbit","order","organ","other","ought","ounce",
  "outer","owner","paint","panel","panic","paper","party","pause","peace","pearl",
  "phase","phone","photo","piano","piece","pilot","pitch","pizza","place","plain",
  "plane","plant","plate","point","pound","power","press","price","pride","prime",
  "print","prior","prize","proof","proud","prove","pulse","punch","pupil","purse",
  "queen","quick","quiet","quote","radar","radio","raise","range","rapid","ratio",
  "reach","react","ready","realm","rebel","refer","reign","relax","reply","rider",
  "ridge","rifle","right","rigid","risky","rival","river","robot","rocky","rogue",
  "roman","rough","round","route","royal","rural","sadly","salad","sauce","scale",
  "scare","scarf","scene","scent","scope","score","scout","scrap","screw","seven",
  "shade","shaft","shake","shall","shape","share","shark","sharp","sheep","sheet",
  "shelf","shell","shift","shine","shirt","shock","shoot","shore","short","shout",
  "shown","shrug","siege","sight","silly","since","sixth","sixty","skill","sleep",
  "slice","slide","slope","small","smart","smell","smile","smoke","snack","solar",
  "solid","solve","sorry","sound","south","space","spare","spark","speak","speed",
  "spend","spent","spice","spine","spite","split","spoke","sport","spray","squad",
  "stack","staff","stage","stake","stall","stamp","stand","stare","start","state",
  "steak","steel","steep","steer","stern","stick","still","sting","stock","stone",
  "store","storm","story","stove","strip","stuck","study","stuff","style","sugar",
  "suite","sunny","super","swear","sweat","sweet","swift","swing","sword","table",
  "taken","taste","teach","tease","teeth","tempo","tenant","tenth","theme","thick",
  "thief","thing","think","third","those","three","throw","thumb","tiger","tight",
  "timer","tired","title","toast","today","token","tonic","topic","torch","total",
  "touch","tough","tower","toxic","trace","track","trade","trail","train","trait",
  "trash","treat","trend","trial","tribe","trick","tried","troop","truck","truly",
  "trust","truth","tumor","tutor","twice","twist","ultra","uncle","under","union",
  "unity","until","upper","upset","urban","usage","usual","valid","value","vapor",
  "vault","venue","verse","video","virus","visit","vital","vivid","vocal","voice",
  "waste","watch","water","weigh","weird","wheat","wheel","where","which","while",
  "white","whole","whose","widow","width","witch","woman","world","worry","worst",
  "worth","would","wound","woven","wrist","write","wrong","yield","young","youth"
];

// Extra valid guesses (not answers, but accepted words).
const EXTRA_VALID = [
  "aback","adage","addax","aegis","affix","agony","ambit","annoy","arbor","ardor",
  "atlas","audio","awash","axiom","bagel","balmy","banjo","basil","bayou","belly",
  "bison","blimp","blitz","bogus","bosom","bugle","bulky","cabin","cameo","canoe",
  "caper","chirp","chomp","chunk","cinch","civic","clamp","clasp","cobra","comet",
  "condo","coral","cramp","crepe","crisp","cynic","daddy","decoy","depot","ditto",
  "dodge","dogma","dowry","dummy","dusty","ebony","eclat","edict","elfin","epoxy",
  "ethos","exalt","facet","fauna","fjord","flair","flute","foray","forte","frisk",
  "gazebo","gecko","genre","gizmo","gnome","grimy","gusto","gypsy","habit","hobby",
  "hoist","hulk","humid","hyena","igloo","impel","inbox","ionic","jaunt","jazzy",
  "jolly","joust","kayak","kiosk","knead","koala","lager","lasso","llama","lofty",
  "lumen","lurch","lynch","mango","manor","mimic","mocha","mogul","mossy","mulch",
  "nasal","nifty","nomad","nudge","oasis","oddly","onset","opium","otter","ovary",
  "paddy","panda","parka","patio","pesto","photo","plaza","pluck","podium","polka",
  "pouch","prowl","pygmy","quake","quart","quash","quilt","quirk","rabbi","ranch",
  "reedy","relic","robin","rugby","rumor","salsa","savvy","scoff","scowl","sedan",
  "sepia","sinew","sleek","slosh","snarl","sonar","spasm","spool","stein","stomp",
  "stunt","swarm","tabby","talon","tapir","tempo","thaw","thorn","tonic","toxic",
  "tulip","tunic","tweed","udder","ultra","umbra","unzip","usurp","valor","vegan",
  "vixen","vodka","waltz","wharf","whimsy","wispy","zesty"
].filter(w => w.length === 5);

const VALID_GUESSES = new Set([...ANSWER_WORDS, ...EXTRA_VALID]);

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

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;

const state = {
  answer: "",
  round: 1,
  streak: 0,
  best: loadBest(),
  playerName: loadName(),
  guesses: [],        // array of submitted 5-letter strings
  results: [],         // array of result arrays (one per submitted guess) e.g. ['correct','absent',...]
  currentGuess: "",
  gameOver: false,
  keyStatus: {}        // letter -> 'correct' | 'present' | 'absent'
};

/* ---------- DOM refs ---------- */

const boardEl = document.getElementById("board");
const keyboardEl = document.getElementById("keyboard");
const toastEl = document.getElementById("toast");
const messageRail = document.getElementById("messageRail");
const roundValueEl = document.getElementById("roundValue");
const streakValueEl = document.getElementById("streakValue");
const bestValueEl = document.getElementById("bestValue");
const restartBtn = document.getElementById("restartBtn");
const subtitleText = document.getElementById("subtitleText");

const nameOverlay = document.getElementById("nameOverlay");
const nameInput = document.getElementById("nameInput");
const nameSubmitBtn = document.getElementById("nameSubmitBtn");
const nameHint = document.getElementById("nameHint");

const leaderboardBtn = document.getElementById("leaderboardBtn");
const leaderboardCloseBtn = document.getElementById("leaderboardCloseBtn");
const leaderboardPanel = document.getElementById("leaderboardPanel");
const leaderboardList = document.getElementById("leaderboardList");

const KEY_ROWS = [
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l"],
  ["enter","z","x","c","v","b","n","m","back"]
];

/* ---------- Name entry ---------- */

function startWithName(name){
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
}

nameSubmitBtn.addEventListener("click", () => startWithName(nameInput.value));
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startWithName(nameInput.value);
});

function showNameOverlay(){
  nameInput.value = state.playerName || "";
  nameHint.textContent = isLeaderboardEnabled() ? "" : "";
  nameOverlay.classList.add("show");
  nameInput.focus();
}

/* ---------- Leaderboard panel ---------- */

async function renderLeaderboard(){
  leaderboardList.innerHTML = `<li class="leaderboard-empty">Loading…</li>`;
  const rows = await fetchLeaderboard(10);
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
    `;
    leaderboardList.appendChild(li);
  });
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

leaderboardBtn.addEventListener("click", () => {
  leaderboardPanel.classList.add("show");
  renderLeaderboard();
});
leaderboardCloseBtn.addEventListener("click", () => {
  leaderboardPanel.classList.remove("show");
});

/* ---------- Init ---------- */

function pickAnswer(){
  const idx = Math.floor(Math.random() * ANSWER_WORDS.length);
  return ANSWER_WORDS[idx];
}

function newRound(keepRoundNumber){
  state.answer = pickAnswer();
  state.guesses = [];
  state.results = [];
  state.currentGuess = "";
  state.gameOver = false;
  state.keyStatus = {};
  if (!keepRoundNumber) state.round += 1;
  renderBoard();
  renderKeyboard();
  updateCounters();
  setMessage("");
}

function resetSession(){
  state.round = 1;
  state.streak = 0;
  newRound(true);
}

/* ---------- Rendering ---------- */

function renderBoard(){
  boardEl.innerHTML = "";
  for (let r = 0; r < MAX_GUESSES; r++){
    const rowEl = document.createElement("div");
    rowEl.className = "board-row";
    rowEl.id = `row-${r}`;
    const word = state.guesses[r] ?? (r === state.guesses.length ? state.currentGuess : "");
    const rowResult = state.results[r]; // undefined for rows not yet submitted
    for (let c = 0; c < WORD_LENGTH; c++){
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.id = `tile-${r}-${c}`;
      const inner = document.createElement("div");
      inner.className = "tile-inner";
      inner.textContent = word[c] ?? "";
      if (word[c] && r === state.guesses.length) tile.classList.add("filled");
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
  streakValueEl.textContent = String(state.streak);
  bestValueEl.textContent = String(state.best);
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

  if (key === "back"){
    state.currentGuess = state.currentGuess.slice(0, -1);
    updateCurrentRow();
    return;
  }

  if (key === "enter"){
    submitGuess();
    return;
  }

  if (/^[a-z]$/.test(key) && state.currentGuess.length < WORD_LENGTH){
    state.currentGuess += key;
    updateCurrentRow();
  }
}

function updateCurrentRow(){
  const r = state.guesses.length;
  const rowEl = document.getElementById(`row-${r}`);
  if (!rowEl) return;
  for (let c = 0; c < WORD_LENGTH; c++){
    const tile = document.getElementById(`tile-${r}-${c}`);
    const inner = tile.querySelector(".tile-inner");
    const letter = state.currentGuess[c] ?? "";
    inner.textContent = letter;
    tile.classList.toggle("filled", Boolean(letter));
  }
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

  if (state.currentGuess.length < WORD_LENGTH){
    showToast("Not enough letters");
    shakeRow(r);
    return;
  }

  if (!VALID_GUESSES.has(state.currentGuess)){
    showToast("Not in word list");
    shakeRow(r);
    return;
  }

  const guess = state.currentGuess;
  const result = evaluateGuess(guess, state.answer);
  state.guesses.push(guess);
  state.results.push(result);
  state.currentGuess = "";

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
      state.streak += 1;
      state.best = Math.max(state.best, state.streak);
      saveBest(state.best);
      if (state.playerName){
        submitScore(state.playerName, state.best);
      }
      updateCounters();
      setMessage(`Solved in ${state.guesses.length}/${MAX_GUESSES} — next round starting…`, "win");
      setTimeout(() => newRound(false), 1600);
    } else if (lost){
      state.gameOver = true;
      state.streak = 0;
      state.round = 0;
      updateCounters();
      setMessage(`THE ANSWER WAS <span class="answer-reveal">${state.answer.toUpperCase()}</span>`, "lose");
      setTimeout(() => newRound(false), 5000);
    } else {
      renderBoard();
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

/* ---------- Boot ---------- */

updateCounters();
showNameOverlay();
