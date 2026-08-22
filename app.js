// Blob Royale — Agar.io-inspired 3-player PvPvE free-for-all with synchronized bots and splitting.
// Build 2.0.1 focuses on client + host performance without changing gameplay.
// Firebase Web SDK 12.17.1 via Google's CDN.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, signInAnonymously, setPersistence, inMemoryPersistence, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
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

const BUILD_VERSION = "2.0.1-performance";
const WORLD = { width: 5000, height: 4000 };
const FOOD_TARGET = 400;
const START_RADIUS = 30;

const MAX_PLAYER_PIECES = 4;
const PLAYER_SPLIT_MIN_RADIUS = 38;
const PLAYER_SPLIT_BOOST = 650;
const PLAYER_MERGE_MS = 6500;
const PLAYER_SPLIT_COOLDOWN_MS = 350;

const BOT_FAMILY_COUNT = 30;
const BOT_EAT_RATIO = 1.10;
const EAT_OVERLAP_FACTOR = 0.18;
const BOT_RESPAWN_MIN_RADIUS = 22;
const BOT_RESPAWN_MAX_RADIUS = 43;
const BOT_MAX_FAMILY_CELLS = 4;
const BOT_SPLIT_MIN_RADIUS = 42;
const BOT_SPLIT_BOOST = 590;
const BOT_MERGE_MS = 7000;

// Performance tuning: AI does not need to run at display refresh rate. Rendering
// stays at requestAnimationFrame speed while host AI is capped near 25 Hz.
const BOT_SIM_INTERVAL_MS = 50; // 20 Hz authoritative AI; render remains requestAnimationFrame
const PLAYER_NETWORK_INTERVAL_MS = 90; // ~11 Hz player sync with interpolation
const BOT_NETWORK_INTERVAL_MS = 200; // 5 Hz bot position snapshots are enough for interpolation
const BOT_STATE_NETWORK_INTERVAL_MS = 900; // slow-changing AI state is synced separately
const LARGE_CELL_LOD_RADIUS = 180;
const MAX_CONCURRENT_FOOD_CLAIMS = 10;
const MAX_NEW_FOOD_CLAIMS_PER_TICK = 3;
const MAX_CONCURRENT_BOT_FOOD_CLAIMS = 8;
const MAX_BOT_EATS_PER_TICK = 4;
const HUD_UPDATE_INTERVAL_MS = 450;
const MIN_RENDER_INTERVAL_MS = 12; // avoids wasting CPU at 120/144/165 Hz displays
const LOCAL_COLLISION_INTERVAL_MS = 34; // collision checks ~29 Hz instead of every rendered frame
const BOT_GRID_SIZE = 420;
const BOT_GRID_COLS = Math.ceil(WORLD.width / BOT_GRID_SIZE) + 2;
const BOT_FAMILY_CHECK_INTERVAL_MS = 250;
const FOOD_GRID_SIZE = 240;
const FOOD_GRID_REBUILD_MS = 220;
const TRANSFER_COOLDOWN_MS = 700;
const TRANSFER_FRACTION = 0.08;
const TRANSFER_MIN_SIZE = 15;
const TRANSFER_MAX_SIZE = 220;
const TRANSFER_MIN_REMAINING_SIZE = 45;

// Displayed size/mass is radius² / 100, so radius 1000 = size 10,000.
const MAX_CELL_MASS = 10000;
const MAX_CELL_RADIUS = Math.sqrt(MAX_CELL_MASS * 100);

const COLORS = ["#72e7ff", "#ff7aa8", "#ffd166"];
const FOOD_COLORS = ["#75f0ba", "#ffd166", "#ff7aa8", "#7bdff2", "#b8f2e6", "#cdb4ff"];
const BOT_COLORS = ["#ff5f6d", "#ff8c42", "#ff477e", "#ef476f", "#f78c6b", "#ff6b6b", "#f25f5c", "#e85d75"];
const BOT_NAMES = ["Chomper", "Razor", "Glitch", "NomNom", "Viper", "Crimson", "Munch", "Hunter"];
const BOT_PERSONALITIES = ["hunter", "rival", "chaos", "dumb", "cannibal"];
const BOT_PERSONALITY_LABELS = { hunter: "Hunter", rival: "Rival", chaos: "Chaos", dumb: "Dumb", cannibal: "Cannibal" };
const FEAR_FULL_KILLS = 20;
const FEAR_EXTRA_RANGE = 700;
const CANNIBAL_SENSE_RANGE = 1350;
const CANNIBAL_EAT_GAIN = 0.80;

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
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
const playersList = document.querySelector("#playersList");
const botsCountEl = document.querySelector("#botsCount");
const leaderboard = document.querySelector("#leaderboard");
const leaderboardList = document.querySelector("#leaderboardList");
const banner = document.querySelector("#banner");

const buildVersionEl = document.querySelector("#buildVersion");
if (buildVersionEl) buildVersionEl.textContent = `Build ${BUILD_VERSION}`;

let app;
let auth;
let db;
let uid = null;
let roomId = null;
let roomUnsubscribe = null;
let connectedUnsubscribe = null;
let roomMetaLoaded = false;
let roomPlayersLoaded = false;
let roomState = null;
let remoteBotEntries = [];
let local = null;
let localSlot = null;
let localHost = false;
let lastNetworkWrite = 0;
let hostLoopAt = 0;
let hostMaintenanceReadyAt = 0;
let lastBotNetworkWrite = 0;
let lastBotStateNetworkWrite = 0;
let lastBotSimAt = 0;
let eating = new Set();
let botEating = new Set();
let botClaiming = new Set();
let botRemoving = new Set();
let botMealProcessing = new Set();
let botRespawnAt = new Map();
let invulnerableUntil = 0;
let deathNoticeUntil = 0;
let deathNotice = "";
let previousPlayerCount = 0;
let lastPlayerSplitAt = 0;
let lastHudUpdateAt = 0;
let lastFoodGridBuildAt = 0;
let foodGrid = new Map();
let foodGridIndex = new Map();
let foodGridSource = null;
let lastLocalCollisionAt = 0;
let hostBotGrid = new Map();
let hostBotGridMaxRadius = 0;
const foodScratch = [];
const botScratch = [];
let countedBotKills = new Set();
let hostKillCounts = new Map();
let pvpVictimProcessing = new Set();
let pvpEaterProcessing = new Set();
let hostPvpPendingVictims = new Map();
let countedPvpKillEvents = new Set();
let remoteBotsDirty = true;
let botMealsDirty = true;
let statsDirty = true;
let lastBotFamilyCheckAt = 0;

const pointer = { x: innerWidth / 2, y: innerHeight / 2, active: true };
const renderPlayerPieces = new Map();
const renderBots = new Map();
let renderPlayerSeenId = 0;
let renderBotSeenId = 0;
const hostBots = new Map();
const hostFamilyGroups = Array.from({ length: BOT_FAMILY_COUNT }, () => []);

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

function spawnForSlot(slot = 0) {
  const spawns = [
    { x: WORLD.width * 0.22, y: WORLD.height * 0.50 },
    { x: WORLD.width * 0.78, y: WORLD.height * 0.50 },
    { x: WORLD.width * 0.50, y: WORLD.height * 0.22 },
  ];
  const base = spawns[slot % spawns.length] || spawns[0];
  return {
    x: Math.max(80, Math.min(WORLD.width - 80, base.x + (Math.random() - 0.5) * 220)),
    y: Math.max(80, Math.min(WORLD.height - 80, base.y + (Math.random() - 0.5) * 220)),
  };
}

