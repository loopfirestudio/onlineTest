# Blob Royale — Build 2.0.1 Performance

A browser-based Agar.io-inspired **1–3 player PvPvE free-for-all** using Firebase Realtime Database.

## Core mode

- Up to **3 human players** in one room.
- The host can start playing immediately; Player 2 and Player 3 can join the running room later.
- **Everyone fights everyone**: larger player cells can eat smaller rival player cells.
- A full PvP death respawns that player at starting size with a short visible shield.
- Split cells can be eaten individually without killing the whole player.
- PvP kills are tracked separately from bot kills.
- Top-10 leaderboard ranks humans and bot families by current mass.

## PvE retained

- 5000×4000 arena.
- 30 bot families.
- Hunter / Rival / Chaos / Dumb / Cannibal bot personalities.
- Cannibal bots actively eat other bot families and can naturally snowball into giant threats.
- Fear/reputation system: non-Hunter bots become more cautious around players with many total kills.
- Bots eat pellets, players and other bots, split, grow and merge.

## Player systems retained

- Mouse/touch movement.
- `Space` / SPLIT button to split.
- Up to 4 player cells.
- Automatic merge cooldown.
- Maximum displayed cell size: 10,000.
- 400 pellets with spatial-grid collision optimization.
- Canvas LOD/performance optimizations for very large cells.

## Removed co-op-only systems

Because this is now a true FFA, the old team-goal, mass-transfer and co-op-partner arrow systems are removed.

## Same-PC testing

Authentication uses **in-memory anonymous Firebase persistence**, so separate browser tabs receive separate anonymous UIDs. This allows testing Player 1, Player 2 and Player 3 in three tabs on one PC.

## Firebase setup

1. Keep Anonymous Authentication enabled.
2. Open Firebase Console → Realtime Database → Rules.
3. Replace the currently published rules completely with this build's `database.rules.json`.
4. Publish the rules.
5. Serve the folder from Firebase Hosting or another HTTP server.
6. Create a fresh room after deploying the rules.

The included ruleset is dedicated to this Agar.io FFA project and uses `/rooms`.


## Build 2.0.1-performance

Gameplay unchanged. Performance pass: split Firebase listeners, 20 Hz host AI, 5 Hz bot position sync, spatial bot AI/cannibal collision grid, visible-only pellet rendering, throttled local collisions/HUD, reduced Canvas2D blur, and slower sync for non-visual bot AI state.

### Performance changes
- Firebase listeners split by hot path; bot movement no longer rebuilds the complete room snapshot.
- Food uses incremental child events and an incrementally maintained spatial grid.
- Join reads only metadata + player slots instead of downloading the full room first.
- Host AI runs at 20 Hz and bot rendering/network interpolation remains smooth.
- Host hunter/cannibal/rival searches and bot-vs-bot eating use a spatial grid instead of all-pairs scans.
- Slow AI state sync is separated from 5 Hz position/size sync.
- Local pellet/bot collisions run ~29 Hz instead of every rendered frame.
- Bot entry arrays are cached per network snapshot to reduce garbage collection.
- Visible-only pellet rendering; fewer bot details during crowded split fights.
- Canvas uses alpha:false/desynchronized where supported, DPR capped at 1.25, gameplay backdrop blur removed.
- Full rendering is rate-limited on high-refresh displays while input/movement remain responsive.

No database schema or rules changes are required versus Build 2.0.0.


## Build 2.0.4-clientfix2
- Restored reliable `onValue` bot snapshots for clients.
- Removed the child-event-only movement path that could stop updating.
- Removed the permanent in-flight bot-network lock that could freeze all future host snapshots.
- Bot positions sync at 10 Hz; clients use bounded render-only prediction/interpolation.
- Host ignores ordinary movement echoes when reconciling authoritative bots.
- Added visible runtime diagnostics for unexpected client errors.


## 2.0.4 client hotfix
- Restores the missing `clamp()` helper used by client-side bot prediction.
- Static reference audit with TypeScript checkJs; no other missing global helpers detected.
