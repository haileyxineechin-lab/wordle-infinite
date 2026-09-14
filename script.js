/* ============================================================
   WORDLE // INFINITE
   Split-flap departure-board style Wordle with endless rounds.
   ============================================================ */

/* ---------- Firebase / leaderboard (Firestore) ---------- */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  initializeFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, onSnapshot,
  increment, runTransaction
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

/* ---------- Rooms (shared streak with friends) ---------- */

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

function randomRoomCode(){
  let code = "";
  for (let i = 0; i < 5; i++){
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

// Creates a new room seeded with the given streak. Returns the room code.
async function createRoom(initialStreak){
  if (!leaderboardEnabled) throw new Error("Leaderboard not available");
  const code = randomRoomCode();
  await setDoc(doc(db, "rooms", code), { code, streak: initialStreak, updatedAt: Date.now() });
  return code;
}

async function roomExists(code){
  if (!leaderboardEnabled) return false;
  try {
    const snap = await getDoc(doc(db, "rooms", code.toUpperCase()));
    return snap.exists();
  } catch (e) {
    console.warn("roomExists check failed", e);
    return false;
  }
}

// Live-subscribes to a room's shared streak.
function subscribeRoom(code, onUpdate, onError){
  if (!leaderboardEnabled){
    onError(new Error("Firebase not initialized"));
    return () => {};
  }
  try {
    return onSnapshot(
      doc(db, "rooms", code.toUpperCase()),
      (snap) => { if (snap.exists()) onUpdate(snap.data()); },
      (err) => { console.error("Room subscription error:", err); onError(err); }
    );
  } catch (e) {
    onError(e);
    return () => {};
  }
}

// Raises the room's shared streak to `streak` if it's higher than what's
// currently stored (never lowers it) — a simple co-op "high water mark".
async function pushRoomStreak(code, streak){
  if (!leaderboardEnabled) return;
  try {
    const ref = doc(db, "rooms", code.toUpperCase());
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists() ? (snap.data().streak || 0) : 0;
      if (streak > current){
        tx.set(ref, { code: code.toUpperCase(), streak, updatedAt: Date.now() }, { merge: true });
      }
    });
  } catch (e) {
    console.warn("pushRoomStreak failed", e);
  }
}

/* ---------- Word lists ---------- */

