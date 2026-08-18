// Blob Buddies — 2-player Agar.io-inspired co-op with synchronized personality-driven splitting enemy bots.
// Build 1.7 fixes host-authoritative eating and reduces CPU/GPU work for large cells.
// Firebase Web SDK 12.17.1 via Google's CDN.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onDisconnect,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDd555TxypX12AUjMWx_lmkeVFGgQDHJqw",
  authDomain: "testonlinerealtime.firebaseapp.com",
  databaseURL: "https://testonlinerealtime-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "testonlinerealtime",
  storageBucket: "testonlinerealtime.firebasestorage.app",
  messagingSenderId: "257019969127",
  appId: "1:257019969127:web:0a910b0fe08fde4d60dec2",
};

const BUILD_VERSION = "1.7.0-performance";
const WORLD = { width: 5000, height: 4000 };
const FOOD_TARGET = 400;
const SPIKY_FOOD_CHANCE = 0.025;
const SPIKY_FOOD_MASS = 25;
const TEAM_GOAL = 5000;
const START_RADIUS = 30;

const MAX_PLAYER_PIECES = 4;
const PLAYER_SPLIT_MIN_RADIUS = 38;
const PLAYER_SPLIT_BOOST = 650;
const PLAYER_MERGE_MS = 6500;
const PLAYER_SPLIT_COOLDOWN_MS = 350;

const BOT_FAMILY_COUNT = 20;
const BOT_EAT_RATIO = 1.10;
const EAT_OVERLAP_FACTOR = 0.18;
const BOT_RESPAWN_MIN_RADIUS = 22;
const BOT_RESPAWN_MAX_RADIUS = 43;
const BOT_MAX_FAMILY_CELLS = 4;
const BOT_SPLIT_MIN_RADIUS = 42;
const BOT_SPLIT_BOOST = 590;
const BOT_MERGE_MS = 7000;

// Performance tuning: AI does not need to run at display refresh rate. Rendering
// stays at requestAnimationFrame speed while host AI is capped near 30 Hz.
const BOT_SIM_INTERVAL_MS = 34;
const PLAYER_NETWORK_INTERVAL_MS = 65;
const BOT_NETWORK_INTERVAL_MS = 125;
const LARGE_CELL_LOD_RADIUS = 180;
const MAX_CONCURRENT_FOOD_CLAIMS = 10;
const MAX_NEW_FOOD_CLAIMS_PER_TICK = 3;
const MAX_CONCURRENT_BOT_FOOD_CLAIMS = 8;
const MAX_BOT_EATS_PER_TICK = 4;

// Displayed size/mass is radius² / 100, so radius 1000 = size 10,000.
const MAX_CELL_MASS = 10000;
const MAX_CELL_RADIUS = Math.sqrt(MAX_CELL_MASS * 100);

const COLORS = ["#72e7ff", "#a78bfa"];
const FOOD_COLORS = ["#75f0ba", "#ffd166", "#ff7aa8", "#7bdff2", "#b8f2e6", "#cdb4ff"];
const BOT_COLORS = ["#ff5f6d", "#ff8c42", "#ff477e", "#ef476f", "#f78c6b", "#ff6b6b", "#f25f5c", "#e85d75"];
const BOT_NAMES = ["Chomper", "Razor", "Glitch", "NomNom", "Viper", "Crimson", "Munch", "Hunter"];
const BOT_PERSONALITIES = ["hunter", "rival", "chaos", "dumb"];
const BOT_PERSONALITY_LABELS = { hunter: "Hunter", rival: "Rival", chaos: "Chaos", dumb: "Dumb" };

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const menu = document.querySelector("#menu");
const hud = document.querySelector("#hud");
const leaveBtn = document.querySelector("#leaveBtn");
const splitBtn = document.querySelector("#splitBtn");
const createBtn = document.querySelector("#createBtn");
const joinBtn = document.querySelector("#joinBtn");
const copyBtn = document.querySelector("#copyBtn");
const nameInput = document.querySelector("#nameInput");
const roomInput = document.querySelector("#roomInput");
const menuStatus = document.querySelector("#menuStatus");
const roomCodeEl = document.querySelector("#roomCode");
const scoreEl = document.querySelector("#score");
const goalEl = document.querySelector("#goal");
const progressBar = document.querySelector("#progressBar");
const playersList = document.querySelector("#playersList");
const botsCountEl = document.querySelector("#botsCount");
const leaderboard = document.querySelector("#leaderboard");
const leaderboardList = document.querySelector("#leaderboardList");
const banner = document.querySelector("#banner");

goalEl.textContent = String(TEAM_GOAL);
const buildVersionEl = document.querySelector("#buildVersion");
if (buildVersionEl) buildVersionEl.textContent = `Build ${BUILD_VERSION}`;

let app;
let auth;
let db;
let uid = null;
let roomId = null;
let roomUnsubscribe = null;
let connectedUnsubscribe = null;
let roomState = null;
let local = null;
let localSlot = null;
let localHost = false;
let lastNetworkWrite = 0;
let hostLoopAt = 0;
let lastBotNetworkWrite = 0;
let lastBotSimAt = 0;
let eating = new Set();
let botEating = new Set();
let botClaiming = new Set();
let botRemoving = new Set();
let botMealProcessing = new Set();
let botRespawnAt = new Map();
let won = false;
let invulnerableUntil = 0;
let deathNoticeUntil = 0;
let deathNotice = "";
let previousPlayerCount = 0;
let lastPlayerSplitAt = 0;

const pointer = { x: innerWidth / 2, y: innerHeight / 2, active: true };
const renderPlayerPieces = new Map();
const renderBots = new Map();
const hostBots = new Map();

function firebaseConfigured() {
  return !Object.values(firebaseConfig).some((v) => String(v).includes("PASTE_YOUR"));
}

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  crypto.getRandomValues(new Uint32Array(6)).forEach((n) => (out += chars[n % chars.length]));
  return out;
}

function randomName() {
  const a = ["Bouncy", "Cosmic", "Mellow", "Tiny", "Neon", "Wiggly", "Turbo", "Jolly"];
  const b = ["Blob", "Mochi", "Cell", "Buddy", "Bean", "Orbit", "Gloop", "Dot"];
  return `${a[Math.floor(Math.random() * a.length)]} ${b[Math.floor(Math.random() * b.length)]}`;
}

function cleanName(name) {
  return (name || "").trim().replace(/[<>]/g, "").slice(0, 18) || randomName();
}

function makePiece(x, y, radius, mergeAt = 0, vx = 0, vy = 0) {
  return { x, y, radius, vx, vy, mergeAt };
}

function makePlayer(slot = 0) {
  const x = WORLD.width / 2 + (slot ? 90 : -90);
  const y = WORLD.height / 2;
  return {
    uid,
    name: cleanName(nameInput.value),
    x,
    y,
    radius: START_RADIUS,
    color: COLORS[slot % COLORS.length],
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    pieces: { p0: makePiece(x, y, START_RADIUS) },
  };
}

function makeFood(count = FOOD_TARGET) {
  const food = {};
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const spiky = Math.random() < SPIKY_FOOD_CHANCE;
    food[id] = {
      x: 45 + Math.random() * (WORLD.width - 90),
      y: 45 + Math.random() * (WORLD.height - 90),
      r: spiky ? 16 + Math.random() * 3 : 6 + Math.random() * 4,
      color: spiky ? "#f5ff72" : FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)],
      kind: spiky ? "spiky" : "normal",
      mass: spiky ? SPIKY_FOOD_MASS : 0,
    };
  }
  return food;
}

function makeBot(index = 0, id = `bot${index}`) {
  const angle = Math.random() * Math.PI * 2;
  const radius = BOT_RESPAWN_MIN_RADIUS + Math.random() * (BOT_RESPAWN_MAX_RADIUS - BOT_RESPAWN_MIN_RADIUS);
  const now = Date.now();
  const personality = BOT_PERSONALITIES[index % BOT_PERSONALITIES.length];
  return {
    family: `bot${index}`,
    name: `${BOT_PERSONALITY_LABELS[personality]} ${BOT_NAMES[index % BOT_NAMES.length]} ${String(index + 1).padStart(2, "0")}`,
    personality,
    x: 100 + Math.random() * (WORLD.width - 200),
    y: 100 + Math.random() * (WORLD.height - 200),
    radius: Math.round(radius * 100) / 100,
    color: BOT_COLORS[index % BOT_COLORS.length],
    vx: Math.cos(angle),
    vy: Math.sin(angle),
    boostX: 0,
    boostY: 0,
    turnAt: now + 700 + Math.floor(Math.random() * 2600),
    mergeAt: 0,
    splitReadyAt: now + 1800 + Math.floor(Math.random() * 2800),
  };
}