function makePlayer(slot = 0) {
  const spawn = spawnForSlot(slot);
  const x = spawn.x;
  const y = spawn.y;
  return {
    uid,
    name: cleanName(nameInput.value),
    x,
    y,
    radius: START_RADIUS,
    color: COLORS[slot % COLORS.length],
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    shieldUntil: Date.now() + 1800,
    pieces: { p0: makePiece(x, y, START_RADIUS) },
  };
}

function makeFood(count = FOOD_TARGET) {
  const food = {};
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    food[id] = {
      x: 45 + Math.random() * (WORLD.width - 90),
      y: 45 + Math.random() * (WORLD.height - 90),
      r: 6 + Math.random() * 4,
      color: FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)],
      kind: "normal",
    };
  }
  return food;
}

function makeBot(index = 0, id = `bot${index}`) {
  const angle = Math.random() * Math.PI * 2;
  const radius = BOT_RESPAWN_MIN_RADIUS + Math.random() * (BOT_RESPAWN_MAX_RADIUS - BOT_RESPAWN_MIN_RADIUS);
  const now = Date.now();
  const personality = BOT_PERSONALITIES[index % BOT_PERSONALITIES.length];
  const botName = personality === "cannibal"
    ? `Cannibal ${String(index + 1).padStart(2, "0")}`
    : `${BOT_PERSONALITY_LABELS[personality]} ${BOT_NAMES[index % BOT_NAMES.length]} ${String(index + 1).padStart(2, "0")}`;
  return {
    family: `bot${index}`,
    name: botName.slice(0, 18),
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

function makeInitialEnemies() {
  return makeBots();
}

function botIndexFromFamily(family) {
  const value = String(family || "bot0");
  const n = value.startsWith("bot") ? Number.parseInt(value.slice(3), 10) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function piecesOf(player) {
  if (player?.pieces) {
    for (const id in player.pieces) if (player.pieces[id]) return player.pieces;
  }
  if (!player) return {};
  return { p0: makePiece(player.x, player.y, player.radius) };
}

function aggregatePieces(pieces) {
  let area = 0;
  let wx = 0;
  let wy = 0;
  let found = false;
  for (const id in (pieces || {})) {
    const p = pieces[id];
    if (!p) continue;
    found = true;
    const a = Math.max(1, p.radius ** 2);
    area += a;
    wx += p.x * a;
    wy += p.y * a;
  }
  if (!found || area <= 0) return { x: WORLD.width / 2, y: WORLD.height / 2, radius: START_RADIUS, area: START_RADIUS ** 2 };
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
    shieldUntil: Math.max(0, Math.round(local.shieldUntil || 0)),
  };
}

async function ensureFirebase() {
  if (!firebaseConfigured()) throw new Error("Firebase is not configured yet. Paste your Firebase web config into app.js first.");
  if (uid && auth?.currentUser) return;
  if (!app) app = initializeApp(firebaseConfig);
  if (!auth) auth = getAuth(app);
  if (!db) db = getDatabase(app);
  await setPersistence(auth, inMemoryPersistence);
  // Each browser tab gets its own anonymous identity so 3-player testing works
  // even when all three players use the same browser profile on one PC.
  if (auth.currentUser) {
    try { await signOut(auth); } catch (err) { console.warn("Auth reset", err); }
  }
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
      meta: { hostUid: uid, createdAt: serverTimestamp(), mode: "ffa3", maxPlayers: 3, world: WORLD },
      players: { 0: player },
      food: makeFood(),
      bots: makeInitialEnemies(),
      stats: { playerKills: { [uid]: 0 }, pvpKills: { [uid]: 0 } },
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

    const metaSnap = await get(ref(db, `rooms/${code}/meta`));
    if (!metaSnap.exists()) throw new Error("Room not found.");
    const playersSnap = await get(ref(db, `rooms/${code}/players`));
    const existing = playersSnap.val() || {};

    const alreadyInRoom = Object.entries(existing).find(([, p]) => p?.uid === uid);
    let claimedSlot = alreadyInRoom ? Number(alreadyInRoom[0]) : null;
    let player = alreadyInRoom ? alreadyInRoom[1] : null;

    if (claimedSlot === null) {
      for (const slot of [0, 1, 2]) {
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

    if (claimedSlot === null || !player) throw new Error("That room already has three players.");
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
  local.shieldUntil = Math.max(Date.now() + 1800, Number(local.shieldUntil || 0));
  invulnerableUntil = performance.now() + 1800;
  syncLocalAggregate();
  localSlot = slot;
  previousPlayerCount = 0;
  hostLoopAt = performance.now();
  hostMaintenanceReadyAt = performance.now() + 1800;
  lastBotSimAt = 0;
  lastBotNetworkWrite = 0;
  lastBotStateNetworkWrite = 0;
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

  // Performance: subscribe to hot paths separately. The old build listened to the
  // entire room, so every 5-8 Hz bot movement snapshot forced all clients to
  // deserialize the 400-pellet food map, stats and events again.
  roomState = { meta: {}, players: {}, food: {}, bots: {}, stats: {}, pvpEvents: {}, botMeals: {} };
  roomMetaLoaded = false;
  roomPlayersLoaded = false;
  const roomUnsubs = [];

  const reconcileRoomMembership = async () => {
    if (!roomId || !roomMetaLoaded || !roomPlayersLoaded) return;
    const players = roomState.players || {};
    const meta = roomState.meta || {};
    const playerValues = Object.values(players);
    previousPlayerCount = playerValues.length;
    const selfPresent = playerValues.some((p) => p?.uid === uid);
    const hostPresent = playerValues.some((p) => p?.uid === meta.hostUid);
    const wasHost = localHost;
    localHost = meta.hostUid === uid;

    if (localHost !== wasHost) {
      hostBots.clear();
      hostBotGrid.clear();
      hostBotGridMaxRadius = 0;
      botRespawnAt.clear();
      botMealProcessing.clear();
      hostPvpPendingVictims.clear();
      countedPvpKillEvents.clear();
      lastBotSimAt = 0;
      lastBotNetworkWrite = 0;
      lastBotStateNetworkWrite = 0;
      remoteBotsDirty = true;
      botMealsDirty = true;
      statsDirty = true;
      lastBotFamilyCheckAt = 0;
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

    if (localHost) hostProcessPvpEventAcks(roomState.pvpEvents || {});
  };

  roomUnsubs.push(onValue(ref(db, `rooms/${roomId}/meta`), async (snap) => {
    if (!snap.exists()) {
      showBanner("Room closed");
      await leaveRoom(false);
      return;
    }
    roomState.meta = snap.val() || {};
    roomMetaLoaded = true;
    reconcileRoomMembership();
  }));

  roomUnsubs.push(onValue(ref(db, `rooms/${roomId}/players`), (snap) => {
    roomState.players = snap.val() || {};
    roomPlayersLoaded = true;
    reconcileRoomMembership();
  }));

  const foodRef = ref(db, `rooms/${roomId}/food`);
  const onFoodUpsert = (snap) => {
    if (!snap.key) return;
    const item = snap.val();
    roomState.food[snap.key] = item;
    foodGridUpsert(snap.key, item);
    foodGridSource = roomState.food;
  };
  roomUnsubs.push(onChildAdded(foodRef, onFoodUpsert));
  roomUnsubs.push(onChildChanged(foodRef, onFoodUpsert));
  roomUnsubs.push(onChildRemoved(foodRef, (snap) => {
    if (!snap.key) return;
    delete roomState.food[snap.key];
    foodGridRemove(snap.key);
    foodGridSource = roomState.food;
  }));

  roomUnsubs.push(onValue(ref(db, `rooms/${roomId}/bots`), (snap) => {
    roomState.bots = snap.val() || {};
    remoteBotEntries = Object.entries(roomState.bots);
    remoteBotsDirty = true;
  }));

  roomUnsubs.push(onValue(ref(db, `rooms/${roomId}/stats`), (snap) => {
    roomState.stats = snap.val() || {};
    statsDirty = true;
  }));

  roomUnsubs.push(onValue(ref(db, `rooms/${roomId}/pvpEvents`), (snap) => {
    const events = snap.val() || {};
    roomState.pvpEvents = events;
    processPvpEvents(events);
    if (localHost) hostProcessPvpEventAcks(events);
  }));

  roomUnsubs.push(onValue(ref(db, `rooms/${roomId}/botMeals`), (snap) => {
    roomState.botMeals = snap.val() || {};
    botMealsDirty = true;
  }));

  roomUnsubscribe = () => {
    for (const off of roomUnsubs) {
      try { off(); } catch {}
    }
    roomUnsubs.length = 0;
  };

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
  roomMetaLoaded = false;
  roomPlayersLoaded = false;

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
  remoteBotEntries = [];
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
  countedBotKills.clear();
  hostKillCounts.clear();
  pvpVictimProcessing.clear();
  pvpEaterProcessing.clear();
  hostPvpPendingVictims.clear();
  countedPvpKillEvents.clear();
  foodGrid.clear();
  foodGridIndex.clear();
  foodGridSource = null;
  hostBotGrid.clear();
  hostBotGridMaxRadius = 0;
  lastLocalCollisionAt = 0;
  remoteBotsDirty = true;
  botMealsDirty = true;
  statsDirty = true;
  lastBotFamilyCheckAt = 0;
  invulnerableUntil = 0;
  deathNoticeUntil = 0;
  previousPlayerCount = 0;
  hostLoopAt = 0;
  hostMaintenanceReadyAt = 0;
  lastBotSimAt = 0;
  lastBotNetworkWrite = 0;
  lastBotStateNetworkWrite = 0;
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

function playerPvpKillCount(playerUid) {
  return Math.max(0, Number(roomState?.stats?.pvpKills?.[playerUid]) || 0);
}

function playerThreatKillCount(playerUid) {
  return playerKillCount(playerUid) + playerPvpKillCount(playerUid);
}

function syncHostKillCounts() {
  if (!statsDirty) return;
  statsDirty = false;
  const remote = roomState?.stats?.playerKills || {};
  for (const [playerUid, value] of Object.entries(remote)) {
    const count = Math.max(0, Number(value) || 0);
    if (count > (hostKillCounts.get(playerUid) || 0)) hostKillCounts.set(playerUid, count);
  }
}

function playerKillCount(playerUid) {
  if (!playerUid) return 0;
  const remote = Math.max(0, Number(roomState?.stats?.playerKills?.[playerUid]) || 0);
  return Math.max(remote, hostKillCounts.get(playerUid) || 0);
}

function recordPlayerBotKill(playerUid, botId) {
  if (!localHost || !roomId || !playerUid || !botId || countedBotKills.has(botId)) return;
  countedBotKills.add(botId);
  syncHostKillCounts();
  const next = playerKillCount(playerUid) + 1;
  hostKillCounts.set(playerUid, next);
  set(ref(db, `rooms/${roomId}/stats/playerKills/${playerUid}`), next).catch((err) => {
    console.warn("Kill counter update failed", err);
    countedBotKills.delete(botId);
  });
}


function growRadiusFromFood(radius, food, normalFactor = 0.82) {
  const currentArea = Math.max(1, radius ** 2);
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

function playerSlotByUid(playerUid) {
  for (const [slot, p] of Object.entries(roomState?.players || {})) if (p?.uid === playerUid) return String(slot);
  return null;
}

function localLargestPieceId() {
  const best = Object.entries(local?.pieces || {}).sort((a, b) => b[1].radius - a[1].radius)[0];
  return best?.[0] || null;
}

function hostResolvePvp(nowMs = Date.now()) {
  if (!localHost || !roomId || !roomState) return;
  const players = roomState.players || {};
  const entries = [];
  for (const [slot, p] of Object.entries(players)) {
    if (!p?.uid) continue;
    const source = p.uid === uid && local ? { ...p, pieces: local.pieces, shieldUntil: local.shieldUntil || p.shieldUntil || 0 } : p;
    for (const [pieceId, piece] of Object.entries(piecesOf(source))) {
      if (!piece) continue;
      entries.push({ slot: String(slot), player: p, pieceId, piece, shieldUntil: Number(source.shieldUntil || 0) });
    }
  }

  const liveEvents = roomState.pvpEvents || {};
  for (const [eventId, ev] of Object.entries(liveEvents)) {
    if (!ev) continue;
    const key = `${ev.victimUid}:${ev.victimPieceId}`;
    hostPvpPendingVictims.set(key, eventId);
  }

  let emitted = 0;
  for (let i = 0; i < entries.length && emitted < 3; i++) {
    for (let j = i + 1; j < entries.length && emitted < 3; j++) {
      const a = entries[i], b = entries[j];
      if (a.player.uid === b.player.uid) continue;
      const dx = a.piece.x - b.piece.x;
      const dy = a.piece.y - b.piece.y;
      const d2 = dx * dx + dy * dy;
      let eater = null, victim = null;
      if (b.shieldUntil <= nowMs && canConsumeSquared(a.piece.radius, b.piece.radius, d2)) { eater = a; victim = b; }
      else if (a.shieldUntil <= nowMs && canConsumeSquared(b.piece.radius, a.piece.radius, d2)) { eater = b; victim = a; }
      if (!eater || !victim) continue;

      const victimKey = `${victim.player.uid}:${victim.pieceId}`;
      if (hostPvpPendingVictims.has(victimKey)) continue;
      const eventId = `pvp_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const victimPieceCount = Object.keys(piecesOf(victim.player.uid === uid && local ? local : victim.player)).length;
      const event = {
        eaterUid: eater.player.uid,
        eaterSlot: eater.slot,
        eaterPieceId: eater.pieceId,
        victimUid: victim.player.uid,
        victimSlot: victim.slot,
        victimPieceId: victim.pieceId,
        area: Math.round(Math.max(100, victim.piece.radius ** 2 * 0.82)),
        fullKill: victimPieceCount <= 1,
        createdAt: nowMs,
      };
      hostPvpPendingVictims.set(victimKey, eventId);
      set(ref(db, `rooms/${roomId}/pvpEvents/${eventId}`), event).catch((err) => {
        console.warn("PvP event failed", err);
        hostPvpPendingVictims.delete(victimKey);
      });
      emitted++;
    }
  }
}

async function processPvpEvents(events = {}) {
  if (!roomId || !local || !uid) return;
  for (const [eventId, event] of Object.entries(events)) {
    if (!event) continue;
    const eventRef = ref(db, `rooms/${roomId}/pvpEvents/${eventId}`);

    if (event.victimUid === uid && !event.victimAck && !pvpVictimProcessing.has(eventId)) {
      pvpVictimProcessing.add(eventId);
      try {
        const lost = local.pieces?.[event.victimPieceId];
        if (!lost) continue;
        delete local.pieces[event.victimPieceId];
        const fullyEaten = !Object.keys(local.pieces || {}).length;
        if (fullyEaten) {
          const spawn = spawnForSlot(Number(localSlot || 0));
          local.pieces = { p0: makePiece(spawn.x, spawn.y, START_RADIUS) };
          local.shieldUntil = Date.now() + 1900;
          invulnerableUntil = performance.now() + 1900;
          deathNotice = "A rival ate you! Respawn shield active.";
        } else {
          local.shieldUntil = Date.now() + 320;
          invulnerableUntil = performance.now() + 320;
          deathNotice = "A rival ate one of your split cells!";
        }
        deathNoticeUntil = performance.now() + 1600;
        syncLocalAggregate();
        writeLocalNow();
        await update(eventRef, { victimAck: true, victimAckAt: Date.now() });
      } catch (err) {
        console.warn("PvP victim processing failed", err);
      } finally {
        pvpVictimProcessing.delete(eventId);
      }
    }

    if (event.eaterUid === uid && event.victimAck && !event.eaterAck && !pvpEaterProcessing.has(eventId)) {
      pvpEaterProcessing.add(eventId);
      try {
        let piece = local.pieces?.[event.eaterPieceId];
        if (!piece) {
          const fallback = localLargestPieceId();
          piece = fallback ? local.pieces?.[fallback] : null;
        }
        if (piece) {
          const area = Math.max(100, Math.min(MAX_CELL_RADIUS ** 2, Number(event.area) || 100));
          piece.radius = Math.min(MAX_CELL_RADIUS, Math.sqrt(piece.radius ** 2 + area));
          syncLocalAggregate();
          writeLocalNow();
          deathNotice = event.fullKill ? "PvP kill! Enemy respawned." : "You ate an enemy split cell!";
          deathNoticeUntil = performance.now() + 1200;
        }
        await update(eventRef, { eaterAck: true, eaterAckAt: Date.now() });
      } catch (err) {
        console.warn("PvP eater processing failed", err);
      } finally {
        pvpEaterProcessing.delete(eventId);
      }
    }
  }
}

function hostProcessPvpEventAcks(events = {}) {
  if (!localHost || !roomId) return;
  const nowMs = Date.now();
  for (const [eventId, event] of Object.entries(events)) {
    if (!event) continue;
    if (event.fullKill && event.victimAck && !event.killCounted && !countedPvpKillEvents.has(eventId)) {
      countedPvpKillEvents.add(eventId);
      const killRef = ref(db, `rooms/${roomId}/stats/pvpKills/${event.eaterUid}`);
      runTransaction(killRef, (current) => Math.min(100000, Math.max(0, Number(current) || 0) + 1), { applyLocally: false })
        .then(() => update(ref(db, `rooms/${roomId}/pvpEvents/${eventId}`), { killCounted: true }))
        .catch((err) => { console.warn("PvP kill counter failed", err); countedPvpKillEvents.delete(eventId); });
    }
    if ((event.victimAck && event.eaterAck) || nowMs - Number(event.createdAt || 0) > 9000) {
      const key = `${event.victimUid}:${event.victimPieceId}`;
      remove(ref(db, `rooms/${roomId}/pvpEvents/${eventId}`)).catch(console.warn);
      hostPvpPendingVictims.delete(key);
      countedPvpKillEvents.delete(eventId);
    }
  }
}

function botFamilyMasses(bots = {}) {
  const families = new Map();
  const source = localHost && hostBots.size ? hostBots.values() : Object.values(bots || {});
  for (const bot of source) {
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
      name: p.name || "Player",
      mass: playerMass(source),
      type: "player",
      self: p.uid === uid,
      partner: false,
    });
  }

  for (const entry of botFamilyMasses(bots).values()) {
    rows.push({ name: entry.name || "Enemy", mass: Math.round(entry.massArea / 100), type: "bot", self: false, partner: false });
  }

  rows.sort((a, b) => b.mass - a.mass || a.name.localeCompare(b.name));
  leaderboardList.textContent = "";
  rows.slice(0, 10).forEach((row, index) => {
    const line = document.createElement("div");
    line.className = `leaderboard-row ${row.type}${row.self ? " self" : ""}`;

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = `${row.name}${row.self ? " · YOU" : ""}`;

    const mass = document.createElement("span");
    mass.className = "leaderboard-mass";
    mass.textContent = String(row.mass);

    line.append(rank, name, mass);
    leaderboardList.append(line);
  });
}

function updateHud(players, bots = {}) {
  const selfRemote = Object.values(players).find((p) => p?.uid === uid);
  const selfSource = selfRemote && local ? { ...selfRemote, pieces: local.pieces, x: local.x, y: local.y, radius: local.radius } : selfRemote;
  const myMass = selfSource ? playerMass(selfSource) : 0;
  const liveBotFamilies = new Set();
  for (const b of Object.values(bots)) {
    if (!b || b.eatenBy) continue;
    const family = b.family || "bot0";
    if (String(family).startsWith("bot")) liveBotFamilies.add(family);
  }
  if (botsCountEl) botsCountEl.textContent = String(liveBotFamilies.size);
  scoreEl.textContent = String(myMass);

  playersList.textContent = "";
  Object.entries(players).forEach(([, p]) => {
    if (!p) return;
    const line = document.createElement("div");
    line.className = "player-line";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color || "#fff";
    const text = document.createElement("span");
    const source = p.uid === uid && local ? { ...p, pieces: local.pieces, x: local.x, y: local.y, radius: local.radius } : p;
    const cells = Object.keys(piecesOf(source)).length;
    const size = playerMass(source);
    const botKills = playerKillCount(p.uid);
    const pvpKills = playerPvpKillCount(p.uid);
    text.textContent = `${p.name || "Player"}${p.uid === uid ? " (you)" : ""} · SIZE ${size} · PvP ${pvpKills} · Bot ${botKills} · ${cells} cell${cells === 1 ? "" : "s"}`;
    line.append(dot, text);
    playersList.append(line);
  });

  updateLeaderboard(players, bots);

  const count = Object.keys(players).length;
  if (count < 3) {
    const waiting = document.createElement("div");
    waiting.className = "player-line waiting-line";
    waiting.textContent = `FFA active · ${3 - count} open player slot${3 - count === 1 ? "" : "s"}`;
    playersList.append(waiting);
  }
  hideBanner();
}

function showBanner(text) {
  banner.textContent = text;
  banner.style.whiteSpace = "pre-line";
  banner.classList.remove("hidden");
}

function hideBanner() { banner.classList.add("hidden"); }

function resizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 1.25);
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
  if (!roomId || !local) return;
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

  const aim = currentAim();
  for (const pieceId in (local.pieces || {})) {
    const piece = local.pieces[pieceId];
    if (!piece) continue;
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

}

function writeLocalNow() {
  if (!db || !roomId || !local || localSlot === null) return;
  update(ref(db, `rooms/${roomId}/players/${localSlot}`), publicPlayerPayload()).catch(console.warn);
}

function foodGridKey(gx, gy) { return `${gx},${gy}`; }

function foodGridRemove(foodId) {
  const key = foodGridIndex.get(foodId);
  if (key === undefined) return;
  const bucket = foodGrid.get(key);
  if (bucket) {
    for (let i = bucket.length - 1; i >= 0; i--) {
      if (bucket[i][0] === foodId) { bucket.splice(i, 1); break; }
    }
    if (!bucket.length) foodGrid.delete(key);
  }
  foodGridIndex.delete(foodId);
}

function foodGridUpsert(foodId, item) {
  foodGridRemove(foodId);
  if (!item || item.claimedBy) return;
  const gx = Math.floor(item.x / FOOD_GRID_SIZE);
  const gy = Math.floor(item.y / FOOD_GRID_SIZE);
  const key = foodGridKey(gx, gy);
  let bucket = foodGrid.get(key);
  if (!bucket) foodGrid.set(key, bucket = []);
  bucket.push([foodId, item]);
  foodGridIndex.set(foodId, key);
}

function ensureFoodGrid(now = performance.now()) {
  const food = roomState?.food || {};
  if (food === foodGridSource) return;
  foodGridSource = food;
  lastFoodGridBuildAt = now;
  foodGrid.clear();
  foodGridIndex.clear();
  for (const [id, item] of Object.entries(food)) foodGridUpsert(id, item);
}

function collectNearbyFood(x, y, radius, out = foodScratch) {
  ensureFoodGrid();
  out.length = 0;
  const minGX = Math.floor((x - radius) / FOOD_GRID_SIZE);
  const maxGX = Math.floor((x + radius) / FOOD_GRID_SIZE);
  const minGY = Math.floor((y - radius) / FOOD_GRID_SIZE);
  const maxGY = Math.floor((y + radius) / FOOD_GRID_SIZE);
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gy = minGY; gy <= maxGY; gy++) {
      const bucket = foodGrid.get(foodGridKey(gx, gy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
    }
  }
  return out;
}

function checkFoodCollisions() {
  if (eating.size >= MAX_CONCURRENT_FOOD_CLAIMS) return;
  const pieces = Object.entries(local.pieces || {});
  if (!pieces.length) return;
  let started = 0;
  const visited = new Set();

  for (const [pieceId, piece] of pieces) {
    const candidates = collectNearbyFood(piece.x, piece.y, piece.radius + 20);
    for (const [foodId, f] of candidates) {
      if (visited.has(foodId) || !f || f.claimedBy || eating.has(foodId)) continue;
      visited.add(foodId);
      const reach = piece.radius + (f.r || 7) * 0.6;
      const dx = piece.x - f.x;
      if (Math.abs(dx) > reach) continue;
      const dy = piece.y - f.y;
      if (Math.abs(dy) > reach || dx * dx + dy * dy >= reach * reach) continue;
      claimFood(foodId, f, pieceId);
      started++;
      if (started >= MAX_NEW_FOOD_CLAIMS_PER_TICK || eating.size >= MAX_CONCURRENT_FOOD_CLAIMS) return;
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
  const botEntries = localHost ? hostBots.entries() : remoteBotEntries;
  const pieceEntries = Object.entries(local.pieces || {});
  const protectedFromBots = performance.now() < invulnerableUntil;
  let consumedThisTick = 0;

  if (!localHost && botClaiming.size >= MAX_BOT_EATS_PER_TICK) return;
  for (const [botId, bot] of botEntries) {
    if (!bot || bot.eatenBy || botClaiming.has(botId) || botRemoving.has(botId)) continue;
    // Clients collide with the interpolated position they see. The host already owns
    // the authoritative simulation, so it collides directly with hostBots.
    const rendered = !localHost ? renderBots.get(botId) : null;
    const bx = rendered?.x ?? bot.x;
    const by = rendered?.y ?? bot.y;
    const br = rendered?.radius ?? bot.radius;

    for (const [pieceId, piece] of pieceEntries) {
      if (!local.pieces?.[pieceId]) continue;
      const dx = piece.x - bx;
      const dy = piece.y - by;
      const distSq = dx * dx + dy * dy;

      if (canConsumeSquared(piece.radius, br, distSq)) {
        if (localHost) consumeBotAsHost(botId, bot, pieceId);
        else claimBot(botId, bot, pieceId);
        consumedThisTick++;
        if (consumedThisTick >= MAX_BOT_EATS_PER_TICK) return;
        break;
      }

      if (!protectedFromBots && canConsumeSquared(br, piece.radius, distSq)) {
        eatenByBot(pieceId, botId, bot);
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
  recordPlayerBotKill(uid, botId);
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
    const spawn = spawnForSlot(Number(localSlot || 0));
    local.pieces = { p0: makePiece(spawn.x, spawn.y, START_RADIUS) };
    local.shieldUntil = Date.now() + 1900;
    deathNotice = `${bot.name || "Enemy"} ate you! Respawn shield active.`;
  } else {
    local.shieldUntil = Date.now() + 280;
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

  if (family && String(family).startsWith("bot") && familyCellCount(family) === 0 && !botRespawnAt.has(family)) {
    botRespawnAt.set(family, Date.now() + 700 + Math.floor(Math.random() * 800));
  }

  remove(ref(db, `rooms/${roomId}/bots/${botId}`))
    .then(() => countedBotKills.delete(botId))
    .catch(console.warn)
    .finally(() => botRemoving.delete(botId));
}

function familyCellCount(family) {
  let count = 0;
  for (const bot of hostBots.values()) if (bot && !bot.eatenBy && bot.family === family) count++;
  return count;
}

function ensureBotFamilies() {
  if (!localHost || !roomId) return;
  const now = Date.now();
  if (now - lastBotFamilyCheckAt < BOT_FAMILY_CHECK_INTERVAL_MS) return;
  lastBotFamilyCheckAt = now;
  const counts = new Map();
  for (const bot of hostBots.values()) {
    if (!bot || bot.eatenBy) continue;
    const family = bot.family || "bot0";
    counts.set(family, (counts.get(family) || 0) + 1);
  }

  for (let i = 0; i < BOT_FAMILY_COUNT; i++) {
    const family = `bot${i}`;
    if ((counts.get(family) || 0) > 0) {
      botRespawnAt.delete(family);
      continue;
    }

    if (!botRespawnAt.has(family)) {
      botRespawnAt.set(family, now + 500 + Math.floor(Math.random() * 700));
      continue;
    }
    if (now < botRespawnAt.get(family)) continue;
    if (botRemoving.has(family)) continue;

    const fresh = makeBot(i, family);
    hostBots.set(family, fresh);
    counts.set(family, 1);
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
  if (!remoteBotsDirty) { ensureBotFamilies(); return; }
  remoteBotsDirty = false;
  const remoteBots = roomState.bots || {};

  for (const [id, bot] of Object.entries(remoteBots)) {
    if (!bot) continue;
    const family = String(bot.family || id);
    const familyIndex = botIndexFromFamily(family);
    if (!family.startsWith("bot") || familyIndex >= BOT_FAMILY_COUNT) {
      // Clean up legacy/surplus enemy records from older builds. This build only
      // supports the 30 regular bot families bot0..bot29.
      if (!botRemoving.has(id)) deleteBotCell(id, bot.family);
      continue;
    }
    if (botRemoving.has(id)) continue;
    if (bot.eatenBy) {
      recordPlayerBotKill(bot.eatenBy, id);
      deleteBotCell(id, bot.family);
      continue;
    }
    if (!hostBots.has(id)) hostBots.set(id, { ...bot });
  }

  if (!hostBots.size && !Object.keys(remoteBots).length) {
    const fresh = makeInitialEnemies();
    for (const [id, bot] of Object.entries(fresh)) hostBots.set(id, { ...bot });
    update(ref(db, `rooms/${roomId}/bots`), fresh).catch(console.warn);
  }

  ensureBotFamilies();
}

function allPlayerTargets() {
  const targets = [];
  const players = roomState?.players || {};
  for (const p of Object.values(players)) {
    if (!p) continue;
    const source = p.uid === uid && local ? local : p;
    const kills = playerThreatKillCount(p.uid);
    const pieces = piecesOf(source);
    for (const pieceId in pieces) {
      const piece = pieces[pieceId];
      if (!piece) continue;
      targets.push({ x: piece.x, y: piece.y, radius: piece.radius, ownerUid: p.uid, pieceId, kills });
    }
  }
  return targets;
}

function botGridKeyFor(x, y) {
  const gx = Math.max(0, Math.floor(x / BOT_GRID_SIZE));
  const gy = Math.max(0, Math.floor(y / BOT_GRID_SIZE));
  return gx + gy * BOT_GRID_COLS;
}

function rebuildHostBotGrid() {
  hostBotGrid.clear();
  hostBotGridMaxRadius = 0;
  for (const [id, bot] of hostBots) {
    if (!bot || bot.eatenBy || botRemoving.has(id)) continue;
    const key = botGridKeyFor(bot.x, bot.y);
    let bucket = hostBotGrid.get(key);
    if (!bucket) hostBotGrid.set(key, bucket = []);
    bucket.push(id);
    if (bot.radius > hostBotGridMaxRadius) hostBotGridMaxRadius = bot.radius;
  }
}

function collectNearbyBotIds(x, y, radius, out = botScratch) {
  out.length = 0;
  const minGX = Math.max(0, Math.floor((x - radius) / BOT_GRID_SIZE));
  const maxGX = Math.floor((x + radius) / BOT_GRID_SIZE);
  const minGY = Math.max(0, Math.floor((y - radius) / BOT_GRID_SIZE));
  const maxGY = Math.floor((y + radius) / BOT_GRID_SIZE);
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gy = minGY; gy <= maxGY; gy++) {
      const bucket = hostBotGrid.get(gx + gy * BOT_GRID_COLS);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
    }
  }
  return out;
}

function processBotMeals() {
  if (!localHost || !roomId || !botMealsDirty) return;
  botMealsDirty = false;
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
  const familyLimit = BOT_MAX_FAMILY_CELLS;
  if (familyCellCount(family) >= familyLimit) return false;

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
  for (let i = 0; i < hostFamilyGroups.length; i++) hostFamilyGroups[i].length = 0;
  for (const [id, bot] of hostBots) {
    if (!bot || bot.eatenBy) continue;
    const index = botIndexFromFamily(bot.family || id);
    if (index >= 0 && index < BOT_FAMILY_COUNT) hostFamilyGroups[index].push(id);
  }

  for (let gi = 0; gi < hostFamilyGroups.length; gi++) {
    const ids = hostFamilyGroups[gi];
    for (let i = 0; i < ids.length; i++) {
      const idA = ids[i];
      const a = hostBots.get(idA);
      if (!a) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const idB = ids[j];
        const b = hostBots.get(idB);
        if (!b) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) || 0.001;
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
  syncHostKillCounts();
  if (!hostBots.size) return;

  const playerTargets = allPlayerTargets();
  ensureFoodGrid(now);
  rebuildHostBotGrid();
  const entriesAtStart = [...hostBots.entries()];
  const epochNow = Date.now();
  const wallMargin = 150;

  for (const [botId, bot] of entriesAtStart) {
    if (!hostBots.has(botId) || botRemoving.has(botId)) continue;

    const personality = BOT_PERSONALITIES.includes(bot.personality) ? bot.personality : (BOT_PERSONALITIES[botIndexFromFamily(bot.family) % BOT_PERSONALITIES.length] || "dumb");
    bot.personality = personality;
    let dirX = bot.vx || 1;
    let dirY = bot.vy || 0;
    let threat = null;
    let threatDistSq = Infinity;
    let threatFear = 0;
    let playerPrey = null;
    let playerPreyDistSq = Infinity;
    let botPrey = null;
    let botPreyDistSq = Infinity;

    // Reputation/fear: normal bots remember each player's recent kill reputation through
    // the host-owned room counter. The more dangerous a player has proven to be,
    // the earlier ordinary bots start giving them space. Dedicated Hunters stay
    // aggressive, while Cannibals mainly care about eating other bot families.
    const baseThreatRange = personality === "dumb" ? 260 : personality === "chaos" ? 420 : 760;
    const cautiousAroundReputation = personality !== "hunter" && personality !== "cannibal";
    for (const p of playerTargets) {
      const pdx = p.x - bot.x;
      const pdy = p.y - bot.y;
      const d2 = pdx * pdx + pdy * pdy;
      const fear = Math.min(1, Math.max(0, Number(p.kills || 0)) / FEAR_FULL_KILLS);
      const obviousThreat = p.radius > bot.radius * BOT_EAT_RATIO;
      const reputationThreat = cautiousAroundReputation
        && fear > 0.04
        && p.radius > bot.radius * (0.88 - fear * 0.28);
      const effectiveThreatRange = baseThreatRange + (cautiousAroundReputation ? fear * FEAR_EXTRA_RANGE : 0);
      if ((obviousThreat || reputationThreat) && d2 < effectiveThreatRange * effectiveThreatRange && d2 < threatDistSq) {
        threat = p;
        threatDistSq = d2;
        threatFear = reputationThreat ? fear : Math.max(threatFear, fear * 0.4);
      }

      if (bot.radius > p.radius * BOT_EAT_RATIO && d2 < 950 * 950 && d2 < playerPreyDistSq) {
        const safeEnoughToHunt = !cautiousAroundReputation
          || fear < 0.20
          || bot.radius > p.radius * (1.35 + fear * 0.70);
        if (safeEnoughToHunt) {
          playerPrey = p;
          playerPreyDistSq = d2;
        }
      }
    }

    if (personality === "hunter" || personality === "rival" || personality === "cannibal") {
      const preySense = personality === "cannibal" ? CANNIBAL_SENSE_RANGE : 920;
      const preyRatio = personality === "cannibal" ? 1.06 : BOT_EAT_RATIO;
      const botThreatSense = personality === "cannibal" ? 820 : 700;
      const sense = Math.max(preySense, botThreatSense);
      const nearbyIds = collectNearbyBotIds(bot.x, bot.y, sense);
      for (let ni = 0; ni < nearbyIds.length; ni++) {
        const otherId = nearbyIds[ni];
        if (otherId === botId) continue;
        const other = hostBots.get(otherId);
        if (!other || other.eatenBy || other.family === bot.family) continue;
        const odx = other.x - bot.x;
        const ody = other.y - bot.y;
        const d2 = odx * odx + ody * ody;
        if (other.radius > bot.radius * BOT_EAT_RATIO && d2 < botThreatSense * botThreatSense && d2 < threatDistSq) {
          threat = other;
          threatDistSq = d2;
          threatFear = 0;
        }
        if (bot.radius > other.radius * preyRatio && d2 < preySense * preySense && d2 < botPreyDistSq) {
          botPrey = other;
          botPreyDistSq = d2;
        }
      }
    }

    if (threat) {
      dirX = bot.x - threat.x;
      dirY = bot.y - threat.y;
    } else if (personality === "cannibal" && botPrey) {
      // Cannibals actively create their own snowball: they seek other families
      // across a large radius and split only when it gives them a strong eat angle.
      dirX = botPrey.x - bot.x;
      dirY = botPrey.y - bot.y;
      if (botPreyDistSq > (bot.radius * 1.35) ** 2 && botPreyDistSq < 520 * 520 && bot.radius > botPrey.radius * 1.42) {
        splitBot(botId, bot, dirX, dirY);
      }
    } else if (personality === "hunter" && playerPrey) {
      // Hunter bots prioritize human players and deliberately split-attack.
      dirX = playerPrey.x - bot.x;
      dirY = playerPrey.y - bot.y;
      if (playerPreyDistSq > (bot.radius * 1.4) ** 2 && playerPreyDistSq < 470 * 470 && bot.radius > playerPrey.radius * 1.43) {
        splitBot(botId, bot, dirX, dirY);
      }
    } else if (personality === "rival" && (botPrey || playerPrey)) {
      // Rival bots prefer eating other bot families, then fall back to players.
      const prey = botPrey || playerPrey;
      const preyDistSq = botPrey ? botPreyDistSq : playerPreyDistSq;
      dirX = prey.x - bot.x;
      dirY = prey.y - bot.y;
      if (preyDistSq > (bot.radius * 1.4) ** 2 && preyDistSq < 450 * 450 && bot.radius > prey.radius * 1.45) {
        splitBot(botId, bot, dirX, dirY);
      }
    } else if (personality !== "dumb" && playerPrey && personality !== "chaos" && personality !== "cannibal") {
      dirX = playerPrey.x - bot.x;
      dirY = playerPrey.y - bot.y;
    } else {
      let nearestFood = null;
      const foodSense = personality === "dumb" ? 280 : personality === "cannibal" ? 620 : 520;
      let nearestFoodDistSq = foodSense * foodSense;
      // Dumb bots are bad at choosing food; chaos bots are slightly better but unstable.
      if (personality !== "dumb" || Math.random() < 0.35) {
        for (const [, f] of collectNearbyFood(bot.x, bot.y, foodSense)) {
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
      } else if (epochNow >= (bot.turnAt || 0)) {
        const angle = Math.random() * Math.PI * 2;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
        const turnMin = personality === "dumb" ? 450 : personality === "chaos" ? 650 : personality === "cannibal" ? 800 : 1100;
        const turnSpread = personality === "dumb" ? 1300 : personality === "chaos" ? 1700 : personality === "cannibal" ? 1700 : 2800;
        bot.turnAt = epochNow + turnMin + Math.floor(Math.random() * turnSpread);
      }
    }

    // Chaos bots split in random directions for no good reason. Dumb bots do it rarely too.
    const randomSplitRate = personality === "chaos" ? 0.22 : personality === "dumb" ? 0.035 : 0;
    if (randomSplitRate && bot.radius >= BOT_SPLIT_MIN_RADIUS && epochNow >= (bot.splitReadyAt || 0) && Math.random() < randomSplitRate * dt) {
      const angle = Math.random() * Math.PI * 2;
      splitBot(botId, bot, Math.cos(angle), Math.sin(angle));
    }

    // Basic wall awareness keeps all personalities from spending too long pressed against an edge.
    if (bot.x < wallMargin) dirX += 1.8;
    if (bot.x > WORLD.width - wallMargin) dirX -= 1.8;
    if (bot.y < wallMargin) dirY += 1.8;
    if (bot.y > WORLD.height - wallMargin) dirY -= 1.8;

    const mag = Math.hypot(dirX, dirY) || 1;
    const steering = personality === "dumb" ? 1.2 : personality === "chaos" ? 2.0 : personality === "cannibal" ? 4.0 : 3.6;
    bot.vx += (dirX / mag - bot.vx) * Math.min(1, dt * steering);
    bot.vy += (dirY / mag - bot.vy) * Math.min(1, dt * steering);
    const vmag = Math.hypot(bot.vx, bot.vy) || 1;
    bot.vx /= vmag;
    bot.vy /= vmag;

    const speedBase = personality === "hunter" ? 250 : personality === "cannibal" ? 246 : personality === "rival" ? 242 : personality === "chaos" ? 232 : 218;
    const fleeBoost = threat ? 1.18 + threatFear * 0.22 : 1;
    const speed = Math.max(66, speedBase - bot.radius * 1.45) * fleeBoost;
    bot.x += bot.vx * speed * dt + (bot.boostX || 0) * dt;
    bot.y += bot.vy * speed * dt + (bot.boostY || 0) * dt;
    const boostDrag = Math.pow(0.03, dt);
    bot.boostX = (bot.boostX || 0) * boostDrag;
    bot.boostY = (bot.boostY || 0) * boostDrag;
    if (Math.abs(bot.boostX) < 0.4) bot.boostX = 0;
    if (Math.abs(bot.boostY) < 0.4) bot.boostY = 0;

    bot.x = Math.max(bot.radius, Math.min(WORLD.width - bot.radius, bot.x));
    bot.y = Math.max(bot.radius, Math.min(WORLD.height - bot.radius, bot.y));

    for (const [foodId, f] of collectNearbyFood(bot.x, bot.y, bot.radius + 18)) {
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

  // Different enemy families can eat each other. Rebuild a spatial grid after
  // movement so this is no longer an O(n²) all-pairs scan when many bots split.
  rebuildHostBotGrid();
  for (const [idA, a] of hostBots) {
    if (!a || a.eatenBy || !hostBots.has(idA)) continue;
    const nearbyIds = collectNearbyBotIds(a.x, a.y, Math.max(a.radius, hostBotGridMaxRadius) + 12);
    for (let ni = 0; ni < nearbyIds.length; ni++) {
      const idB = nearbyIds[ni];
      if (idB <= idA || !hostBots.has(idA) || !hostBots.has(idB)) continue;
      const b = hostBots.get(idB);
      if (!b || b.eatenBy || a.family === b.family) continue;
      const bdx = a.x - b.x;
      const bdy = a.y - b.y;
      const distSq = bdx * bdx + bdy * bdy;
      let bigId, big, smallId, small;
      if (canConsumeSquared(a.radius, b.radius, distSq)) [bigId, big, smallId, small] = [idA, a, idB, b];
      else if (canConsumeSquared(b.radius, a.radius, distSq)) [bigId, big, smallId, small] = [idB, b, idA, a];
      else continue;
      const botEatGain = big.personality === "cannibal" ? CANNIBAL_EAT_GAIN : 0.64;
      big.radius = Math.min(MAX_CELL_RADIUS, Math.sqrt(big.radius ** 2 + small.radius ** 2 * botEatGain));
      hostBots.set(bigId, big);
      deleteBotCell(smallId, small.family);
    }
  }

  ensureBotFamilies();

  if (now - lastBotNetworkWrite > BOT_NETWORK_INTERVAL_MS) {
    lastBotNetworkWrite = now;
    const syncFullState = now - lastBotStateNetworkWrite > BOT_STATE_NETWORK_INTERVAL_MS;
    if (syncFullState) lastBotStateNetworkWrite = now;
    const patch = {};
    for (const [id, bot] of hostBots) {
      if (botRemoving.has(id)) continue;
      // Hot path: clients only need position + size for rendering/collisions.
      patch[`bots/${id}/x`] = Math.round(bot.x * 10) / 10;
      patch[`bots/${id}/y`] = Math.round(bot.y * 10) / 10;
      patch[`bots/${id}/radius`] = Math.round(bot.radius * 100) / 100;
      // Host migration state is much less time-sensitive, so sync it ~1 Hz.
      if (syncFullState) {
        patch[`bots/${id}/vx`] = Math.round(bot.vx * 1000) / 1000;
        patch[`bots/${id}/vy`] = Math.round(bot.vy * 1000) / 1000;
        patch[`bots/${id}/boostX`] = Math.round((bot.boostX || 0) * 10) / 10;
        patch[`bots/${id}/boostY`] = Math.round((bot.boostY || 0) * 10) / 10;
        patch[`bots/${id}/turnAt`] = Math.round(bot.turnAt || 0);
        patch[`bots/${id}/mergeAt`] = Math.round(bot.mergeAt || 0);
        patch[`bots/${id}/splitReadyAt`] = Math.round(bot.splitReadyAt || 0);
      }
    }
    if (Object.keys(patch).length) update(ref(db, `rooms/${roomId}`), patch).catch(console.warn);
  }
}

function hostMaintenance(now) {
  if (!localHost || !roomId || !roomState || now < hostMaintenanceReadyAt || now - hostLoopAt < 1400) return;
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
  ensureFoodGrid(performance.now());
  const minGX = Math.max(0, Math.floor((cam.x - 20) / FOOD_GRID_SIZE));
  const maxGX = Math.floor((cam.x + innerWidth + 20) / FOOD_GRID_SIZE);
  const minGY = Math.max(0, Math.floor((cam.y - 20) / FOOD_GRID_SIZE));
  const maxGY = Math.floor((cam.y + innerHeight + 20) / FOOD_GRID_SIZE);
  for (let gx = minGX; gx <= maxGX; gx++) {
    for (let gy = minGY; gy <= maxGY; gy++) {
      const bucket = foodGrid.get(foodGridKey(gx, gy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const f = bucket[i][1];
        if (!f || f.claimedBy) continue;
        const x = f.x - cam.x;
        const y = f.y - cam.y;
        const r = f.r || 7;
        if (x < -16 || y < -16 || x > innerWidth + 16 || y > innerHeight + 16) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = f.color || "#fff";
        ctx.fill();
      }
    }
  }
}

function smoothPlayerPieces(dt) {
  const players = roomState?.players || {};
  const seenId = ++renderPlayerSeenId;
  const smoothT = 1 - Math.pow(0.001, dt);
  for (const [slot, p] of Object.entries(players)) {
    const source = p.uid === uid && local ? local : p;
    for (const [pieceId, piece] of Object.entries(piecesOf(source))) {
      const key = `${slot}:${pieceId}`;
      let rp = renderPlayerPieces.get(key);
      if (!rp) {
        rp = { x: piece.x, y: piece.y, radius: piece.radius, seenId };
        renderPlayerPieces.set(key, rp);
      }
      rp.seenId = seenId;
      rp.x += (piece.x - rp.x) * smoothT;
      rp.y += (piece.y - rp.y) * smoothT;
      rp.radius += (piece.radius - rp.radius) * smoothT;
    }
  }
  for (const [key, rp] of renderPlayerPieces) if (rp.seenId !== seenId) renderPlayerPieces.delete(key);
}

function smoothBots(dt) {
  const seenId = ++renderBotSeenId;
  const smoothT = 1 - Math.pow(0.0007, dt);
  const sourceEntries = localHost ? hostBots.entries() : remoteBotEntries;
  for (const [id, remote] of sourceEntries) {
    if (!remote || remote.eatenBy) continue;
    let rb = renderBots.get(id);
    if (!rb) {
      rb = { x: remote.x, y: remote.y, radius: remote.radius, seenId };
      renderBots.set(id, rb);
    }
    rb.seenId = seenId;
    rb.x += (remote.x - rb.x) * smoothT;
    rb.y += (remote.y - rb.y) * smoothT;
    rb.radius += (remote.radius - rb.radius) * smoothT;
  }
  for (const [id, rb] of renderBots) if (rb.seenId !== seenId) renderBots.delete(id);
}

function drawBots(cam) {
  const sourceEntries = localHost ? hostBots.entries() : remoteBotEntries;
  const crowded = renderBots.size > 55;
  for (const [id, bot] of sourceEntries) {
    if (!bot || bot.eatenBy) continue;
    const rb = renderBots.get(id) || bot;
    const x = rb.x - cam.x;
    const y = rb.y - cam.y;
    const r = rb.radius;
    if (x < -r - 30 || y < -r - 30 || x > innerWidth + r + 30 || y > innerHeight + r + 30) continue;

    ctx.save();
    // Shadows on dozens of large circles are extremely expensive on Canvas2D.
    // Bots use a flat silhouette; the player's own cell keeps a small glow below.
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = bot.color || "#ff5f6d";
    ctx.fill();
    ctx.lineWidth = Math.max(2.5, Math.min(10, r * 0.065));
    ctx.strokeStyle = "rgba(80, 3, 20, .72)";
    ctx.stroke();


    // Detail LOD: giant cells are expensive mostly because of multiple large
    // alpha-blended shapes. Their silhouette/name is enough while zoomed in.
    if (!crowded && r >= 22 && r < 220) {
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

    if (r >= 34 && (!crowded || r >= 90)) {
      const fontSize = Math.max(10, Math.min(17, r * 0.34));
      ctx.font = `900 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(54,7,18,.88)";
      ctx.fillText(bot.name || "Enemy", x, y + Math.min(r * 0.28, 90));
    }
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
      if (p.uid === uid && r < 120) {
        ctx.shadowColor = p.color || "#fff";
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color || "#fff";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, Math.min(12, r * 0.07));
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.stroke();

      const shielded = p.uid === uid
        ? (performance.now() < invulnerableUntil || Number(local?.shieldUntil || 0) > Date.now())
        : Number(p.shieldUntil || 0) > Date.now();
      if (shielded) {
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
      ctx.fillText(p.name || "Player", x, y);
      ctx.restore();
    }
  }
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
  if (!roomId || !local) return;
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
let lastRenderAt = 0;
function frame(now) {
  const dt = Math.min(0.04, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!roomId) {
    requestAnimationFrame(frame);
    return;
  }
  tickMovement(dt);
  if (roomId && local && roomState && now - lastLocalCollisionAt >= LOCAL_COLLISION_INTERVAL_MS) {
    lastLocalCollisionAt = now;
    checkFoodCollisions();
    checkBotCollisions();
  }
  if (localHost && now - lastBotSimAt >= BOT_SIM_INTERVAL_MS) {
    const botDt = lastBotSimAt ? Math.min(0.06, (now - lastBotSimAt) / 1000) : dt;
    lastBotSimAt = now;
    tickBots(botDt, now);
    hostResolvePvp(Date.now());
  }
  hostMaintenance(now);

  if (now - lastHudUpdateAt >= HUD_UPDATE_INTERVAL_MS) {
    lastHudUpdateAt = now;
    updateHud(roomState?.players || {}, roomState?.bots || {});
  }

  if (now - lastRenderAt >= MIN_RENDER_INTERVAL_MS) {
    const renderDt = lastRenderAt ? Math.min(0.05, (now - lastRenderAt) / 1000) : dt;
    lastRenderAt = now;
    smoothPlayerPieces(renderDt);
    smoothBots(renderDt);

    const cam = getCamera();
    drawGrid(cam);
    drawFood(cam);
    drawBots(cam);
    drawPlayers(cam);
    drawDirection();
    drawDeathNotice(now);
  }
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
  if (!roomId) return;
  if (e.code === "Space") {
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
