# Blob Buddies — Build 1.8.0 — Co-op Bosses + Mass Transfer

A 2-player Agar.io-inspired browser co-op game synchronized with Firebase Realtime Database.

## What changed in this build

- Arena remains **5000×4000**.
- Enemy population remains **30 regular bot families**.
- Added **2 co-op boss families**: Void Titan and Crimson Colossus.
  - Each boss initially spawns as multiple huge cells.
  - Bosses aggressively pressure the human team, can split-attack vulnerable players, grow by eating, merge again, and respawn after the whole boss family is defeated.
  - Boss families can split into up to 6 cells, making them a team encounter rather than one oversized normal bot.
- Added **mass transfer**. Press `W` or tap `TRANSFER` to donate roughly 8% of your current mass to your teammate (minimum 15, maximum 220 per transfer, with a short cooldown).
- Removed the rare **+25 spiky pellets** completely. All map pellets are normal food again.
- Team goal remains **5000**.
- Maximum individual player cell size remains **10,000** (radius 1000).
- Existing Hunter, Rival, Chaos, and Dumb bot personalities remain enabled.
- Top-10 leaderboard, co-op partner arrow, player/bot splitting, host eating fix, and live player-size HUD remain included.

## Performance changes

- Bot simulation now runs at ~25 Hz and bot network snapshots at a lower rate while rendering still uses `requestAnimationFrame`.
- Canvas resolution is capped at **1.5× device pixel ratio** instead of 2×, reducing fill-rate cost on high-DPI screens.
- Pellet collision and bot food-search logic now use a **spatial grid**, avoiding full scans of all pellets for most cells.
- HUD/leaderboard DOM updates are throttled instead of rebuilding on every Realtime Database room snapshot.
- The leaderboard no longer converts the host bot Map into a temporary object every update.
- Existing giant-cell LOD, collision squared-distance checks, off-screen culling, and Firebase claim back-pressure remain enabled.

## Controls

- **Move:** mouse, pen, or finger
- **Split:** `Space` or the on-screen `SPLIT` button
- **Transfer mass:** `W` or the on-screen `TRANSFER` button

Mass transfer is delivered through a small Firebase transfer queue so neither player needs permission to directly edit the other player's database state.

## Firebase setup

The supplied Firebase web config is already present in `app.js`.

You still need to:

1. Enable **Authentication → Sign-in method → Anonymous**.
2. Create/enable **Realtime Database**.
3. **Publish the included `database.rules.json`**. This build adds the secure `/transfers` queue required for mass transfer.
4. Serve the files over HTTP/HTTPS rather than opening `index.html` as a `file://` URL.
5. Hard-refresh both browsers and create a **new room** after upgrading from an older build.

## Run locally

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Firebase Hosting

```bash
firebase login
firebase use --add
firebase deploy --only database,hosting
```

## Synchronization

The room host is authoritative for regular bots, bosses, bot splitting/merging, bot-vs-bot eating, boss respawns, and pellet maintenance. Each player remains authoritative for their own movement and cell state. Mass transfers are created by the sender and atomically claimed/deleted by the intended recipient.