function makeBots(count = BOT_FAMILY_COUNT) {
  const bots = {};
  for (let i = 0; i < count; i++) bots[`bot${i}`] = makeBot(i, `bot${i}`);
  return bots;
}

function botIndexFromFamily(family) {
  const n = Number(String(family || "bot0").replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function piecesOf(player) {
  if (player?.pieces && Object.keys(player.pieces).length) return player.pieces;
  if (!player) return {};
  return { p0: makePiece(player.x, player.y, player.radius) };
}

function aggregatePieces(pieces) {
  const values = Object.values(pieces || {}).filter(Boolean);
  if (!values.length) return { x: WORLD.width / 2, y: WORLD.height / 2, radius: START_RADIUS, area: START_RADIUS ** 2 };
  let area = 0;
  let wx = 0;
  let wy = 0;
  for (const p of values) {
    const a = Math.max(1, p.radius ** 2);
    area += a;
    wx += p.x * a;
    wy += p.y * a;
  }
  return { x: wx / area, y: wy / area, radius: Math.sqrt(area), area };
}

function syncLocalAggregate() {
  if (!local) return;
  const aggregate = aggregatePieces(local.pieces);
  local.x = aggregate.x;
  local.y = aggregate.y;
  local.radius = Math.min(MAX_CELL_RADIUS, aggregate.radius);
}

function publicPlayerPayload() {
  syncLocalAggregate();
  const pieces = {};
  for (const [id, p] of Object.entries(local.pieces || {})) {
    pieces[id] = {
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      radius: Math.round(p.radius * 100) / 100,
      vx: Math.round((p.vx || 0) * 100) / 100,
      vy: Math.round((p.vy || 0) * 100) / 100,
      mergeAt: Math.round(p.mergeAt || 0),
    };
  }
  return {
    x: Math.round(local.x * 10) / 10,
    y: Math.round(local.y * 10) / 10,
    radius: Math.round(local.radius * 100) / 100,
    pieces,
    lastSeen: Date.now(),
  };
}

async function ensureFirebase() {
  if (!firebaseConfigured()) throw new Error("Firebase is not configured yet. Paste your Firebase web config into app.js first.");
  if (uid) return;
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
  const result = await signInAnonymously(auth);
  uid = result.user.uid;
}

function setBusy(busy, message = "") {
  createBtn.disabled = busy;
  joinBtn.disabled = busy;
  menuStatus.textContent = message;
}

async function createRoom() {
  try {
    setBusy(true, "Connecting…");
    await ensureFirebase();

    let candidate;
    for (let tries = 0; tries < 8; tries++) {
      candidate = randomRoomCode();
      const snap = await get(ref(db, `rooms/${candidate}`));
      if (!snap.exists()) break;
      candidate = null;
    }
    if (!candidate) throw new Error("Could not allocate a room code. Try again.");

    const player = makePlayer(0);
    await set(ref(db, `rooms/${candidate}`), {
      meta: { hostUid: uid, createdAt: serverTimestamp(), goal: TEAM_GOAL, world: WORLD },
      players: { 0: player },
      food: makeFood(),
      bots: makeBots(),
    });

    await enterRoom(candidate, player, 0);
  } catch (err) {
    console.error(err);
    setBusy(false, friendlyError(err));
  }
}

async function joinRoom() {
  try {
    setBusy(true, "Joining…");
    await ensureFirebase();
    const code = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length !== 6) throw new Error("Enter a 6-character room code.");

    const roomSnap = await get(ref(db, `rooms/${code}`));
    if (!roomSnap.exists()) throw new Error("Room not found.");
    const data = roomSnap.val();
    const existing = data.players || {};

    const alreadyInRoom = Object.entries(existing).find(([, p]) => p?.uid === uid);
    let claimedSlot = alreadyInRoom ? Number(alreadyInRoom[0]) : null;
    let player = alreadyInRoom ? alreadyInRoom[1] : null;

    if (claimedSlot === null) {
      for (const slot of [0, 1]) {
        const candidate = makePlayer(slot);
        const result = await runTransaction(
          ref(db, `rooms/${code}/players/${slot}`),
          (current) => {
            if (current?.uid === uid) return current;
            if (current) return;
            return candidate;
          },
          { applyLocally: false },
        );
        if (result.committed && result.snapshot.val()?.uid === uid) {
          claimedSlot = slot;
          player = result.snapshot.val();
          break;
        }
      }
    }

    if (claimedSlot === null || !player) throw new Error("That room already has two players.");
    if (!player.pieces) player.pieces = { p0: makePiece(player.x, player.y, player.radius) };
    await enterRoom(code, player, claimedSlot);
  } catch (err) {
    console.error(err);
    setBusy(false, friendlyError(err));
  }
}

async function enterRoom(code, player, slot) {
  roomId = code;
  local = { ...player, pieces: structuredClone(piecesOf(player)) };
  syncLocalAggregate();
  localSlot = slot;
  won = false;
  previousPlayerCount = 0;
  lastBotSimAt = 0;
  lastBotNetworkWrite = 0;
  renderPlayerPieces.clear();
  renderBots.clear();
  hostBots.clear();
  roomCodeEl.textContent = code;
  menu.classList.add("hidden");
  hud.classList.remove("hidden");
  leaderboard?.classList.remove("hidden");
  leaveBtn.classList.remove("hidden");
  splitBtn?.classList.remove("hidden");
  setBusy(false, "");

  const playerRef = ref(db, `rooms/${roomId}/players/${localSlot}`);
  await onDisconnect(playerRef).remove();

  const roomRef = ref(db, `rooms/${roomId}`);
  roomUnsubscribe = onValue(roomRef, async (snap) => {
    if (!snap.exists()) {
      showBanner("Room closed");
      await leaveRoom(false);
      return;
    }

    roomState = snap.val();
    const players = roomState.players || {};
    const meta = roomState.meta || {};
    const playerValues = Object.values(players);
    if (playerValues.length >= 2 && previousPlayerCount < 2) invulnerableUntil = Math.max(invulnerableUntil, performance.now() + 2400);
    previousPlayerCount = playerValues.length;

    const selfPresent = playerValues.some((p) => p?.uid === uid);
    const hostPresent = playerValues.some((p) => p?.uid === meta.hostUid);
    const wasHost = localHost;
    localHost = meta.hostUid === uid;
    if (localHost !== wasHost) {
      hostBots.clear();
      botRespawnAt.clear();
      botMealProcessing.clear();
      lastBotSimAt = 0;
      lastBotNetworkWrite = 0;
    }

    if ((!meta.hostUid || !hostPresent) && selfPresent) {
      runTransaction(ref(db, `rooms/${roomId}/meta/hostUid`), (current) => {
        const currentPresent = playerValues.some((p) => p?.uid === current);
        if (!current || !currentPresent) return uid;
        return current;
      }).catch(console.warn);
    }

    if (!selfPresent) {
      showBanner("You were disconnected from the room");
      await leaveRoom(false);
      return;
    }

    updateHud(players, roomState.bots || {});
  });

  connectedUnsubscribe = onValue(ref(db, ".info/connected"), (snap) => {
    if (snap.val() === true && roomId) onDisconnect(ref(db, `rooms/${roomId}/players/${localSlot}`)).remove().catch(console.warn);
  });
}

async function leaveRoom(removeSelf = true) {
  const oldRoom = roomId;
  const wasHost = localHost;

  roomUnsubscribe?.();
  connectedUnsubscribe?.();
  roomUnsubscribe = null;
  connectedUnsubscribe = null;

  if (removeSelf && db && oldRoom && uid) {
    try { await remove(ref(db, `rooms/${oldRoom}/players/${localSlot}`)); } catch (e) { console.warn(e); }
  }

  if (db && oldRoom && wasHost) {
    try {
      const playersSnap = await get(ref(db, `rooms/${oldRoom}/players`));
      if (!playersSnap.exists()) await remove(ref(db, `rooms/${oldRoom}`));
    } catch (e) { console.warn(e); }
  }

  roomId = null;
  roomState = null;
  local = null;
  localSlot = null;
  localHost = false;
  renderPlayerPieces.clear();
  renderBots.clear();
  hostBots.clear();
  eating.clear();
  botEating.clear();
  botClaiming.clear();
  botRemoving.clear();
  botMealProcessing.clear();
  botRespawnAt.clear();
  won = false;
  invulnerableUntil = 0;
  deathNoticeUntil = 0;
  previousPlayerCount = 0;
  lastBotSimAt = 0;
  lastBotNetworkWrite = 0;
  hideBanner();
  hud.classList.add("hidden");
  leaderboard?.classList.add("hidden");
  leaveBtn.classList.add("hidden");
  splitBtn?.classList.add("hidden");
  menu.classList.remove("hidden");
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (msg.includes("auth/operation-not-allowed")) return "Enable Anonymous sign-in in Firebase Authentication.";
  if (msg.toLowerCase().includes("permission_denied") || msg.toLowerCase().includes("permission denied")) return "Firebase denied the request. Deploy the database.rules.json from this build, then hard-refresh both browsers.";
  if (msg.includes("Failed to fetch") || msg.includes("network")) return "Network connection failed.";
  return msg;
}

function playerMass(player) {
  return Math.round(aggregatePieces(piecesOf(player)).area / 100);
}

function teamMass(players) {
  return Object.values(players).reduce((sum, p) => sum + playerMass(p), 0);
}

function growRadiusFromFood(radius, food, normalFactor = 0.82) {
  const currentArea = Math.max(1, radius ** 2);
  if (food?.kind === "spiky" || Number(food?.mass) === SPIKY_FOOD_MASS) {
    return Math.sqrt(currentArea + SPIKY_FOOD_MASS * 100);
  }
  return Math.sqrt(currentArea + (food?.r || 7) ** 2 * normalFactor);
}

function canConsume(bigRadius, smallRadius, distance, ratio = BOT_EAT_RATIO) {
  if (!Number.isFinite(bigRadius) || !Number.isFinite(smallRadius) || !Number.isFinite(distance)) return false;
  if (bigRadius < smallRadius * ratio) return false;
  // Require the smaller cell's center to be clearly inside the larger one, while
  // staying forgiving enough that visual interpolation still feels responsive.
  return distance <= bigRadius - smallRadius * EAT_OVERLAP_FACTOR;
}

function canConsumeSquared(bigRadius, smallRadius, distanceSq, ratio = BOT_EAT_RATIO) {
  if (!Number.isFinite(bigRadius) || !Number.isFinite(smallRadius) || !Number.isFinite(distanceSq)) return false;
  if (bigRadius < smallRadius * ratio) return false;
  const threshold = bigRadius - smallRadius * EAT_OVERLAP_FACTOR;
  return threshold > 0 && distanceSq <= threshold * threshold;
}

function botFamilyMasses(bots = {}) {
  const families = new Map();
  const source = localHost && hostBots.size ? Object.fromEntries(hostBots) : bots;
  for (const bot of Object.values(source || {})) {
    if (!bot || bot.eatenBy) continue;
    const family = bot.family || "bot0";
    const entry = families.get(family) || { name: bot.name || "Enemy", massArea: 0 };
    entry.massArea += Math.max(1, (bot.radius || 0) ** 2);
    if (!entry.name && bot.name) entry.name = bot.name;
    families.set(family, entry);
  }
  return families;
}

function updateLeaderboard(players = {}, bots = {}) {
  if (!leaderboardList) return;
  const rows = [];

  for (const p of Object.values(players).filter(Boolean)) {
    const source = p.uid === uid && local ? { ...p, pieces: local.pieces, x: local.x, y: local.y, radius: local.radius } : p;
    rows.push({
      name: p.name || "Buddy",
      mass: playerMass(source),
      type: "player",
      self: p.uid === uid,
      partner: p.uid !== uid,
    });
  }

  for (const entry of botFamilyMasses(bots).values()) {
    rows.push({ name: entry.name || "Enemy", mass: Math.round(entry.massArea / 100), type: "bot", self: false, partner: false });
  }

  rows.sort((a, b) => b.mass - a.mass || a.name.localeCompare(b.name));
  leaderboardList.textContent = "";
  rows.slice(0, 10).forEach((row, index) => {
    const line = document.createElement("div");
    line.className = `leaderboard-row ${row.type}${row.self ? " self" : ""}${row.partner ? " partner" : ""}`;

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = `${row.name}${row.self ? " · YOU" : row.partner ? " · CO-OP" : ""}`;

    const mass = document.createElement("span");
    mass.className = "leaderboard-mass";
    mass.textContent = String(row.mass);

    line.append(rank, name, mass);
    leaderboardList.append(line);
  });
}

function updateHud(players, bots = {}) {
  const mass = teamMass(players);
  const liveFamilies = new Set(Object.values(bots).filter((b) => b && !b.eatenBy).map((b) => b.family || "bot0"));
  if (botsCountEl) botsCountEl.textContent = String(liveFamilies.size);
  scoreEl.textContent = String(mass);
  progressBar.style.width = `${Math.min(100, (mass / TEAM_GOAL) * 100)}%`;

  playersList.textContent = "";
  Object.entries(players).forEach(([, p]) => {
    const line = document.createElement("div");
    line.className = "player-line";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color || "#fff";
    const text = document.createElement("span");
    const source = p.uid === uid && local ? { ...p, pieces: local.pieces, x: local.x, y: local.y, radius: local.radius } : p;
    const cells = Object.keys(piecesOf(source)).length;
    const size = playerMass(source);
    text.textContent = `${p.name || "Buddy"}${p.uid === uid ? " (you)" : ""} · SIZE ${size} · ${cells} cell${cells === 1 ? "" : "s"}`;
    line.append(dot, text);
    playersList.append(line);
  });

  updateLeaderboard(players, bots);

  const count = Object.keys(players).length;
  if (count < 2) showBanner(`Waiting for your buddy…\nRoom ${roomId}`);
  else if (mass >= TEAM_GOAL) {
    won = true;
    showBanner("Team goal reached! 🎉\nKeep eating or start a new room.");
  } else if (!won) hideBanner();
}

function showBanner(text) {
  banner.textContent = text;
  banner.style.whiteSpace = "pre-line";
  banner.classList.remove("hidden");
}

function hideBanner() { banner.classList.add("hidden"); }

function resizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function movePointer(clientX, clientY) {
  pointer.x = clientX;
  pointer.y = clientY;
  pointer.active = true;
}
canvas.addEventListener("pointermove", (e) => movePointer(e.clientX, e.clientY));
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture?.(e.pointerId);
  movePointer(e.clientX, e.clientY);
});