// Master word list — used both as possible answers and as valid guesses.
const WORD_LIST = [
  "aback","abase","abate","abbey","abbot","abhor","abide","abled","abode","abort",
  "about","above","abuse","abyss","acorn","acrid","actor","acute","adage","adapt",
  "addax","adept","admin","admit","adobe","adopt","adore","adorn","adult","aegis",
  "affix","afire","afoot","afoul","after","again","agape","agate","agent","agile",
  "aging","aglow","agony","agora","agree","ahead","aider","aisle","alarm","album",
  "alert","algae","alibi","alien","align","alike","alive","allay","alley","allot",
  "allow","alloy","aloft","alone","along","aloof","aloud","alpha","altar","alter",
  "amass","amaze","amber","ambit","amble","amend","amiss","amity","among","ample",
  "amply","amuse","angel","anger","angle","angry","angst","anime","ankle","annex",
  "annoy","annul","anode","antic","anvil","aorta","apart","aphid","aping","apnea",
  "apple","apply","apron","aptly","arbor","ardor","arena","argue","arise","armor",
  "aroma","arose","array","arrow","arson","artsy","ascot","ashen","aside","askew",
  "assay","asset","atlas","atoll","atone","attic","audio","audit","augur","aunty",
  "avail","avert","avian","avoid","await","awake","award","aware","awash","awful",
  "awoke","axial","axiom","axion","azure","bacon","badge","badly","bagel","baggy",
  "baker","baler","balmy","banal","banjo","barge","baron","basal","basic","basil",
  "basin","basis","baste","batch","bathe","baton","batty","bawdy","bayou","beach",
  "beady","beard","beast","beech","beefy","befit","began","begat","beget","begin",
  "begun","being","belch","belie","belle","belly","below","bench","beret","berry",
  "berth","beset","betel","bevel","bezel","bible","bicep","biddy","bigot","bilge",
  "billy","binge","bingo","biome","birch","birth","bison","bitty","black","blade",
  "blame","bland","blank","blare","blast","blaze","bleak","bleat","bleed","bleep",
  "blend","bless","blimp","blind","blink","bliss","blitz","bloat","block","bloke",
  "blond","blood","bloom","blown","bluer","bluff","blunt","blurb","blurt","blush",
  "board","boast","bobby","bogus","boney","bongo","bonus","booby","boost","booth",
  "booty","booze","boozy","borax","borne","bosom","bossy","botch","bough","boule",
  "bound","bowel","boxer","brace","braid","brain","brake","brand","brash","brass",
  "brave","bravo","brawl","brawn","bread","break","breed","briar","bribe","brick",
  "bride","brief","brine","bring","brink","briny","brisk","broad","broil","broke",
  "brood","brook","broom","broth","brown","brunt","brush","brute","buddy","budge",
  "buggy","bugle","build","built","bulge","bulky","bully","bunch","bunny","burly",
  "burnt","burst","bused","bushy","butch","butte","buxom","buyer","bylaw","cabal",
  "cabby","cabin","cable","cacao","cache","cacti","caddy","cadet","cagey","cairn",
  "camel","cameo","canal","candy","canny","canoe","canon","caper","caput","carat",
  "cargo","carol","carry","carve","caste","catch","cater","catty","caulk","cause",
  "cavil","cease","cedar","cello","chafe","chaff","chain","chair","chalk","champ",
  "chant","chaos","chard","charm","chart","chase","chasm","cheap","cheat","check",
  "cheek","cheer","chess","chest","chick","chide","chief","child","chili","chill",
  "chime","china","chirp","chock","choir","choke","chomp","chord","chore","chose",
  "chuck","chump","chunk","churn","chute","cider","cigar","cinch","circa","civic",
  "civil","clack","claim","clamp","clang","clank","clash","clasp","class","clean",
  "clear","cleat","cleft","clerk","click","cliff","climb","cling","clink","cloak",
  "clock","clone","close","cloth","cloud","clout","clove","clown","cluck","clued",
  "clump","clung","coach","coast","cobra","cocoa","colon","color","comet","comfy",
  "comic","comma","conch","condo","conic","copse","coral","corer","corny","couch",
  "cough","could","count","coupe","court","coven","cover","covet","covey","cower",
  "coyly","crack","craft","cramp","crane","crank","crash","crass","crate","crave",
  "crawl","craze","crazy","creak","cream","credo","creed","creek","creep","creme",
  "crepe","crept","cress","crest","crick","cried","crier","crime","crimp","crisp",
  "croak","crock","crone","crony","crook","cross","croup","crowd","crown","crude",
  "cruel","crumb","crump","crush","crust","crypt","cubic","cumin","curio","curly",
  "curry","curse","curve","curvy","cutie","cyber","cycle","cynic","daddy","daily",
  "dairy","daisy","dally","dance","dandy","datum","daunt","dealt","death","debar",
  "debit","debug","debut","decal","decay","decor","decoy","decry","defer","deign",
  "deity","delay","delta","delve","demon","demur","denim","dense","depot","depth",
  "derby","deter","detox","deuce","devil","diary","dicey","digit","dilly","dimly",
  "diner","dingo","dingy","diode","dirge","dirty","disco","ditch","ditto","ditty",
  "diver","dizzy","dodge","dodgy","dogma","doing","dolly","donor","donut","dopey",
  "doubt","dough","dowdy","dowel","downy","dowry","dozen","draft","drain","drake",
  "drama","drank","drape","drawl","drawn","dread","dream","dress","dried","drier",
  "drift","drill","drink","drive","droit","droll","drone","drool","droop","dross",
  "drove","drown","druid","drunk","dryer","dryly","duchy","dully","dummy","dumpy",
  "dunce","dusky","dusty","dutch","duvet","dwarf","dwell","dwelt","dying","eager",
  "eagle","early","earth","easel","eaten","eater","ebony","eclat","edict","edify",
  "eerie","egret","eight","eject","eking","elate","elbow","elder","elect","elegy",
  "elfin","elide","elite","elope","elude","email","embed","ember","emcee","empty",
  "enact","endow","enema","enemy","enjoy","ennui","ensue","enter","entry","envoy",
  "epoch","epoxy","equal","equip","erase","erect","erode","error","erupt","essay",
  "ester","ether","ethic","ethos","etude","evade","event","every","evict","evoke",
  "exact","exalt","excel","exert","exile","exist","expel","extol","extra","exult",
  "eying","fable","facet","faint","fairy","faith","false","fancy","fanny","farce",
  "fatal","fatty","fault","fauna","favor","feast","fecal","feign","fella","felon",
  "femme","femur","fence","feral","ferry","fetal","fetch","fetid","fetus","fever",
  "fewer","fiber","fibre","ficus","field","fiend","fiery","fifth","fifty","fight",
  "filer","filet","filly","filmy","filth","final","finch","finer","first","fishy",
  "fixed","fixer","fizzy","fjord","flack","flail","flair","flake","flaky","flame",
  "flank","flare","flash","flask","fleck","fleet","flesh","flick","flier","fling",
  "flint","flirt","float","flock","flood","floor","flora","floss","flour","flout",
  "flown","fluff","fluid","fluke","flume","flung","flunk","flush","flute","flyer",
  "foamy","focal","focus","foggy","foist","folio","folly","foray","force","forge",
  "forgo","forte","forth","forty","forum","found","foyer","frail","frame","frank",
  "fraud","freak","freed","freer","fresh","friar","fried","frill","frisk","fritz",
  "frock","frond","front","frost","froth","frown","froze","fruit","fudge","fugue",
  "fully","fungi","funky","funny","furor","furry","fussy","fuzzy","gaffe","gaily",
  "gamer","gamma","gamut","gassy","gaudy","gauge","gaunt","gauze","gavel","gawky",
  "gayer","gayly","gazer","gecko","geeky","geese","genie","genre","ghost","ghoul",
  "giant","giddy","gipsy","girly","girth","given","giver","gizmo","glade","gland",
  "glare","glass","glaze","gleam","glean","glide","glint","gloat","globe","gloom",
  "glory","gloss","glove","glyph","gnash","gnome","godly","going","golem","golly",
  "gonad","goner","goody","gooey","goofy","goose","gorge","gouge","gourd","grace",
  "grade","graft","grail","grain","grand","grant","grape","graph","grasp","grass",
  "grate","grave","gravy","graze","great","greed","green","greet","grief","grill",
  "grime","grimy","grind","gripe","groan","groin","groom","grope","gross","group",
  "grout","grove","growl","grown","gruel","gruff","grunt","guard","guava","guess",
  "guest","guide","guild","guile","guilt","guise","gulch","gully","gumbo","gummy",
  "guppy","gusto","gusty","gypsy","habit","hairy","halve","handy","happy","hardy",
  "harem","harpy","harry","harsh","haste","hasty","hatch","hater","haunt","haute",
  "haven","havoc","hazel","heady","heard","heart","heath","heave","heavy","hedge",
  "hefty","heist","helix","hello","hence","heron","hilly","hinge","hippo","hippy",
  "hitch","hoard","hobby","hoist","holly","homer","honey","honor","horde","horny",
  "horse","hotel","hotly","hound","house","hovel","hover","howdy","human","humid",
  "humor","humph","humus","hunch","hunky","hurry","husky","hussy","hutch","hydro",
  "hyena","hymen","hyper","icily","icing","ideal","idiom","idiot","idler","idyll",
  "igloo","iliac","image","imbue","impel","imply","inane","inbox","incur","index",
  "inept","inert","infer","ingot","inlay","inlet","inner","input","inter","intro",
  "ionic","irate","irony","islet","issue","itchy","ivory","jaunt","jazzy","jelly",
  "jerky","jetty","jewel","jiffy","joint","joist","joker","jolly","joust","judge",
  "juice","juicy","jumbo","jumpy","junta","junto","juror","kappa","karma","kayak",
  "kebab","khaki","kinky","kiosk","kitty","knack","knave","knead","kneed","kneel",
  "knelt","knife","knock","knoll","known","koala","krill","label","labor","laden",
  "ladle","lager","lance","lanky","lapel","lapse","large","larva","laser","lasso",
  "latch","later","lathe","latte","laugh","layer","leach","leafy","leaky","leant",
  "leapt","learn","lease","leash","least","leave","ledge","leech","leery","lefty",
  "legal","leggy","lemon","lemur","leper","level","lever","libel","liege","light",
  "liken","lilac","limbo","limit","linen","liner","lingo","lipid","lithe","liver",
  "livid","llama","loamy","loath","lobby","local","locus","lodge","lofty","logic",
  "login","loopy","loose","lorry","loser","louse","lousy","lover","lower","lowly",
  "loyal","lucid","lucky","lumen","lumpy","lunar","lunch","lunge","lupus","lurch",
  "lurid","lusty","lying","lymph","lynch","lyric","macaw","macho","macro","madam",
  "madly","mafia","magic","magma","maize","major","maker","mambo","mamma","mammy",
  "manga","mange","mango","mangy","mania","manic","manly","manor","maple","march",
  "marry","marsh","mason","masse","match","matey","mauve","maxim","maybe","mayor",
  "mealy","meant","meaty","mecca","medal","media","medic","melee","melon","mercy",
  "merge","merit","merry","metal","meter","metro","micro","midge","midst","might",
  "milky","mimic","mince","miner","minim","minor","minty","minus","mirth","miser",
  "missy","mixed","mocha","modal","model","modem","mogul","moist","molar","moldy",
  "money","month","moody","moose","moral","moron","morph","mossy","motel","motif",
  "motor","motto","moult","mound","mount","mourn","mouse","mouth","moved","mover",
  "movie","mower","mucky","mucus","muddy","mulch","mummy","munch","mural","murky",
  "mushy","music","musky","musty","myrrh","nadir","naive","naked","nanny","nasal",
  "nasty","natal","naval","navel","needy","neigh","nerdy","nerve","never","newer",
  "newly","nicer","niche","niece","nifty","night","ninja","ninny","ninth","noble",
  "nobly","noise","noisy","nomad","noose","north","nosey","notch","novel","nudge",
  "nurse","nutty","nylon","nymph","oaken","oasis","obese","occur","ocean","octal",
  "octet","odder","oddly","offal","offer","often","olden","older","olive","ombre",
  "omega","onion","onset","opera","opine","opium","optic","orbit","order","organ",
  "other","otter","ought","ounce","outdo","outer","outgo","ovary","ovate","overt",
  "ovine","ovoid","owing","owner","oxide","ozone","paddy","pagan","paint","paler",
  "palsy","panda","panel","panic","pansy","papal","paper","parer","parka","parry",
  "parse","party","pasta","paste","pasty","patch","patio","patsy","patty","pause",
  "payee","payer","peace","peach","pearl","pecan","pedal","penal","pence","penne",
  "penny","perch","peril","perky","pesky","pesto","petal","petty","phase","phone",
  "phony","photo","piano","picky","piece","piety","piggy","pilot","pinch","piney",
  "pinky","pinto","piper","pique","pitch","pithy","pivot","pixel","pixie","pizza",
  "place","plaid","plain","plait","plane","plank","plant","plate","plaza","plead",
  "pleat","plied","plier","pluck","plumb","plume","plump","plunk","plush","poesy",
  "point","poise","poker","polar","polka","polyp","pooch","poppy","porch","poser",
  "posit","posse","pouch","pound","pouty","power","prank","prawn","preen","press",
  "price","prick","pride","pried","prime","primo","print","prior","prism","privy",
  "prize","probe","prone","prong","proof","prose","proud","prove","prowl","proxy",
  "prude","prune","psalm","pubic","pudgy","puffy","pulpy","pulse","punch","pupal",
  "pupil","puppy","puree","purer","purge","purse","pushy","putty","pygmy","quack",
  "quail","quake","qualm","quark","quart","quash","quasi","queen","queer","quell",
  "query","quest","queue","quick","quiet","quill","quilt","quirk","quite","quota",
  "quote","quoth","rabbi","rabid","racer","radar","radii","radio","rainy","raise",
  "rajah","rally","ralph","ramen","ranch","randy","range","rapid","rarer","raspy",
  "ratio","ratty","raven","rayon","razor","reach","react","ready","realm","rearm",
  "rebar","rebel","rebus","rebut","recap","recur","recut","reedy","refer","refit",
  "regal","rehab","reign","relax","relay","relic","remit","renal","renew","repay",
  "repel","reply","rerun","reset","resin","retch","retro","retry","reuse","revel",
  "revue","rhino","rhyme","rider","ridge","rifle","right","rigid","rigor","rinse",
  "ripen","riper","risen","riser","risky","rival","river","rivet","roach","roast",
  "robin","robot","rocky","rodeo","roger","rogue","roman","roomy","roost","rotor",
  "rouge","rough","round","rouse","route","rover","rowdy","rower","royal","ruddy",
  "ruder","rugby","ruler","rumba","rumor","rupee","rural","rusty","sadly","safer",
  "saint","salad","sally","salon","salsa","salty","salve","salvo","sandy","saner",
  "sappy","sassy","satin","satyr","sauce","saucy","sauna","saute","savor","savoy",
  "savvy","scald","scale","scalp","scaly","scamp","scant","scare","scarf","scary",
  "scene","scent","scion","scoff","scold","scone","scoop","scope","score","scorn",
  "scour","scout","scowl","scram","scrap","scree","screw","scrub","scrum","scuba",
  "sedan","seedy","segue","seize","semen","sense","sepia","serif","serum","serve",
  "setup","seven","sever","sewer","shack","shade","shady","shaft","shake","shaky",
  "shale","shall","shalt","shame","shank","shape","shard","share","shark","sharp",
  "shave","shawl","shear","sheen","sheep","sheer","sheet","sheik","shelf","shell",
  "shied","shift","shine","shiny","shire","shirk","shirt","shoal","shock","shone",
  "shook","shoot","shore","shorn","short","shout","shove","shown","showy","shrew",
  "shrub","shrug","shuck","shunt","shush","shyly","siege","sieve","sight","sigma",
  "silky","silly","since","sinew","singe","siren","sissy","sixth","sixty","skate",
  "skier","skiff","skill","skimp","skirt","skulk","skull","skunk","slack","slain",
  "slang","slant","slash","slate","slave","sleek","sleep","sleet","slept","slice",
  "slick","slide","slime","slimy","sling","slink","sloop","slope","slosh","sloth",
  "slump","slung","slunk","slurp","slush","slyly","smack","small","smart","smash",
  "smear","smell","smelt","smile","smirk","smite","smith","smock","smoke","smoky",
  "smote","snack","snail","snake","snaky","snare","snarl","sneak","sneer","snide",
  "sniff","snipe","snoop","snore","snort","snout","snowy","snuck","snuff","soapy",
  "sober","soggy","solar","solid","solve","sonar","sonic","sooth","sooty","sorry",
  "sound","south","sower","space","spade","spank","spare","spark","spasm","spawn",
  "speak","spear","speck","speed","spell","spelt","spend","spent","sperm","spice",
  "spicy","spied","spiel","spike","spiky","spill","spilt","spine","spiny","spire",
  "spite","splat","split","spoil","spoke","spoof","spook","spool","spoon","spore",
  "sport","spout","spray","spree","sprig","spunk","spurn","spurt","squad","squat",
  "squib","stack","staff","stage","staid","stain","stair","stake","stale","stalk",
  "stall","stamp","stand","stank","stare","stark","start","stash","state","stave",
  "stead","steak","steal","steam","steed","steel","steep","steer","stein","stern",
  "stick","stiff","still","stilt","sting","stink","stint","stock","stoic","stoke",
  "stole","stomp","stone","stony","stood","stool","stoop","store","stork","storm",
  "story","stout","stove","strap","straw","stray","strip","strut","stuck","study",
  "stuff","stump","stung","stunk","stunt","style","suave","sugar","suing","suite",
  "sulky","sully","sumac","sunny","super","surer","surge","surly","sushi","swami",
  "swamp","swarm","swash","swath","swear","sweat","sweep","sweet","swell","swept",
  "swift","swill","swine","swing","swirl","swish","swoon","swoop","sword","swore",
  "sworn","swung","synod","syrup","tabby","table","taboo","tacit","tacky","taffy",
  "taint","taken","taker","tally","talon","tamer","tango","tangy","taper","tapir",
  "tardy","tarot","taste","tasty","tatty","taunt","tawny","teach","teary","tease",
  "teddy","teeth","tempo","tenet","tenor","tense","tenth","tepee","tepid","terra",
  "terse","testy","thank","theft","their","theme","there","these","theta","thick",
  "thief","thigh","thing","think","third","thong","thorn","those","three","threw",
  "throb","throw","thrum","thumb","thump","thyme","tiara","tibia","tidal","tiger",
  "tight","tilde","timer","timid","tipsy","tired","titan","tithe","title","toast",
  "today","toddy","token","tonal","tonga","tonic","tooth","topaz","topic","torch",
  "torso","torus","total","totem","touch","tough","towel","tower","toxic","toxin",
  "trace","track","tract","trade","trail","train","trait","tramp","trash","trawl",
  "tread","treat","trend","triad","trial","tribe","trice","trick","tried","tripe",
  "trite","troll","troop","trope","trout","trove","truce","truck","truer","truly",
  "trump","trunk","truss","trust","truth","tryst","tubal","tuber","tulip","tulle",
  "tumor","tunic","turbo","tutor","twang","tweak","tweed","tweet","twice","twine",
  "twirl","twist","twixt","tying","udder","ulcer","ultra","umbra","uncle","uncut",
  "under","undid","undue","unfed","unfit","unify","union","unite","unity","unlit",
  "unmet","unset","untie","until","unwed","unzip","upper","upset","urban","urine",
  "usage","usher","using","usual","usurp","utile","utter","vague","valet","valid",
  "valor","value","valve","vapid","vapor","vault","vaunt","vegan","venom","venue",
  "verge","verse","verso","verve","vicar","video","vigil","vigor","villa","vinyl",
  "viola","viper","viral","virus","visit","visor","vista","vital","vivid","vixen",
  "vocal","vodka","vogue","voice","voila","vomit","voter","vouch","vowel","vying",
  "wacky","wafer","wager","wagon","waist","waive","waltz","warty","waste","watch",
  "water","waver","waxen","weary","weave","wedge","weedy","weigh","weird","welch",
  "welsh","wench","whack","whale","wharf","wheat","wheel","whelp","where","which",
  "whiff","while","whine","whiny","whirl","whisk","white","whole","whoop","whose",
  "widen","wider","widow","width","wield","wight","willy","wimpy","wince","winch",
  "windy","wiser","wispy","witch","witty","woken","woman","women","woody","wooer",
  "wooly","woozy","wordy","world","worry","worse","worst","worth","would","wound",
  "woven","wrack","wrath","wreak","wreck","wrest","wring","wrist","write","wrong",
  "wrote","wrung","wryly","yacht","yearn","yeast","yield","young","youth","zebra",
  "zesty","zonal"
];

