# Blob Buddies — Build 1.7.0 Performance

A 2-player Agar.io-inspired browser co-op game synchronized with Firebase Realtime Database.

## What changed in this build

- Arena adjusted to **5000×4000**.
- Enemy population reduced from 40 to **20 bot families**.
- Fixed the host-side enemy eating bug. The host now consumes bots directly from its authoritative simulation instead of starting a Firebase transaction that conflicts with its own continuous bot-movement writes.
- Client-side bot eating keeps the transaction-based claim path.
- Team goal remains **5000**.
- Maximum individual cell size remains **10,000** (radius 1000).
- Rare spiky pellets still give exactly **+25 size**.
- Hunter, Rival, Chaos, and Dumb bot personalities remain enabled.
- Top-10 leaderboard, co-op partner arrow, player/bot splitting, and live player-size HUD remain included.

## Performance changes

- Host bot AI runs at about **30 Hz** instead of every display frame; rendering remains smooth with `requestAnimationFrame`.
- Bot and player Firebase movement writes are slightly less frequent to reduce network/serialization overhead.
- Hot collision checks use squared-distance math instead of repeated square roots where possible.
- Bot food lists are allocated once per AI tick instead of once per bot.
- Host rendering/collision paths iterate the in-memory bot map directly instead of rebuilding objects every frame.
- Large cells switch to a cheaper canvas detail level: expensive glow effects are disabled and line widths are capped.
- Giant off-screen player cells are culled instead of being drawn unnecessarily.
- Pellet and bot eating uses request back-pressure, preventing giant cells from launching hundreds of simultaneous Firebase transactions when they overlap a large cluster.
- Bot pellet claims also have a global concurrency cap to prevent large enemy cells from flooding the database.
- Bot eye detail is skipped for extremely large cells.
- Surplus bot families from older rooms are automatically removed by the host, though creating a new room is still recommended.

## Controls

- **Move:** mouse, pen, or finger
- **Split:** `Space` or the on-screen `SPLIT` button

Players can have up to four cells. Bots can also split into multiple cells and later merge.

## Firebase setup

The supplied Firebase web config is already present in `app.js`.

You still need to:

1. Enable **Authentication → Sign-in method → Anonymous**.
2. Create/enable **Realtime Database**.
3. Publish the included `database.rules.json`. This build changes the allowed X coordinate bound to **5000** while keeping the Y bound at **4000**.
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

## Synchronization

The room host is authoritative for enemy movement, bot splitting, bot-vs-bot eating, respawns, and pellet maintenance. Each player remains authoritative for their own movement. Host bot eating is now handled directly by the authoritative host simulation to avoid self-conflicting Firebase transactions.