function currentAim() {
  let dx = pointer.x - innerWidth / 2;
  let dy = pointer.y - innerHeight / 2;
  let dist = Math.hypot(dx, dy);
  if (dist < 4) { dx = 1; dy = 0; dist = 1; }
  return { x: dx / dist, y: dy / dist, intensity: Math.min(dist / 180, 1) };
}

function splitLocalPlayer() {
  if (!roomId || !local || Object.keys(roomState?.players || {}).length < 2) return;
  const now = Date.now();
  if (now - lastPlayerSplitAt < PLAYER_SPLIT_COOLDOWN_MS) return;
  const entries = Object.entries(local.pieces || {}).sort((a, b) => b[1].radius - a[1].radius);
  if (entries.length >= MAX_PLAYER_PIECES) return;

  const aim = currentAim();
  let count = entries.length;
  let changed = false;
  for (const [id, piece] of entries) {
    if (count >= MAX_PLAYER_PIECES) break;
    if (piece.radius < PLAYER_SPLIT_MIN_RADIUS) continue;

    const r = piece.radius / Math.sqrt(2);
    piece.radius = r;
    piece.mergeAt = now + PLAYER_MERGE_MS;
    piece.vx = (piece.vx || 0) - aim.x * 75;
    piece.vy = (piece.vy || 0) - aim.y * 75;

    const newId = ['p0', 'p1', 'p2', 'p3'].find((pieceId) => !local.pieces[pieceId]);
    if (!newId) break;
    local.pieces[newId] = makePiece(
      Math.max(r, Math.min(WORLD.width - r, piece.x + aim.x * r * 1.35)),
      Math.max(r, Math.min(WORLD.height - r, piece.y + aim.y * r * 1.35)),
      r,
      now + PLAYER_MERGE_MS,
      aim.x * PLAYER_SPLIT_BOOST,
      aim.y * PLAYER_SPLIT_BOOST,
    );
    count++;
    changed = true;
  }

  if (changed) {
    lastPlayerSplitAt = now;
    syncLocalAggregate();
    writeLocalNow();
  }
}