const ANSWER_WORDS = WORD_LIST;
const VALID_GUESSES = new Set(WORD_LIST);


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
const HINT_COST = 150;
const ROUND_WIN_POINTS = 500;

const state = {
  answer: "",
  round: 1,
  streak: 0,
  best: loadBest(),
  points: 0,
  playerName: loadName(),
  guesses: [],        // array of submitted 5-letter strings
  results: [],         // array of result arrays (one per submitted guess) e.g. ['correct','absent',...]
  slots: ["", "", "", "", ""],   // current (unsubmitted) guess, letter per position
  locked: [false, false, false, false, false], // which slots were filled by a hint
  gameOver: false,
  keyStatus: {},        // letter -> 'correct' | 'present' | 'absent'
  roomCode: null
};

let unsubscribeRoom = null;

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
  if (state.roomCode){
    roomBtn.classList.add("in-room");
    roomLabel.textContent = `ROOM: ${state.roomCode}`;
    roomStatusText.textContent = `In room ${state.roomCode} — share this code with friends`;
    roomJoinFields.style.display = "none";
    roomLeaveBtn.style.display = "block";
  } else {
    roomBtn.classList.remove("in-room");
    roomLabel.textContent = "PLAY WITH FRIENDS";
    roomStatusText.textContent = "Not in a room";
    roomJoinFields.style.display = "block";
    roomLeaveBtn.style.display = "none";
  }
}

