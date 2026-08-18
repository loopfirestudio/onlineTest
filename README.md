# Blob Buddies — Build 1.4.0 Big World

A 2-player Agar.io-inspired browser co-op game synchronized with Firebase Realtime Database.

## What changed in this build

- Team goal increased to **5000 mass**.
- Enemy population increased to **50 bot families**. Bots can still split, so the number of visible enemy cells can temporarily exceed 50.
- Added a live **Top 10 leaderboard** in the top-right. It ranks both individual players and enemy bot families by mass. Split cells from the same bot family are combined for ranking.
- World increased from **3000×2000 to 9000×6000**. This is a +200% increase in each dimension (3× width and height, 9× area).
- Food target increased to **500 pellets** to better populate the larger world.
- Added an **off-screen co-op partner arrow**. When your buddy leaves the visible screen, a small arrow at the screen edge points toward them.
- Existing player and bot splitting remains enabled.
- Existing second-player join compatibility fix remains included.

## Controls

- **Move:** mouse, pen, or finger
- **Split:** `Space` or the on-screen `SPLIT` button

Players can have up to four cells. Bots can also split into multiple cells and later merge.

## Firebase setup

The supplied Firebase web config is already present in `app.js`.

You still need to:

1. Enable **Authentication → Sign-in method → Anonymous**.
2. Create/enable **Realtime Database**.
3. Publish the included `database.rules.json`. **This build changes the allowed world coordinates to 9000×6000, so the new rules are required.**
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

The room host is authoritative for enemy-bot simulation. All clients receive bot state through Realtime Database. The leaderboard is calculated locally from synchronized player and bot state, so it does not add another database write path.

With 50 bot families and bot splitting, this build is intentionally heavier than the earlier 8-bot version. For a public competitive deployment, an authoritative game server would scale better than client-hosted simulation over Realtime Database.