function resolvePlayerPieceInteractions(dt) {
  if (!local?.pieces) return;
  const ids = Object.keys(local.pieces);
  const now = Date.now();

  for (let i = 0; i < ids.length; i++) {
    const a = local.pieces[ids[i]];
    if (!a) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const b = local.pieces[ids[j]];
      if (!b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy) || 0.001;
      const mergeReady = now >= (a.mergeAt || 0) && now >= (b.mergeAt || 0);

      if (mergeReady && d < (a.radius + b.radius) * 0.58) {
        const areaA = a.radius ** 2;
        const areaB = b.radius ** 2;
        const total = areaA + areaB;
        a.x = (a.x * areaA + b.x * areaB) / total;
        a.y = (a.y * areaA + b.y * areaB) / total;
        a.radius = Math.min(MAX_CELL_RADIUS, Math.sqrt(total));
        a.vx = ((a.vx || 0) * areaA + (b.vx || 0) * areaB) / total;
        a.vy = ((a.vy || 0) * areaA + (b.vy || 0) * areaB) / total;
        a.mergeAt = 0;
        delete local.pieces[ids[j]];
        continue;
      }

      if (!mergeReady) {
        const desired = (a.radius + b.radius) * 0.82;
        if (d < desired) {
          const push = (desired - d) * 2.2 * dt;
          dx /= d; dy /= d;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      } else {
        // Once merging is allowed, gently pull sibling cells together.
        const pull = Math.min(42 * dt, d * 0.04);
        dx /= d; dy /= d;
        a.x += dx * pull;
        a.y += dy * pull;
        b.x -= dx * pull;
        b.y -= dy * pull;
      }
    }
  }
}

function tickMovement(dt) {
  if (!roomId || !roomState || !local) return;
  const players = roomState.players || {};
  if (Object.keys(players).length < 2) return;

  const aim = currentAim();
  for (const piece of Object.values(local.pieces || {})) {
    const speed = Math.max(90, 285 - piece.radius * 2.15) * aim.intensity;
    piece.x += aim.x * speed * dt + (piece.vx || 0) * dt;
    piece.y += aim.y * speed * dt + (piece.vy || 0) * dt;

    const drag = Math.pow(0.025, dt);
    piece.vx = (piece.vx || 0) * drag;
    piece.vy = (piece.vy || 0) * drag;
    if (Math.abs(piece.vx) < 0.4) piece.vx = 0;
    if (Math.abs(piece.vy) < 0.4) piece.vy = 0;

    piece.x = Math.max(piece.radius, Math.min(WORLD.width - piece.radius, piece.x));
    piece.y = Math.max(piece.radius, Math.min(WORLD.height - piece.radius, piece.y));
  }

  resolvePlayerPieceInteractions(dt);
  syncLocalAggregate();

  const now = performance.now();
  if (now - lastNetworkWrite > PLAYER_NETWORK_INTERVAL_MS) {
    lastNetworkWrite = now;
    update(ref(db, `rooms/${roomId}/players/${localSlot}`), publicPlayerPayload()).catch(console.warn);
  }

  checkFoodCollisions();
  checkBotCollisions();
}

function writeLocalNow() {
  if (!db || !roomId || !local || localSlot === null) return;
  update(ref(db, `rooms/${roomId}/players/${localSlot}`), publicPlayerPayload()).catch(console.warn);
}

function checkFoodCollisions() {
  if (eating.size >= MAX_CONCURRENT_FOOD_CLAIMS) return;
  const food = roomState?.food || {};
  const pieces = Object.entries(local.pieces || {});
  if (!pieces.length) return;
  let started = 0;

  for (const [foodId, f] of Object.entries(food)) {
    if (!f || f.claimedBy || eating.has(foodId)) continue;
    for (const [pieceId, piece] of pieces) {
      const reach = piece.radius + (f.r || 7) * 0.6;
      const dx = piece.x - f.x;
      if (Math.abs(dx) > reach) continue;
      const dy = piece.y - f.y;
      if (Math.abs(dy) > reach || dx * dx + dy * dy >= reach * reach) continue;
      claimFood(foodId, f, pieceId);
      started++;
      if (started >= MAX_NEW_FOOD_CLAIMS_PER_TICK || eating.size >= MAX_CONCURRENT_FOOD_CLAIMS) return;
      break;
    }
  }
}

async function claimFood(foodId, food, pieceId) {
  if (!roomId || eating.has(foodId)) return;
  eating.add(foodId);
  const foodRef = ref(db, `rooms/${roomId}/food/${foodId}`);
  try {
    const result = await runTransaction(foodRef, (current) => {
      if (!current || current.claimedBy) return;
      return { ...current, claimedBy: uid };
    }, { applyLocally: false });

    if (result.committed && result.snapshot.val()?.claimedBy === uid) {
      const piece = local?.pieces?.[pieceId];
      const claimedFood = result.snapshot.val() || food;
      if (piece) piece.radius = Math.min(MAX_CELL_RADIUS, growRadiusFromFood(piece.radius, claimedFood, 0.82));
      syncLocalAggregate();
      writeLocalNow();
      // If this remove ever fails, hostMaintenance will clean up the claimed pellet.
      await remove(foodRef);
    }
  } catch (err) {
    console.warn("Food claim failed", err);
  } finally {
    eating.delete(foodId);
  }
}

function checkBotCollisions() {
  if (!local) return;
  const botEntries = localHost ? hostBots.entries() : Object.entries(roomState?.bots || {});
  const pieceEntries = Object.entries(local.pieces || {});
  const protectedFromBots = performance.now() < invulnerableUntil;
  let consumedThisTick = 0;

  if (!localHost && botClaiming.size >= MAX_BOT_EATS_PER_TICK) return;
  for (const [botId, bot] of botEntries) {
    if (!bot || bot.eatenBy || botClaiming.has(botId) || botRemoving.has(botId)) continue;
    // Clients collide with the interpolated position they see. The host already owns
    // the authoritative simulation, so it collides directly with hostBots.
    const rendered = !localHost ? renderBots.get(botId) : null;
    const collisionBot = rendered ? { ...bot, x: rendered.x, y: rendered.y, radius: rendered.radius } : bot;

    for (const [pieceId, piece] of pieceEntries) {
      if (!local.pieces?.[pieceId]) continue;
      const dx = piece.x - collisionBot.x;
      const dy = piece.y - collisionBot.y;
      const distSq = dx * dx + dy * dy;

      if (canConsumeSquared(piece.radius, collisionBot.radius, distSq)) {
        if (localHost) consumeBotAsHost(botId, collisionBot, pieceId);
        else claimBot(botId, collisionBot, pieceId);
        consumedThisTick++;
        if (consumedThisTick >= MAX_BOT_EATS_PER_TICK) return;
        break;
      }

      if (!protectedFromBots && canConsumeSquared(collisionBot.radius, piece.radius, distSq)) {
        eatenByBot(pieceId, botId, collisionBot);
        break;
      }
    }
  }
}

function consumeBotAsHost(botId, bot, pieceId) {
  if (!localHost || !local?.pieces?.[pieceId] || botClaiming.has(botId) || botRemoving.has(botId)) return;
  const liveBot = hostBots.get(botId);
  if (!liveBot || liveBot.eatenBy) return;

  // The host is the bot authority. Avoid a Firebase transaction here because the
  // host's own movement updates would conflict with that transaction. Removing the
  // bot from hostBots first also guarantees it cannot damage/eat anything again.
  botClaiming.add(botId);
  const piece = local.pieces[pieceId];
  piece.radius = Math.min(MAX_CELL_RADIUS, Math.sqrt(piece.radius ** 2 + liveBot.radius ** 2 * 0.72));
  syncLocalAggregate();
  writeLocalNow();
  deleteBotCell(botId, liveBot.family);
  queueMicrotask(() => botClaiming.delete(botId));
}

async function claimBot(botId, bot, pieceId) {
  if (!roomId || !local || botClaiming.has(botId)) return;
  botClaiming.add(botId);
  const botRef = ref(db, `rooms/${roomId}/bots/${botId}`);
  try {
    const result = await runTransaction(botRef, (current) => {
      if (!current || current.eatenBy) return;
      return { ...current, eatenBy: uid };
    }, { applyLocally: false });

    if (result.committed && result.snapshot.val()?.eatenBy === uid) {
      const piece = local?.pieces?.[pieceId];
      if (piece) piece.radius = Math.min(MAX_CELL_RADIUS, Math.sqrt(piece.radius ** 2 + (bot.radius || 28) ** 2 * 0.72));
      syncLocalAggregate();
      writeLocalNow();
    }
  } catch (err) {
    console.warn("Bot claim failed", err);
  } finally {
    botClaiming.delete(botId);
  }
}