function enterRoom(code){
  if (unsubscribeRoom) unsubscribeRoom();
  state.roomCode = code.toUpperCase();
  refreshRoomUI();
  unsubscribeRoom = subscribeRoom(
    state.roomCode,
    (data) => {
      const roomStreak = data.streak || 0;
      if (roomStreak > state.streak){
        state.streak = roomStreak;
        updateCounters();
        showToast(`Synced to room streak: ${roomStreak}`);
      }
    },
    (err) => {
      roomHint.textContent = "Lost connection to the room.";
    }
  );
  // Push our current streak in immediately so the room reflects the higher of the two.
  pushRoomStreak(state.roomCode, state.streak);
}

function leaveRoom(){
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = null;
  state.roomCode = null;
  refreshRoomUI();
}

roomBtn.addEventListener("click", () => {
  roomHint.textContent = "";
  roomCodeInput.value = "";
  refreshRoomUI();
  roomOverlay.classList.add("show");
});

roomCloseBtn.addEventListener("click", () => {
  roomOverlay.classList.remove("show");
});

roomCreateBtn.addEventListener("click", async () => {
  roomHint.textContent = "Creating room…";
  try {
    const code = await createRoom(state.streak);
    enterRoom(code);
    roomHint.textContent = `Room created! Code: ${code}`;
  } catch (e) {
    roomHint.textContent = "Couldn't create a room — check your connection.";
  }
});

