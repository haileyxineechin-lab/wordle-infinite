# Wordle // Infinite — Firebase leaderboard setup

## Files
- `index.html`, `style.css`, `script.js` — the game
- `leaderboard.js` — talks to Firestore (submit score / fetch top 10)
- `firebase-config.js` — **put your own Firebase project keys here**
- `firestore.rules.txt` — security rules to paste into the Firebase console

## 1. Create a Firebase project
1. Go to https://console.firebase.google.com → **Add project** → follow the steps.
2. In the project, go to **Build → Firestore Database → Create database**.
   Start in test mode for now (we'll lock it down with the rules below).
3. Go to **Project settings** (gear icon) → **General** → scroll to
   **Your apps** → click the **</>** (web) icon → register the app
   (no need for Firebase Hosting, you're using GitHub Pages).
4. Firebase shows a `firebaseConfig` object. Copy those values into
   `firebase-config.js` in place of the `YOUR_...` placeholders.

## 2. Lock down access
In the Firebase console go to **Firestore Database → Rules**, and paste in
the contents of `firestore.rules.txt`, then **Publish**. This lets anyone
read the leaderboard, but only write a score that looks valid — no login
required, since it's a casual public leaderboard.

## 3. Push to GitHub / GitHub Pages
Commit all the files (including `firebase-config.js` with your real keys —
these are public client keys, safe to expose; the Firestore *rules* are
what actually protect your data) and enable **GitHub Pages** in the repo's
Settings → Pages, pointing at your main branch.

## How it works
- On load, the player is asked for a name (remembered in their browser
  for next time).
- Winning a round updates their streak; if it beats their best, the new
  best is saved locally *and* pushed to Firestore under their name.
- The ☰ button opens a side panel showing the top 10 scores across all
  players, pulled live from Firestore.

## Notes / things you may want to change
- Names aren't authenticated — anyone can submit under any name. Fine for
  a casual leaderboard; if you want to prevent impersonation you'd need to
  add Firebase Auth (e.g. anonymous auth tied to a device).
- The leaderboard stores one row per name (case-insensitive), so a name
  is a slot — the highest score under that name wins.