function queueBotMeal(botId, lostRadius) {
  if (!db || !roomId || !uid || !botId || !Number.isFinite(lostRadius)) return;
  const mealId = `${uid.slice(0, 8)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const payload = {
    botId: String(botId).slice(0, 80),
    playerUid: uid,
    area: Math.round(Math.min(MAX_CELL_RADIUS ** 2, Math.max(100, lostRadius ** 2))),
    createdAt: Date.now(),
  };
  set(ref(db, `rooms/${roomId}/botMeals/${mealId}`), payload).catch((err) => console.warn("Bot meal credit failed", err));
}

function eatenByBot(pieceId, botId, bot) {
  const now = performance.now();
  if (!local?.pieces?.[pieceId] || now < invulnerableUntil) return;
  const lost = local.pieces[pieceId];
  delete local.pieces[pieceId];
  queueBotMeal(botId, lost.radius);

  const fullyEaten = !Object.keys(local.pieces).length;
  if (fullyEaten) {
    const x = Math.max(80, Math.min(WORLD.width - 80, WORLD.width / 2 + (localSlot ? 180 : -180) + (Math.random() - 0.5) * 280));
    const y = Math.max(80, Math.min(WORLD.height - 80, WORLD.height / 2 + (Math.random() - 0.5) * 280));
    local.pieces = { p0: makePiece(x, y, START_RADIUS) };
    deathNotice = `${bot.name || "Enemy"} ate you! Respawn shield active.`;
  } else {
    deathNotice = `${bot.name || "Enemy"} ate one of your split cells!`;
  }

  // Keep the remaining cells from immediately collapsing into the collision point.
  for (const piece of Object.values(local.pieces)) {
    const dx = piece.x - (lost?.x || piece.x);
    const dy = piece.y - (lost?.y || piece.y);
    const d = Math.hypot(dx, dy) || 1;
    piece.vx += (dx / d) * 80;
    piece.vy += (dy / d) * 80;
  }

  // Full respawns get a real shield; losing only one split cell gets a tiny
  // grace window to prevent the same enemy from deleting several pieces at once.
  invulnerableUntil = now + (fullyEaten ? 1900 : 280);
  deathNoticeUntil = now + 1800;
  syncLocalAggregate();
  writeLocalNow();
}

async function botClaimFood(botId, foodId, food) {
  const key = `${botId}:${foodId}`;
  if (!roomId || botEating.has(key) || botEating.size >= MAX_CONCURRENT_BOT_FOOD_CLAIMS) return;
  botEating.add(key);
  const foodRef = ref(db, `rooms/${roomId}/food/${foodId}`);
  try {
    const marker = `bot:${botId}`;
    const result = await runTransaction(foodRef, (current) => {
      if (!current || current.claimedBy) return;
      return { ...current, claimedBy: marker };
    }, { applyLocally: false });

    if (result.committed && result.snapshot.val()?.claimedBy === marker) {
      const sim = hostBots.get(botId);
      if (sim) sim.radius = Math.min(MAX_CELL_RADIUS, growRadiusFromFood(sim.radius, food, 0.68));
      await remove(foodRef);
    }
  } catch (err) {
    console.warn("Bot food claim failed", err);
  } finally {
    botEating.delete(key);
  }
}

function deleteBotCell(botId, familyHint = null) {
  if (!roomId || botRemoving.has(botId)) return;
  const current = hostBots.get(botId);
  const family = familyHint || current?.family || null;
  botRemoving.add(botId);
  hostBots.delete(botId);

  if (family && !familyCells(family).length && !botRespawnAt.has(family)) {
    botRespawnAt.set(family, Date.now() + 700 + Math.floor(Math.random() * 800));
  }

  remove(ref(db, `rooms/${roomId}/bots/${botId}`))
    .catch(console.warn)
    .finally(() => botRemoving.delete(botId));
}

function familyCells(family) {
  return [...hostBots.entries()].filter(([, b]) => b && !b.eatenBy && b.family === family);
}

function ensureBotFamilies() {
  if (!localHost || !roomId) return;
  const now = Date.now();
  for (let i = 0; i < BOT_FAMILY_COUNT; i++) {
    const family = `bot${i}`;
    if (familyCells(family).length) {
      botRespawnAt.delete(family);
      continue;
    }

    if (!botRespawnAt.has(family)) {
      botRespawnAt.set(family, now + 500 + Math.floor(Math.random() * 700));
      continue;
    }
    if (now < botRespawnAt.get(family)) continue;
    // Avoid reusing a base id until its previous delete has actually completed.
    if (botRemoving.has(family)) continue;

    const fresh = makeBot(i, family);
    hostBots.set(family, fresh);
    botRespawnAt.delete(family);
    set(ref(db, `rooms/${roomId}/bots/${family}`), fresh).catch((err) => {
      console.warn(err);
      hostBots.delete(family);
      botRespawnAt.set(family, Date.now() + 900);
    });
  }
}

function ensureHostBots() {
  if (!localHost || !roomState) return;
  const remoteBots = roomState.bots || {};

  for (const [id, bot] of Object.entries(remoteBots)) {
    if (!bot) continue;
    const familyIndex = botIndexFromFamily(bot.family || id);
    if (familyIndex >= BOT_FAMILY_COUNT) {
      // Automatically clean up surplus families from rooms created by older builds.
      if (!botRemoving.has(id)) deleteBotCell(id, bot.family);
      continue;
    }
    if (bot.eatenBy) {
      deleteBotCell(id, bot.family);
      continue;
    }
    if (!hostBots.has(id)) hostBots.set(id, { ...bot });
  }

  if (!hostBots.size && !Object.keys(remoteBots).length) {
    const fresh = makeBots();
    for (const [id, bot] of Object.entries(fresh)) hostBots.set(id, { ...bot });
    update(ref(db, `rooms/${roomId}/bots`), fresh).catch(console.warn);
  }

  ensureBotFamilies();
}

function allPlayerTargets() {
  const targets = [];
  for (const p of Object.values(roomState?.players || {}).filter(Boolean)) {
    const source = p.uid === uid && local ? local : p;
    for (const [pieceId, piece] of Object.entries(piecesOf(source))) {
      targets.push({ ...piece, ownerUid: p.uid, pieceId });
    }
  }
  return targets;
}

function processBotMeals() {
  if (!localHost || !roomId) return;
  const meals = roomState?.botMeals || {};
  for (const [mealId, meal] of Object.entries(meals)) {
    if (!meal || botMealProcessing.has(mealId)) continue;
    botMealProcessing.add(mealId);

    const bot = hostBots.get(meal.botId);
    if (bot && !bot.eatenBy && Number.isFinite(Number(meal.area))) {
      const gainedArea = Math.max(0, Math.min(MAX_CELL_RADIUS ** 2, Number(meal.area))) * 0.72;
      bot.radius = Math.min(MAX_CELL_RADIUS, Math.sqrt(bot.radius ** 2 + gainedArea));
      hostBots.set(meal.botId, bot);
    }

    remove(ref(db, `rooms/${roomId}/botMeals/${mealId}`))
      .catch(console.warn)
      .finally(() => botMealProcessing.delete(mealId));
  }
}

function splitBot(botId, bot, aimX, aimY) {
  const now = Date.now();
  if (bot.radius < BOT_SPLIT_MIN_RADIUS || now < (bot.splitReadyAt || 0)) return false;
  const family = bot.family || `bot${botIndexFromFamily(botId)}`;
  if (familyCells(family).length >= BOT_MAX_FAMILY_CELLS) return false;

  const mag = Math.hypot(aimX, aimY) || 1;
  aimX /= mag; aimY /= mag;
  const r = bot.radius / Math.sqrt(2);
  bot.radius = r;
  bot.mergeAt = now + BOT_MERGE_MS;
  bot.splitReadyAt = now + 5200 + Math.floor(Math.random() * 1800);
  bot.boostX = (bot.boostX || 0) - aimX * 55;
  bot.boostY = (bot.boostY || 0) - aimY * 55;

  const childId = `${family}_s_${now.toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const child = {
    ...bot,
    x: Math.max(r, Math.min(WORLD.width - r, bot.x + aimX * r * 1.3)),
    y: Math.max(r, Math.min(WORLD.height - r, bot.y + aimY * r * 1.3)),
    radius: r,
    vx: aimX,
    vy: aimY,
    boostX: aimX * BOT_SPLIT_BOOST,
    boostY: aimY * BOT_SPLIT_BOOST,
    mergeAt: now + BOT_MERGE_MS,
    splitReadyAt: bot.splitReadyAt,
  };
  hostBots.set(childId, child);

  const patch = {};
  patch[`bots/${botId}`] = bot;
  patch[`bots/${childId}`] = child;
  update(ref(db, `rooms/${roomId}`), patch).catch(console.warn);
  return true;
}

function mergeBotCells(bigId, big, smallId, small) {
  const areaA = big.radius ** 2;
  const areaB = small.radius ** 2;
  const total = areaA + areaB;
  big.x = (big.x * areaA + small.x * areaB) / total;
  big.y = (big.y * areaA + small.y * areaB) / total;
  big.radius = Math.min(MAX_CELL_RADIUS, Math.sqrt(total));
  big.boostX = 0;
  big.boostY = 0;
  big.mergeAt = 0;
  big.splitReadyAt = Date.now() + 2200;
  hostBots.set(bigId, big);
  deleteBotCell(smallId, small.family);
}

function resolveBotFamilyInteractions(dt) {
  const now = Date.now();
  const groups = new Map();
  for (const [id, bot] of hostBots) {
    const family = bot.family || `bot${botIndexFromFamily(id)}`;
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push([id, bot]);
  }

  for (const entries of groups.values()) {
    for (let i = 0; i < entries.length; i++) {
      const [idA, a] = entries[i];
      if (!hostBots.has(idA)) continue;
      for (let j = i + 1; j < entries.length; j++) {
        const [idB, b] = entries[j];
        if (!hostBots.has(idB)) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy) || 0.001;
        const mergeReady = now >= (a.mergeAt || 0) && now >= (b.mergeAt || 0);

        if (mergeReady && d < (a.radius + b.radius) * 0.6) {
          if (a.radius >= b.radius) mergeBotCells(idA, a, idB, b);
          else mergeBotCells(idB, b, idA, a);
          continue;
        }

        dx /= d; dy /= d;
        if (!mergeReady) {
          const desired = (a.radius + b.radius) * 0.8;
          if (d < desired) {
            const push = (desired - d) * 1.7 * dt;
            a.x -= dx * push; a.y -= dy * push;
            b.x += dx * push; b.y += dy * push;
          }
        } else {
          const pull = Math.min(36 * dt, d * 0.035);
          a.x += dx * pull; a.y += dy * pull;
          b.x -= dx * pull; b.y -= dy * pull;
        }
      }
    }
  }
}

