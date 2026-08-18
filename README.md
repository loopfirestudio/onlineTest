# Blob Buddies — 2 Player Co-op + Enemy Bots

An Agar.io-inspired browser co-op game that syncs two players and a shared enemy-bot ecosystem through **Firebase Realtime Database**.

## Features

- 6-character room codes
- Exactly two player slots, claimed with Realtime Database transactions
- Anonymous Firebase Authentication
- Realtime player position/radius sync
- **8 synchronized enemy bots**
- Host-authoritative bot movement so both players see the same enemies
- Bot AI that roams, hunts smaller players, flees from larger players, and seeks food
- Bots eat pellets, grow, and can eat each other
- Players can eat sufficiently smaller bots and gain mass
- Larger bots can eat players; eaten players respawn at starting size with a short shield
- Eaten bots automatically respawn elsewhere at a new starting size
- Shared food pellets with transaction-based claiming
- Host migration if the current host disconnects
- `onDisconnect()` ghost-player cleanup
- Mouse, pen, and touch pointer controls
- Shared team-mass goal
- Responsive canvas UI

## Firebase setup

This copy already contains the Firebase web config supplied for the `testonlinerealtime` project.

You still need to make sure that:

1. **Realtime Database** exists in the Firebase project.
2. **Authentication > Sign-in method > Anonymous** is enabled.
3. The included `database.rules.json` is deployed. **Deploy the new rules in this bot-enabled version** because they add permissions/validation for the synchronized `bots` tree.

The browser imports use Firebase Web SDK `12.17.1` from Google's CDN.

## Run locally

ES modules should be served over HTTP rather than opened as a raw `file://` page. From this folder, run:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

For a real two-player test, open the game in two different browser profiles/devices, create a room on one, and join the room code on the other.

## Deploy with Firebase Hosting

If Firebase CLI is installed:

```bash
firebase login
firebase use --add
firebase deploy --only database,hosting
```

You can also upload `index.html`, `style.css`, and `app.js` to any static host. Firebase Realtime Database remains the multiplayer backend.

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
  bots/{botId}/
    name, x, y, radius, color, vx, vy, turnAt, eatenBy?
```

## Bot synchronization model

Only the room host continuously simulates bot AI and writes bot movement to Realtime Database. When the host leaves, the existing host-election mechanism transfers bot simulation to the remaining player. A player eating a bot uses a transaction that can only add their own UID as `eatenBy`; the host then respawns that bot.

## Production note

This is a playable serverless prototype, not an authoritative competitive game server. A modified browser client can still cheat. For competitive gameplay, move collision/mass validation to an authoritative server and add protections such as Firebase App Check.
