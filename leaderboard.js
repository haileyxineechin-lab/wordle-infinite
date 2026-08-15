/* ============================================================
   LEADERBOARD — Firebase Firestore backend
   Stores one document per player name: { name, best, updatedAt }
   in the "leaderboard" collection, keyed by lowercase name.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

let db = null;
let enabled = true;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase failed to initialize — leaderboard disabled.", e);
  enabled = false;
}

function docIdFor(name){
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32) || "player";
}

// Writes the player's score if it beats their previously stored best.
// Returns the stored best (existing or new) or null if unavailable.
export async function submitScore(name, best){
  if (!enabled || !name) return null;
  try {
    const ref = doc(db, "leaderboard", docIdFor(name));
    const snap = await getDoc(ref);
    const prevBest = snap.exists() ? (snap.data().best || 0) : 0;
    if (best > prevBest){
      await setDoc(ref, {
        name: name.trim().slice(0, 16),
        best,
        updatedAt: Date.now()
      });
      return best;
    }
    return prevBest;
  } catch (e) {
    console.warn("submitScore failed", e);
    return null;
  }
}

// Returns an array of { name, best } sorted by best descending.
export async function fetchLeaderboard(limitCount = 10){
  if (!enabled) return [];
  try {
    const q = query(
      collection(db, "leaderboard"),
      orderBy("best", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
  } catch (e) {
    console.warn("fetchLeaderboard failed", e);
    return [];
  }
}

export function isLeaderboardEnabled(){
  return enabled;
}