function tickBots(dt, now) {
  if (!localHost || !roomId || !roomState) return;
  ensureHostBots();
  processBotMeals();
  if (!hostBots.size) return;

  const playerTargets = allPlayerTargets();
  const food = roomState.food || {};
  const foodEntries = Object.entries(food);
  const foodValues = foodEntries.map(([, item]) => item);
  const entriesAtStart = [...hostBots.entries()];
  const wallMargin = 150;

  for (const [botId, bot] of entriesAtStart) {
    if (!hostBots.has(botId) || botRemoving.has(botId)) continue;

    const personality = bot.personality || BOT_PERSONALITIES[botIndexFromFamily(bot.family) % BOT_PERSONALITIES.length] || "dumb";
    bot.personality = personality;
    let dirX = bot.vx || 1;
    let dirY = bot.vy || 0;
    let threat = null;
    let threatDist = Infinity;
    let playerPrey = null;
    let playerPreyDist = Infinity;
    let botPrey = null;
    let botPreyDist = Infinity;

    // Smarter bots understand both players and enemy bot families. Dumb/chaos bots
    // only notice danger at much shorter range.
    const threatRange = personality === "dumb" ? 260 : personality === "chaos" ? 420 : 760;
    for (const p of playerTargets) {
      const d = Math.hypot(p.x - bot.x, p.y - bot.y);
      if (p.radius > bot.radius * BOT_EAT_RATIO && d < threatRange && d < threatDist) { threat = p; threatDist = d; }
      if (bot.radius > p.radius * BOT_EAT_RATIO && d < 950 && d < playerPreyDist) { playerPrey = p; playerPreyDist = d; }
    }

    if (personality === "hunter" || personality === "rival") {
      for (const [otherId, other] of hostBots) {
        if (otherId === botId || !other || other.eatenBy || other.family === bot.family) continue;
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (other.radius > bot.radius * BOT_EAT_RATIO && d < 700 && d < threatDist) {
          threat = other; threatDist = d;
        }
        if (bot.radius > other.radius * BOT_EAT_RATIO && d < 920 && d < botPreyDist) {
          botPrey = other; botPreyDist = d;
        }
      }
    }

    if (threat) {
      dirX = bot.x - threat.x;
      dirY = bot.y - threat.y;
    } else if (personality === "hunter" && playerPrey) {
      // Hunter bots prioritize the human team and deliberately split-attack.
      dirX = playerPrey.x - bot.x;
      dirY = playerPrey.y - bot.y;
      if (playerPreyDist > bot.radius * 1.4 && playerPreyDist < 470 && bot.radius > playerPrey.radius * 1.43) {
        splitBot(botId, bot, dirX, dirY);
      }
    } else if (personality === "rival" && (botPrey || playerPrey)) {
      // Rival bots prefer eating other bot families, then fall back to players.
      const prey = botPrey || playerPrey;
      const preyDist = botPrey ? botPreyDist : playerPreyDist;
      dirX = prey.x - bot.x;
      dirY = prey.y - bot.y;
      if (preyDist > bot.radius * 1.4 && preyDist < 450 && bot.radius > prey.radius * 1.45) {
        splitBot(botId, bot, dirX, dirY);
      }
    } else if (personality !== "dumb" && playerPrey && personality !== "chaos") {
      dirX = playerPrey.x - bot.x;
      dirY = playerPrey.y - bot.y;
    } else {
      let nearestFood = null;
      const foodSense = personality === "dumb" ? 280 : 520;
      let nearestFoodDistSq = foodSense * foodSense;
      // Dumb bots are bad at choosing food; chaos bots are slightly better but unstable.
      if (personality !== "dumb" || Math.random() < 0.35) {
        for (const f of foodValues) {
          if (!f || f.claimedBy) continue;
          const fdx = f.x - bot.x;
          const fdy = f.y - bot.y;
          const d2 = fdx * fdx + fdy * fdy;
          if (d2 < nearestFoodDistSq) { nearestFood = f; nearestFoodDistSq = d2; }
        }
      }
      if (nearestFood && personality !== "chaos") {
        dirX = nearestFood.x - bot.x;
        dirY = nearestFood.y - bot.y;
      } else if (Date.now() >= (bot.turnAt || 0)) {
        const angle = Math.random() * Math.PI * 2;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
        const turnMin = personality === "dumb" ? 450 : personality === "chaos" ? 650 : 1100;
        const turnSpread = personality === "dumb" ? 1300 : personality === "chaos" ? 1700 : 2800;
        bot.turnAt = Date.now() + turnMin + Math.floor(Math.random() * turnSpread);
      }
    }

    // Chaos bots split in random directions for no good reason. Dumb bots do it rarely too.
    const randomSplitRate = personality === "chaos" ? 0.22 : personality === "dumb" ? 0.035 : 0;
    if (randomSplitRate && bot.radius >= BOT_SPLIT_MIN_RADIUS && Date.now() >= (bot.splitReadyAt || 0) && Math.random() < randomSplitRate * dt) {
      const angle = Math.random() * Math.PI * 2;
      splitBot(botId, bot, Math.cos(angle), Math.sin(angle));
    }

    // Basic wall awareness keeps all personalities from spending too long pressed against an edge.
    if (bot.x < wallMargin) dirX += 1.8;
    if (bot.x > WORLD.width - wallMargin) dirX -= 1.8;
    if (bot.y < wallMargin) dirY += 1.8;
    if (bot.y > WORLD.height - wallMargin) dirY -= 1.8;

    const mag = Math.hypot(dirX, dirY) || 1;
    const steering = personality === "dumb" ? 1.2 : personality === "chaos" ? 2.0 : 3.6;
    bot.vx += (dirX / mag - bot.vx) * Math.min(1, dt * steering);
    bot.vy += (dirY / mag - bot.vy) * Math.min(1, dt * steering);
    const vmag = Math.hypot(bot.vx, bot.vy) || 1;
    bot.vx /= vmag;
    bot.vy /= vmag;

    const speedBase = personality === "hunter" ? 250 : personality === "rival" ? 242 : personality === "chaos" ? 232 : 218;
    const speed = Math.max(66, speedBase - bot.radius * 1.45) * (threat ? 1.18 : 1);
    bot.x += bot.vx * speed * dt + (bot.boostX || 0) * dt;
    bot.y += bot.vy * speed * dt + (bot.boostY || 0) * dt;
    const boostDrag = Math.pow(0.03, dt);
    bot.boostX = (bot.boostX || 0) * boostDrag;
    bot.boostY = (bot.boostY || 0) * boostDrag;
    if (Math.abs(bot.boostX) < 0.4) bot.boostX = 0;
    if (Math.abs(bot.boostY) < 0.4) bot.boostY = 0;

    bot.x = Math.max(bot.radius, Math.min(WORLD.width - bot.radius, bot.x));
    bot.y = Math.max(bot.radius, Math.min(WORLD.height - bot.radius, bot.y));

    for (const [foodId, f] of foodEntries) {
      if (!f || f.claimedBy) continue;
      const reach = bot.radius + (f.r || 7) * 0.35;
      const fdx = bot.x - f.x;
      if (Math.abs(fdx) > reach) continue;
      const fdy = bot.y - f.y;
      if (Math.abs(fdy) <= reach && fdx * fdx + fdy * fdy < reach * reach) {
        botClaimFood(botId, foodId, f);
        break;
      }
    }
  }

  resolveBotFamilyInteractions(dt);

  // Different enemy families can eat each other's cells.
  const botEntries = [...hostBots.entries()];
  for (let i = 0; i < botEntries.length; i++) {
    const [idA, a] = botEntries[i];
    if (!hostBots.has(idA)) continue;
    for (let j = i + 1; j < botEntries.length; j++) {
      const [idB, b] = botEntries[j];
      if (!hostBots.has(idB) || a.family === b.family) continue;
      const bdx = a.x - b.x;
      const bdy = a.y - b.y;
      const distSq = bdx * bdx + bdy * bdy;
      let bigId, big, smallId, small;
      if (canConsumeSquared(a.radius, b.radius, distSq)) [bigId, big, smallId, small] = [idA, a, idB, b];
      else if (canConsumeSquared(b.radius, a.radius, distSq)) [bigId, big, smallId, small] = [idB, b, idA, a];
      else continue;
      big.radius = Math.min(MAX_CELL_RADIUS, Math.sqrt(big.radius ** 2 + small.radius ** 2 * 0.64));
      hostBots.set(bigId, big);
      deleteBotCell(smallId, small.family);
    }
  }

  ensureBotFamilies();

  if (now - lastBotNetworkWrite > BOT_NETWORK_INTERVAL_MS) {
    lastBotNetworkWrite = now;
    const patch = {};
    for (const [id, bot] of hostBots) {
      if (botRemoving.has(id)) continue;
      patch[`bots/${id}/family`] = bot.family;
      patch[`bots/${id}/name`] = bot.name;
      patch[`bots/${id}/personality`] = bot.personality || "dumb";
      patch[`bots/${id}/x`] = Math.round(bot.x * 10) / 10;
      patch[`bots/${id}/y`] = Math.round(bot.y * 10) / 10;
      patch[`bots/${id}/radius`] = Math.round(bot.radius * 100) / 100;
      patch[`bots/${id}/color`] = bot.color;
      patch[`bots/${id}/vx`] = Math.round(bot.vx * 10000) / 10000;
      patch[`bots/${id}/vy`] = Math.round(bot.vy * 10000) / 10000;
      patch[`bots/${id}/boostX`] = Math.round((bot.boostX || 0) * 100) / 100;
      patch[`bots/${id}/boostY`] = Math.round((bot.boostY || 0) * 100) / 100;
      patch[`bots/${id}/turnAt`] = Math.round(bot.turnAt || 0);
      patch[`bots/${id}/mergeAt`] = Math.round(bot.mergeAt || 0);
      patch[`bots/${id}/splitReadyAt`] = Math.round(bot.splitReadyAt || 0);
    }
    if (Object.keys(patch).length) update(ref(db, `rooms/${roomId}`), patch).catch(console.warn);
  }
}

