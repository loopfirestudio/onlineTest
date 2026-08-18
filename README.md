# Blob Buddies — Build 1.5.0 Personality Bots

A 2-player Agar.io-inspired browser co-op game synchronized with Firebase Realtime Database.

## What changed in this build

- The arena is back to the original **3000×2000** size.
- Enemy population is now **40 bot families**. Bots can still split, so the visible enemy cell count can temporarily exceed 40.
- Bots now have four personalities:
  - **Hunter** — prioritizes the two players, flees intelligently, and uses calculated split-attacks.
  - **Rival** — hunts edible bots from other families first, then players.
  - **Chaos** — wanders unpredictably and randomly splits.
  - **Dumb** — weak awareness and poor food choices; sometimes splits randomly.
- Maximum individual cell size/mass is increased to **10,000** (radius 1000).
- The top HUD now shows each player's live **SIZE** as well as their split-cell count.
- Added rare **spiky pellets**. They are larger, visibly spiked, and add exactly **+25 size/mass** when eaten. Bots can eat them too.
- Team goal remains **5000**.
- Top-10 leaderboard, co-op partner arrow, player splitting, bot splitting, host migration, and the second-player join fix remain included.
- Normal pellet target is **220**, balanced for the smaller arena and 40 bots.

## Controls

- **Move:** mouse, pen, or finger
- **Split:** `Space` or the on-screen `SPLIT` button

Players can have up to four cells. Bots can also split into multiple cells and later merge.

## Firebase setup

The supplied Firebase web config is already present in `app.js`.

You still need to:

1. Enable **Authentication → Sign-in method → Anonymous**.
2. Create/enable **Realtime Database**.
3. Publish the included `database.rules.json`. **This build changes the world bounds back to 3000×2000 and raises the allowed cell radius to 1000, so the new rules are required.**
4. Serve the files over HTTP/HTTPS rather than opening `index.html` as a `file://` URL.
5. After replacing an older build, hard-refresh both browsers and create a new room.

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

## Notes on synchronization

The room host is authoritative for enemy-bot simulation. All clients receive bot state through Realtime Database. The leaderboard is calculated locally from synchronized player and bot state. With bot splitting enabled, 40 families can still create more than 40 live bot cells for short periods.
