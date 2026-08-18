# Blob Buddies — 2 Player Co-op

A small Agar.io-inspired co-op game that runs entirely in the browser and syncs two players through **Firebase Realtime Database**.

## Features

- 6-character room codes
- Exactly two player slots per room, claimed with Realtime Database transactions
- Anonymous Firebase Authentication
- Realtime position/radius sync
- Shared food pellets with transaction-based claiming
- Host migration if the room creator disconnects
- `onDisconnect()` ghost-player cleanup
- Mouse, pen, and touch pointer controls
- Shared team-mass goal
- Responsive canvas UI

## Firebase setup

1. Create a Firebase project.
2. Add a **Web App** to the project and copy its config object.
3. In **Realtime Database**, create a database.
4. In **Authentication > Sign-in method**, enable **Anonymous** sign-in.
5. Paste the Firebase config into `app.js`. Make sure the config includes `databaseURL`.
6. Deploy `database.rules.json` to Realtime Database Rules.

The included browser imports use Firebase Web SDK `12.17.1` from Google's CDN.

## Run locally

ES modules should be served over HTTP rather than opened as a raw file. From this folder, run one of:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Deploy with Firebase Hosting

If you have Firebase CLI installed:

```bash
firebase login
firebase use --add
firebase deploy --only database,hosting
```

You can also upload `index.html`, `style.css`, and `app.js` to any static host (Netlify, Vercel static hosting, GitHub Pages, Cloudflare Pages, etc.). Realtime Database remains the multiplayer backend.

## Data layout

```text
rooms/{ROOM_CODE}
  meta/
    hostUid
    createdAt
    goal
    world
  players/{0|1}/
    uid, name, x, y, radius, color, joinedAt, lastSeen
  food/{foodId}/
    x, y, r, color, claimedBy?
```

## Notes for production

This is a playable prototype. Firebase clients are not authoritative game servers, so a modified browser client can cheat. For competitive gameplay, validate movement/growth server-side (for example with a dedicated authoritative server) and add abuse protection such as App Check. The included database rules restrict player writes to their own player record, but room metadata and food still need to be writable by room members for this serverless prototype.