function hostMaintenance(now) {
  if (!localHost || !roomId || !roomState || now - hostLoopAt < 1200) return;
  hostLoopAt = now;
  const food = roomState.food || {};
  const patch = {};
  let liveFood = 0;

  // Claimed pellets are intentionally safe to delete: the winner already received
  // its mass after the transaction committed. This also heals interrupted removes.
  for (const [foodId, item] of Object.entries(food)) {
    if (!item) continue;
    if (item.claimedBy) patch[`food/${foodId}`] = null;
    else liveFood++;
  }

  const missing = FOOD_TARGET - liveFood;
  if (missing > 0) {
    const additions = makeFood(Math.min(missing, 60));
    for (const [id, item] of Object.entries(additions)) patch[`food/${id}`] = item;
  }

  if (Object.keys(patch).length) update(ref(db, `rooms/${roomId}`), patch).catch(console.warn);
}

function getCamera() {
  const x = local?.x ?? WORLD.width / 2;
  const y = local?.y ?? WORLD.height / 2;
  return { x: x - innerWidth / 2, y: y - innerHeight / 2 };
}

function drawGrid(cam) {
  ctx.fillStyle = "#090e1b";
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const grid = 80;
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,255,255,.035)";
  ctx.lineWidth = 1;
  const startX = ((-cam.x % grid) + grid) % grid;
  const startY = ((-cam.y % grid) + grid) % grid;
  for (let x = startX; x < innerWidth; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, innerHeight); }
  for (let y = startY; y < innerHeight; y += grid) { ctx.moveTo(0, y); ctx.lineTo(innerWidth, y); }
  ctx.stroke();

  ctx.strokeStyle = "rgba(145,164,255,.25)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-cam.x, -cam.y, WORLD.width, WORLD.height);
}

function drawFood(cam) {
  const food = roomState?.food || {};
  for (const f of Object.values(food)) {
    if (f.claimedBy) continue;
    const x = f.x - cam.x;
    const y = f.y - cam.y;
    if (x < -28 || y < -28 || x > innerWidth + 28 || y > innerHeight + 28) continue;

    if (f.kind === "spiky" || Number(f.mass) === SPIKY_FOOD_MASS) {
      const outer = f.r || 17;
      const inner = outer * 0.55;
      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = f.color || "#f5ff72";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      const spikes = 12;
      for (let i = 0; i < spikes * 2; i++) {
        const angle = -Math.PI / 2 + i * Math.PI / spikes;
        const radius = i % 2 === 0 ? outer : inner;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = f.color || "#f5ff72";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,.72)";
      ctx.stroke();
      ctx.font = "900 8px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(35,42,5,.88)";
      ctx.fillText("25", 0, 0.5);
      ctx.restore();
      continue;
    }

    ctx.beginPath();
    ctx.arc(x, y, f.r, 0, Math.PI * 2);
    ctx.fillStyle = f.color || "#fff";
    ctx.fill();
  }
}

function smoothPlayerPieces(dt) {
  const players = roomState?.players || {};
  const active = new Set();
  for (const [slot, p] of Object.entries(players)) {
    const source = p.uid === uid && local ? local : p;
    for (const [pieceId, piece] of Object.entries(piecesOf(source))) {
      const key = `${slot}:${pieceId}`;
      active.add(key);
      let rp = renderPlayerPieces.get(key);
      if (!rp) {
        rp = { x: piece.x, y: piece.y, radius: piece.radius };
        renderPlayerPieces.set(key, rp);
      }
      const t = 1 - Math.pow(0.001, dt);
      rp.x += (piece.x - rp.x) * t;
      rp.y += (piece.y - rp.y) * t;
      rp.radius += (piece.radius - rp.radius) * t;
    }
  }
  for (const key of renderPlayerPieces.keys()) if (!active.has(key)) renderPlayerPieces.delete(key);
}

