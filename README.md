# Blob Buddies — Build 1.6.0 Polished

A 2-player Agar.io-inspired browser co-op game synchronized with Firebase Realtime Database.

## What changed in this build

- Arena doubled from **3000×2000** to **6000×4000**.
- Enemy population remains **40 bot families** with Hunter, Rival, Chaos, and Dumb personalities.
- Normal/rare pellet target increased from 220 to **400** to better populate the larger arena without making the Firebase room excessively heavy.
- Team goal remains **5000**.
- Maximum individual cell size remains **10,000** (radius 1000).
- Rare spiky pellets still give exactly **+25 size**.
- Top-10 leaderboard, co-op partner arrow, player splitting, bot splitting, and the live player-size HUD remain included.

## Eating / collision polish

This build also fixes several gameplay edge cases:

- The hosting player now checks enemy collisions against the host's current simulated bot positions instead of delayed Firebase snapshots.
- The second player collides against the interpolated bot positions that are actually being drawn on their screen, making visual contact and eating line up better.
- Eating only requires a clear size advantage and sensible overlap, making player-vs-bot and bot-vs-bot consumption more consistent.
- Respawn invulnerability now blocks incoming bot damage only; it no longer prevents you from eating a smaller bot.
- Losing one split cell gives only a tiny anti-double-hit grace window. A full death/respawn still gives the longer shield.
- Bots now gain mass when they successfully eat a player cell.
- Player growth from pellets and eaten bots is pushed to Firebase immediately after a successful claim.
- Claimed pellets are cleaned up by the host if a client disconnects or a remove request is interrupted, preventing invisible/stuck food from reducing the pellet population.
- Empty bot families respawn through a short controlled respawn queue, avoiding remove/recreate races that could make enemy eating feel unreliable.

## Controls

- **Move:** mouse, pen, or finger
- **Split:** `Space` or the on-screen `SPLIT` button

Players can have up to four cells. Bots can also split into multiple cells and later merge.

## Firebase setup

The supplied Firebase web config is already present in `app.js`.

You still need to:

1. Enable **Authentication → Sign-in method → Anonymous**.
2. Create/enable **Realtime Database**.
3. Publish the included `database.rules.json`. **This build changes the allowed world bounds to 6000×4000 and adds the small `botMeals` event path used to credit bots for eating player cells.**
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

The room host remains authoritative for enemy-bot movement, bot splitting, bot-vs-bot eating, respawns, and pellet maintenance. Each player remains authoritative for their own movement and for detecting when one of their own cells is eaten. A small synchronized `botMeals` event lets the host safely apply the corresponding bot growth.
