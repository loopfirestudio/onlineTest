# Blob Buddies — 2 Player Co-op + Splitting Enemy Bots

An Agar.io-inspired browser co-op game that synchronizes two players and an enemy-bot ecosystem through **Firebase Realtime Database**.

## Features

- 6-character room codes
- Exactly two player slots, claimed with Realtime Database transactions
- Anonymous Firebase Authentication
- Realtime player position, mass, and split-cell synchronization
- **600 team-mass goal**
- **Player splitting:** press `Space` on desktop or tap the on-screen `SPLIT` button
- Players can have up to **4 cells** at once
- Split cells launch toward the cursor/finger aim, stay separated temporarily, then automatically merge again
- **8 enemy bot families** with host-authoritative AI
- Bots roam, hunt smaller player cells, flee from larger cells, and seek pellets
- **Bots can split-attack players**, creating synchronized child cells
- Bot-family cells automatically merge again after their split cooldown
- Bots eat pellets, grow, and different bot families can eat one another
- Players can eat sufficiently smaller bot cells and gain their mass
- Larger bot cells can eat individual player split cells; if all player cells are lost, the player respawns with a short shield
- Shared food pellets with transaction-based claiming
- Host migration if the current host disconnects
- `onDisconnect()` ghost-player cleanup
- Mouse, pen, and touch movement controls
- Responsive canvas UI

## Controls

- **Move:** mouse, pen, or finger
- **Split:** `Space` or the `SPLIT` button

A player cell must be large enough before it can split. A split divides that cell's area in half, launches the new cell toward your aim, and preserves total mass. Up to four player cells can exist at once.

## Firebase setup

This copy already contains the Firebase web config supplied for the `testonlinerealtime` project.

You still need to make sure that:

1. **Realtime Database** exists in the Firebase project.
2. **Authentication > Sign-in method > Anonymous** is enabled.
3. The included `database.rules.json` is deployed. **Deploy the rules from this version** because the player and bot data structures now include split-cell state.

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
    goal = 600
    world
  players/{0|1}/
    uid, name, x, y, radius, color, joinedAt, lastSeen
    pieces/{pieceId}/
      x, y, radius, vx, vy, mergeAt
  food/{foodId}/
    x, y, r, color, claimedBy?
  bots/{botCellId}/
    family, name, x, y, radius, color
    vx, vy, boostX, boostY
    turnAt, mergeAt, splitReadyAt, eatenBy?
```

## Synchronization model

Each authenticated player owns and writes only their own player slot, including their split cells. Food and enemy claims use transactions.

Only the room host continuously simulates bot AI and bot splitting. A split bot creates additional bot-cell records belonging to the same `family`. When the host leaves, the existing host-election mechanism transfers bot simulation to the remaining player.

## Production note

This is a playable serverless prototype, not an authoritative competitive game server. A modified browser client can still cheat. For competitive gameplay, move collision/mass validation to an authoritative server and consider protections such as Firebase App Check.