function smoothBots(dt) {
  const bots = roomState?.bots || {};
  const active = new Set();
  const sourceEntries = localHost ? hostBots.entries() : Object.entries(bots);
  for (const [id, remote] of sourceEntries) {
    if (!remote || remote.eatenBy) continue;
    active.add(id);
    const target = remote;
    let rb = renderBots.get(id);
    if (!rb) {
      rb = { x: target.x, y: target.y, radius: target.radius };
      renderBots.set(id, rb);
    }
    const t = 1 - Math.pow(0.0007, dt);
    rb.x += (target.x - rb.x) * t;
    rb.y += (target.y - rb.y) * t;
    rb.radius += (target.radius - rb.radius) * t;
  }
  for (const id of renderBots.keys()) if (!active.has(id)) renderBots.delete(id);
}

function drawBots(cam) {
  const sourceEntries = localHost ? hostBots.entries() : Object.entries(roomState?.bots || {});
  for (const [id, bot] of sourceEntries) {
    if (!bot || bot.eatenBy) continue;
    const rb = renderBots.get(id) || bot;
    const x = rb.x - cam.x;
    const y = rb.y - cam.y;
    const r = rb.radius;
    if (x < -r - 30 || y < -r - 30 || x > innerWidth + r + 30 || y > innerHeight + r + 30) continue;

    ctx.save();
    if (r < LARGE_CELL_LOD_RADIUS) {
      ctx.shadowColor = bot.color || "#ff5f6d";
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = bot.color || "#ff5f6d";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2.5, Math.min(12, r * 0.075));
    ctx.strokeStyle = "rgba(80, 3, 20, .72)";
    ctx.stroke();

    // Detail LOD: giant cells are expensive mostly because of multiple large
    // alpha-blended shapes. Their silhouette/name is enough while zoomed in.
    if (r < 340) {
      const eyeY = y - r * 0.14;
      const eyeGap = r * 0.28;
      const eyeR = Math.max(2.5, r * 0.09);
      for (const ex of [x - eyeGap, x + eyeGap]) {
        ctx.beginPath();
        ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,.92)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex, eyeY + 1, eyeR * 0.48, 0, Math.PI * 2);
        ctx.fillStyle = "#33101a";
        ctx.fill();
      }
    }

    const fontSize = Math.max(9, Math.min(18, r * 0.38));
    ctx.font = `900 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(54,7,18,.88)";
    ctx.fillText(bot.name || "Enemy", x, y + Math.min(r * 0.28, 90));
    ctx.restore();
  }
}

function drawPlayers(cam) {
  const players = roomState?.players || {};
  for (const [slot, p] of Object.entries(players)) {
    const source = p.uid === uid && local ? local : p;
    const entries = Object.entries(piecesOf(source));
    for (const [pieceId, piece] of entries) {
      const rp = renderPlayerPieces.get(`${slot}:${pieceId}`) || piece;
      const x = rp.x - cam.x;
      const y = rp.y - cam.y;
      const r = rp.radius;
      if (x < -r - 30 || y < -r - 30 || x > innerWidth + r + 30 || y > innerHeight + r + 30) continue;

      ctx.save();
      // Large blurred circles are one of the most expensive canvas operations.
      // Keep the glow for normal cells, switch to a flat LOD for giant cells.
      if (r < LARGE_CELL_LOD_RADIUS) {
        ctx.shadowColor = p.color || "#fff";
        ctx.shadowBlur = p.uid === uid ? 18 : 10;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color || "#fff";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, Math.min(12, r * 0.07));
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.stroke();

      if (p.uid === uid && performance.now() < invulnerableUntil) {
        ctx.beginPath();
        ctx.arc(x, y, r + 8, 0, Math.PI * 2);
        ctx.setLineDash([7, 6]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,.75)";
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const fontSize = Math.max(10, Math.min(22, r * 0.48));
      ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(8,12,25,.82)";
      ctx.fillText(p.name || "Buddy", x, y);
      ctx.restore();
    }
  }
}

function coopPartnerInfo() {
  const players = Object.values(roomState?.players || {}).filter(Boolean);
  const partner = players.find((p) => p.uid !== uid);
  if (!partner) return null;
  const aggregate = aggregatePieces(piecesOf(partner));
  return { player: partner, aggregate };
}

function drawCoopPartnerArrow(cam) {
  if (!roomId || !local) return;
  const info = coopPartnerInfo();
  if (!info) return;

  const screenX = info.aggregate.x - cam.x;
  const screenY = info.aggregate.y - cam.y;
  const pad = Math.max(18, info.aggregate.radius);
  const onScreen = screenX >= -pad && screenX <= innerWidth + pad && screenY >= -pad && screenY <= innerHeight + pad;
  if (onScreen) return;

  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const dx = screenX - cx;
  const dy = screenY - cy;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const insetX = Math.max(38, innerWidth / 2 - 44);
  const insetY = Math.max(38, innerHeight / 2 - 54);
  const tx = Math.abs(ux) > 0.0001 ? insetX / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 0.0001 ? insetY / Math.abs(uy) : Infinity;
  const edge = Math.min(tx, ty);
  let x = cx + ux * edge;
  let y = cy + uy * edge;

  // Keep the indicator clear of the top-right leaderboard.
  if (x > innerWidth - 230 && y < 250) y = 258;
  x = Math.max(32, Math.min(innerWidth - 32, x));
  y = Math.max(42, Math.min(innerHeight - 42, y));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(uy, ux));
  ctx.shadowColor = info.player.color || "#72e7ff";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-8, -9);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, 9);
  ctx.closePath();
  ctx.fillStyle = info.player.color || "#72e7ff";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,.82)";
  ctx.stroke();
  ctx.restore();
}

function drawDeathNotice(now) {
  if (!deathNotice || now >= deathNoticeUntil) return;
  ctx.save();
  ctx.font = "800 16px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = Math.min(innerWidth - 30, ctx.measureText(deathNotice).width + 34);
  ctx.fillStyle = "rgba(8,12,25,.82)";
  ctx.fillRect((innerWidth - width) / 2, innerHeight - 92, width, 42);
  ctx.fillStyle = "rgba(255,255,255,.94)";
  ctx.fillText(deathNotice, innerWidth / 2, innerHeight - 71);
  ctx.restore();
}

function drawDirection() {
  if (!roomId || !local || Object.keys(roomState?.players || {}).length < 2) return;
  const dx = pointer.x - innerWidth / 2;
  const dy = pointer.y - innerHeight / 2;
  const dist = Math.hypot(dx, dy);
  if (dist < 25) return;
  const len = Math.min(42, dist * .18);
  ctx.beginPath();
  ctx.moveTo(innerWidth / 2, innerHeight / 2);
  ctx.lineTo(innerWidth / 2 + (dx / dist) * len, innerHeight / 2 + (dy / dist) * len);
  ctx.strokeStyle = "rgba(255,255,255,.26)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.stroke();
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.04, (now - lastFrame) / 1000);
  lastFrame = now;
  tickMovement(dt);
  if (localHost && now - lastBotSimAt >= BOT_SIM_INTERVAL_MS) {
    const botDt = lastBotSimAt ? Math.min(0.06, (now - lastBotSimAt) / 1000) : dt;
    lastBotSimAt = now;
    tickBots(botDt, now);
  }
  hostMaintenance(now);
  smoothPlayerPieces(dt);
  smoothBots(dt);

  const cam = getCamera();
  drawGrid(cam);
  drawFood(cam);
  drawBots(cam);
  drawPlayers(cam);
  drawCoopPartnerArrow(cam);
  drawDirection();
  drawDeathNotice(now);
  requestAnimationFrame(frame);
}

createBtn.addEventListener("click", createRoom);
joinBtn.addEventListener("click", joinRoom);
leaveBtn.addEventListener("click", () => leaveRoom(true));
splitBtn?.addEventListener("click", (e) => { e.preventDefault(); splitLocalPlayer(); });
copyBtn.addEventListener("click", async () => {
  if (!roomId) return;
  try {
    await navigator.clipboard.writeText(roomId);
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1100);
  } catch {
    copyBtn.textContent = roomId;
  }
});
roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
});
roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createRoom(); });
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && roomId) {
    e.preventDefault();
    if (!e.repeat) splitLocalPlayer();
  }
});
window.addEventListener("resize", resizeCanvas);
window.addEventListener("beforeunload", () => {
  if (db && roomId && uid && localSlot !== null) remove(ref(db, `rooms/${roomId}/players/${localSlot}`)).catch(() => {});
});

resizeCanvas();
requestAnimationFrame(frame);

if (!firebaseConfigured()) menuStatus.textContent = "Setup required: paste your Firebase config into app.js.";
