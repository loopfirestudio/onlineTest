# Blob Buddies — Build 1.8.3 Cannibal + Fear

## New in 1.8.3

- Added **Cannibal bots**. Six of the 30 regular bot families use the new Cannibal personality. They actively search a wide area for smaller enemy bot families, split-attack good targets, and keep extra mass from bot-on-bot kills. This lets a normal-looking bot naturally snowball into a giant threat without any boss system.
- Added a **Fear / reputation system**. Every bot cell a player eats increases that player's room kill count. Rival, Chaos, and Dumb bots become progressively more cautious as a player's kill count rises: they detect that player from farther away, flee sooner, and require a larger size advantage before willingly approaching as a predator.
- **Hunter bots ignore reputation fear** and remain aggressive toward players, so high kill counts do not make the entire map passive.
- Player kill counts are shown in the top player HUD as `KILLS`.
- Kill reputation is stored under the room's host-authoritative `stats/playerKills` data, so both players have separate reputations and the count survives host migration during the room.

## Existing gameplay retained

- 5000×4000 map
- 30 regular bot families
- Host can play immediately before Player 2 joins
- 5000 team goal
- Maximum displayed cell size 10,000
- Player and bot splitting/merging
- Mass transfer between co-op partners
- Hunter / Rival / Chaos / Dumb personalities plus the new Cannibal personality
- Top-10 leaderboard
- Off-screen co-op partner arrow
- Performance optimizations from the 1.8.x builds
- No boss enemies

## Firebase update required

This build adds `stats/playerKills`, so publish the included `database.rules.json` in Firebase Realtime Database before testing.

After publishing the rules, hard-refresh both browsers and create a new room so the new bot personality distribution is present immediately.