roomJoinBtn.addEventListener("click", async () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length < 4){
    roomHint.textContent = "Enter a valid room code.";
    return;
  }
  roomHint.textContent = "Joining…";
  const exists = await roomExists(code);
  if (!exists){
    roomHint.textContent = "No room found with that code.";
    return;
  }
  enterRoom(code);
  roomHint.textContent = `Joined room ${code}!`;
});

roomLeaveBtn.addEventListener("click", () => {
  leaveRoom();
  roomHint.textContent = "Left the room.";
});

hintBtn.addEventListener("click", useHint);

/* ---------- Init ---------- */

function pickAnswer(){
  const idx = Math.floor(Math.random() * ANSWER_WORDS.length);
  return ANSWER_WORDS[idx];
}

function newRound(keepRoundNumber){
  state.answer = pickAnswer();
  state.guesses = [];
  state.results = [];
  state.slots = ["", "", "", "", ""];
  state.locked = [false, false, false, false, false];
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
  streakValueEl.textContent = String(state.streak);
  bestValueEl.textContent = String(state.best);
  pointsValueEl.textContent = String(state.points);
  hintBtn.disabled = state.points < HINT_COST || state.gameOver;
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
  const remaining = [0, 1, 2, 3, 4].filter(i => !known.has(i));
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

  if (!VALID_GUESSES.has(guess)){
    showToast("Not in word list");
    shakeRow(r);
    return;
  }

  const result = evaluateGuess(guess, state.answer);
  state.guesses.push(guess);
  state.results.push(result);
  state.slots = ["", "", "", "", ""];
  state.locked = [false, false, false, false, false];

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
      state.points += ROUND_WIN_POINTS;
      saveBest(state.best);
      if (state.playerName){
        submitScore(state.playerName, state.best);
        awardPoints(state.playerName, ROUND_WIN_POINTS);
      }
      if (state.roomCode){
        pushRoomStreak(state.roomCode, state.streak);
      }
      updateCounters();
      setMessage(`Solved in ${state.guesses.length}/${MAX_GUESSES} — +${ROUND_WIN_POINTS} points — next round starting…`, "win");
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
startLeaderboardSubscription();
showNameOverlay();
