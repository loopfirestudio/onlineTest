// Blob Buddies — 2-player Agar.io-inspired co-op demo with synchronized enemy bots
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

// Firebase web app config for the testonlinerealtime project.
// databaseURL is required for Realtime Database.
const firebaseConfig = {
  apiKey: "AIzaSyDd555TxypX12AUjMWx_lmkeVFGgQDHJqw",
  authDomain: "testonlinerealtime.firebaseapp.com",
  databaseURL: "https://testonlinerealtime-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "testonlinerealtime",
  storageBucket: "testonlinerealtime.firebasestorage.app",
  messagingSenderId: "257019969127",
  appId: "1:257019969127:web:0a910b0fe08fde4d60dec2",
};

const WORLD = { width: 3000, height: 2000 };
const FOOD_TARGET = 130;
const TEAM_GOAL = 120;
const START_RADIUS = 30;
const BOT_COUNT = 8;
const BOT_EAT_RATIO = 1.14;
const BOT_RESPAWN_MIN_RADIUS = 22;
const BOT_RESPAWN_MAX_RADIUS = 43;
const COLORS = ["#72e7ff", "#a78bfa"];
const FOOD_COLORS = ["#75f0ba", "#ffd166", "#ff7aa8", "#7bdff2", "#b8f2e6", "#cdb4ff"];
const BOT_COLORS = ["#ff5f6d", "#ff8c42", "#ff477e", "#ef476f", "#f78c6b", "#ff6b6b", "#f25f5c", "#e85d75"];
const BOT_NAMES = ["Chomper", "Razor", "Glitch", "NomNom", "Viper", "Crimson", "Munch", "Hunter"];

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const menu = document.querySelector("#menu");
const hud = document.querySelector("#hud");
const leaveBtn = document.querySelector("#leaveBtn");
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
const banner = document.querySelector("#banner");

goalEl.textContent = String(TEAM_GOAL);

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
let eating = new Set();
let botEating = new Set();
let botClaiming = new Set();
let botRespawning = new Set();
let won = false;
let invulnerableUntil = 0;
let deathNoticeUntil = 0;
let deathNotice = "";
let previousPlayerCount = 0;

const pointer = { x: innerWidth / 2, y: innerHeight / 2, active: true };
const renderPlayers = new Map();
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

function makePlayer(slot = 0) {
  return {
    uid,
    name: cleanName(nameInput.value),
    x: WORLD.width / 2 + (slot ? 90 : -90),
    y: WORLD.height / 2,
    radius: START_RADIUS,
    color: COLORS[slot % COLORS.length],
    joinedAt: Date.now(),
    lastSeen: Date.now(),
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
    };
  }
  return food;
}

function makeBot(index = 0, id = `bot${index}`) {
  const angle = Math.random() * Math.PI * 2;
  const radius = BOT_RESPAWN_MIN_RADIUS + Math.random() * (BOT_RESPAWN_MAX_RADIUS - BOT_RESPAWN_MIN_RADIUS);
  return {
    name: BOT_NAMES[index % BOT_NAMES.length],
    x: 100 + Math.random() * (WORLD.width - 200),
    y: 100 + Math.random() * (WORLD.height - 200),
    radius: Math.round(radius * 100) / 100,
    color: BOT_COLORS[index % BOT_COLORS.length],
    vx: Math.cos(angle),
    vy: Math.sin(angle),
    turnAt: Date.now() + 1000 + Math.floor(Math.random() * 2600),
  };
}

function makeBots(count = BOT_COUNT) {
  const bots = {};
  for (let i = 0; i < count; i++) bots[`bot${i}`] = makeBot(i, `bot${i}`);
  return bots;
}

function botIndex(botId) {
  const n = Number(String(botId).replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function ensureFirebase() {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured yet. Paste your Firebase web config into app.js first.");
  }
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
      meta: {
        hostUid: uid,
        createdAt: serverTimestamp(),
        goal: TEAM_GOAL,
        world: WORLD,
      },
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
    await enterRoom(code, player, claimedSlot);
  } catch (err) {
    console.error(err);
    setBusy(false, friendlyError(err));
  }
}

async function enterRoom(code, player, slot) {
  roomId = code;
  local = { ...player };
  localSlot = slot;
  won = false;
  previousPlayerCount = 0;
  renderPlayers.clear();
  renderBots.clear();
  hostBots.clear();
  roomCodeEl.textContent = code;
  menu.classList.add("hidden");
  hud.classList.remove("hidden");
  leaveBtn.classList.remove("hidden");
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
    if (playerValues.length >= 2 && previousPlayerCount < 2) {
      invulnerableUntil = Math.max(invulnerableUntil, performance.now() + 2400);
    }
    previousPlayerCount = playerValues.length;
    const selfPresent = playerValues.some((p) => p?.uid === uid);
    const hostPresent = playerValues.some((p) => p?.uid === meta.hostUid);
    const wasHost = localHost;
    localHost = meta.hostUid === uid;
    if (localHost !== wasHost) {
      hostBots.clear();
      botRespawning.clear();
    }

    // If the host disappeared, a remaining player can claim host duties.
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
    if (snap.val() === true && roomId) {
      onDisconnect(ref(db, `rooms/${roomId}/players/${localSlot}`)).remove().catch(console.warn);
    }
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

  // Clean up an empty room. If another player remains, host election handles it.
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
  renderPlayers.clear();
  renderBots.clear();
  hostBots.clear();
  eating.clear();
  botEating.clear();
  botClaiming.clear();
  botRespawning.clear();
  won = false;
  invulnerableUntil = 0;
  deathNoticeUntil = 0;
  previousPlayerCount = 0;
  hideBanner();
  hud.classList.add("hidden");
  leaveBtn.classList.add("hidden");
  menu.classList.remove("hidden");
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (msg.includes("auth/operation-not-allowed")) return "Enable Anonymous sign-in in Firebase Authentication.";
  if (msg.includes("PERMISSION_DENIED")) return "Firebase rules denied access. Deploy database.rules.json.";
  if (msg.includes("Failed to fetch") || msg.includes("network")) return "Network connection failed.";
  return msg;
}

function teamMass(players) {
  return Object.values(players).reduce((sum, p) => sum + Math.round((p.radius * p.radius) / 100), 0);
}

function updateHud(players, bots = {}) {
  const mass = teamMass(players);
  if (botsCountEl) botsCountEl.textContent = String(Object.values(bots).filter((b) => b && !b.eatenBy).length);
  scoreEl.textContent = String(mass);
  progressBar.style.width = `${Math.min(100, (mass / TEAM_GOAL) * 100)}%`;

  playersList.textContent = "";
  Object.entries(players).forEach(([id, p]) => {
    const line = document.createElement("div");
    line.className = "player-line";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color || "#fff";
    const text = document.createElement("span");
    text.textContent = `${p.name || "Buddy"}${p.uid === uid ? " (you)" : ""}`;
    line.append(dot, text);
    playersList.append(line);
  });

  const count = Object.keys(players).length;
  if (count < 2) {
    showBanner(`Waiting for your buddy…\nRoom ${roomId}`);
  } else if (mass >= TEAM_GOAL) {
    won = true;
    showBanner("Team goal reached! 🎉\nKeep eating or start a new room.");
  } else if (!won) {
    hideBanner();
  }
}

function showBanner(text) {
  banner.textContent = text;
  banner.style.whiteSpace = "pre-line";
  banner.classList.remove("hidden");
}

function hideBanner() {
  banner.classList.add("hidden");
}

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

function tickMovement(dt) {
  if (!roomId || !roomState || !local) return;
  const players = roomState.players || {};
  if (Object.keys(players).length < 2) return;

  const dx = pointer.x - innerWidth / 2;
  const dy = pointer.y - innerHeight / 2;
  const dist = Math.hypot(dx, dy);
  if (dist > 6) {
    const normalized = Math.min(dist / 180, 1);
    const speed = Math.max(90, 265 - local.radius * 2.25) * normalized;
    local.x += (dx / dist) * speed * dt;
    local.y += (dy / dist) * speed * dt;
    local.x = Math.max(local.radius, Math.min(WORLD.width - local.radius, local.x));
    local.y = Math.max(local.radius, Math.min(WORLD.height - local.radius, local.y));
  }

  const now = performance.now();
  if (now - lastNetworkWrite > 55) {
    lastNetworkWrite = now;
    update(ref(db, `rooms/${roomId}/players/${localSlot}`), {
      x: Math.round(local.x * 10) / 10,
      y: Math.round(local.y * 10) / 10,
      radius: Math.round(local.radius * 100) / 100,
      lastSeen: Date.now(),
    }).catch(console.warn);
  }

  checkFoodCollisions();
  checkBotCollisions();
}

function checkFoodCollisions() {
  const food = roomState?.food || {};
  for (const [foodId, f] of Object.entries(food)) {
    if (f.claimedBy || eating.has(foodId)) continue;
    const dist = Math.hypot(local.x - f.x, local.y - f.y);
    if (dist < local.radius + f.r * 0.6) claimFood(foodId, f);
  }
}

async function claimFood(foodId, food) {
  if (!roomId || eating.has(foodId)) return;
  eating.add(foodId);
  const foodRef = ref(db, `rooms/${roomId}/food/${foodId}`);
  try {
    const result = await runTransaction(foodRef, (current) => {
      if (!current || current.claimedBy) return;
      return { ...current, claimedBy: uid };
    }, { applyLocally: false });

    if (result.committed && result.snapshot.val()?.claimedBy === uid) {
      const gainedArea = (food.r || 7) ** 2 * 0.82;
      local.radius = Math.sqrt(local.radius ** 2 + gainedArea);
      await remove(foodRef);
    }
  } catch (err) {
    console.warn("Food claim failed", err);
  } finally {
    eating.delete(foodId);
  }
}

function checkBotCollisions() {
  if (!local || !roomState?.bots || performance.now() < invulnerableUntil) return;
  for (const [botId, bot] of Object.entries(roomState.bots)) {
    if (!bot || bot.eatenBy || botClaiming.has(botId)) continue;
    const dist = Math.hypot(local.x - bot.x, local.y - bot.y);

    if (local.radius > bot.radius * BOT_EAT_RATIO && dist < local.radius - bot.radius * 0.12) {
      claimBot(botId, bot);
      continue;
    }

    if (bot.radius > local.radius * BOT_EAT_RATIO && dist < bot.radius - local.radius * 0.12) {
      eatenByBot(bot);
      break;
    }
  }
}

async function claimBot(botId, bot) {
  if (!roomId || !local || botClaiming.has(botId)) return;
  botClaiming.add(botId);
  const botRef = ref(db, `rooms/${roomId}/bots/${botId}`);
  try {
    const result = await runTransaction(botRef, (current) => {
      if (!current || current.eatenBy) return;
      return { ...current, eatenBy: uid };
    }, { applyLocally: false });

    if (result.committed && result.snapshot.val()?.eatenBy === uid) {
      const gainedArea = (bot.radius || 28) ** 2 * 0.72;
      local.radius = Math.min(400, Math.sqrt(local.radius ** 2 + gainedArea));
    }
  } catch (err) {
    console.warn("Bot claim failed", err);
  } finally {
    botClaiming.delete(botId);
  }
}

function eatenByBot(bot) {
  const now = performance.now();
  if (!local || now < invulnerableUntil) return;
  local.radius = START_RADIUS;
  local.x = Math.max(80, Math.min(WORLD.width - 80, WORLD.width / 2 + (localSlot ? 180 : -180) + (Math.random() - 0.5) * 280));
  local.y = Math.max(80, Math.min(WORLD.height - 80, WORLD.height / 2 + (Math.random() - 0.5) * 280));
  invulnerableUntil = now + 2400;
  deathNotice = `${bot.name || "Enemy"} ate you! Respawn shield active.`;
  deathNoticeUntil = now + 1800;

  update(ref(db, `rooms/${roomId}/players/${localSlot}`), {
    x: Math.round(local.x * 10) / 10,
    y: Math.round(local.y * 10) / 10,
    radius: local.radius,
    lastSeen: Date.now(),
  }).catch(console.warn);
}

async function botClaimFood(botId, foodId, food) {
  const key = `${botId}:${foodId}`;
  if (!roomId || botEating.has(key)) return;
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
      if (sim) sim.radius = Math.min(260, Math.sqrt(sim.radius ** 2 + (food.r || 7) ** 2 * 0.68));
      await remove(foodRef);
    }
  } catch (err) {
    console.warn("Bot food claim failed", err);
  } finally {
    botEating.delete(key);
  }
}

function resetBot(botId) {
  if (!roomId || botRespawning.has(botId)) return;
  botRespawning.add(botId);
  const fresh = makeBot(botIndex(botId), botId);
  hostBots.set(botId, { ...fresh });
  set(ref(db, `rooms/${roomId}/bots/${botId}`), fresh)
    .catch(console.warn)
    .finally(() => botRespawning.delete(botId));
}

function ensureHostBots() {
  if (!localHost || !roomState) return;
  const remoteBots = roomState.bots || {};

  if (Object.keys(remoteBots).length === 0 && hostBots.size === 0) {
    const fresh = makeBots();
    for (const [id, bot] of Object.entries(fresh)) hostBots.set(id, { ...bot });
    update(ref(db, `rooms/${roomId}/bots`), fresh).catch(console.warn);
    return;
  }

  for (const [id, bot] of Object.entries(remoteBots)) {
    if (!bot) continue;
    if (bot.eatenBy) {
      resetBot(id);
      continue;
    }
    if (!hostBots.has(id)) hostBots.set(id, { ...bot });
  }

  for (const id of [...hostBots.keys()]) {
    if (!remoteBots[id] && !botRespawning.has(id)) hostBots.delete(id);
  }
}

function tickBots(dt, now) {
  if (!localHost || !roomId || !roomState) return;
  ensureHostBots();
  if (!hostBots.size) return;

  const players = Object.values(roomState.players || {}).filter(Boolean);
  const food = roomState.food || {};
  const botEntries = [...hostBots.entries()];

  for (const [botId, bot] of botEntries) {
    if (botRespawning.has(botId)) continue;
    const remote = roomState.bots?.[botId];
    if (remote?.eatenBy) continue;

    let dirX = bot.vx || 1;
    let dirY = bot.vy || 0;
    let threat = null;
    let threatDist = Infinity;
    let prey = null;
    let preyDist = Infinity;

    for (const p of players) {
      const d = Math.hypot(p.x - bot.x, p.y - bot.y);
      if (p.radius > bot.radius * BOT_EAT_RATIO && d < 720 && d < threatDist) { threat = p; threatDist = d; }
      if (bot.radius > p.radius * BOT_EAT_RATIO && d < 880 && d < preyDist) { prey = p; preyDist = d; }
    }

    if (threat) {
      dirX = bot.x - threat.x;
      dirY = bot.y - threat.y;
    } else if (prey) {
      dirX = prey.x - bot.x;
      dirY = prey.y - bot.y;
    } else {
      let nearestFood = null;
      let nearestFoodDist = 560;
      for (const f of Object.values(food)) {
        if (!f || f.claimedBy) continue;
        const d = Math.hypot(f.x - bot.x, f.y - bot.y);
        if (d < nearestFoodDist) { nearestFood = f; nearestFoodDist = d; }
      }
      if (nearestFood) {
        dirX = nearestFood.x - bot.x;
        dirY = nearestFood.y - bot.y;
      } else if (Date.now() >= (bot.turnAt || 0)) {
        const angle = Math.random() * Math.PI * 2;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
        bot.turnAt = Date.now() + 1200 + Math.floor(Math.random() * 3200);
      }
    }

    const mag = Math.hypot(dirX, dirY) || 1;
    bot.vx += (dirX / mag - bot.vx) * Math.min(1, dt * 3.2);
    bot.vy += (dirY / mag - bot.vy) * Math.min(1, dt * 3.2);
    const vmag = Math.hypot(bot.vx, bot.vy) || 1;
    bot.vx /= vmag;
    bot.vy /= vmag;

    const speed = Math.max(72, 238 - bot.radius * 1.65) * (threat ? 1.16 : 1);
    bot.x += bot.vx * speed * dt;
    bot.y += bot.vy * speed * dt;
    bot.x = Math.max(bot.radius, Math.min(WORLD.width - bot.radius, bot.x));
    bot.y = Math.max(bot.radius, Math.min(WORLD.height - bot.radius, bot.y));

    for (const [foodId, f] of Object.entries(food)) {
      if (!f || f.claimedBy) continue;
      if (Math.hypot(bot.x - f.x, bot.y - f.y) < bot.radius + f.r * 0.35) {
        botClaimFood(botId, foodId, f);
        break;
      }
    }
  }

  // Bots can eat each other too, which creates a more Agar.io-like ecosystem.
  for (let i = 0; i < botEntries.length; i++) {
    const [idA, a] = botEntries[i];
    if (!a || botRespawning.has(idA) || roomState.bots?.[idA]?.eatenBy) continue;
    for (let j = i + 1; j < botEntries.length; j++) {
      const [idB, b] = botEntries[j];
      if (!b || botRespawning.has(idB) || roomState.bots?.[idB]?.eatenBy) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      let bigId, big, smallId, small;
      if (a.radius > b.radius * BOT_EAT_RATIO) { [bigId, big, smallId, small] = [idA, a, idB, b]; }
      else if (b.radius > a.radius * BOT_EAT_RATIO) { [bigId, big, smallId, small] = [idB, b, idA, a]; }
      else continue;
      if (d < big.radius - small.radius * 0.12) {
        big.radius = Math.min(260, Math.sqrt(big.radius ** 2 + small.radius ** 2 * 0.64));
        resetBot(smallId);
      }
    }
  }

  if (now - lastBotNetworkWrite > 110) {
    lastBotNetworkWrite = now;
    const patch = {};
    for (const [id, bot] of hostBots) {
      if (botRespawning.has(id) || roomState.bots?.[id]?.eatenBy) continue;
      patch[`bots/${id}/x`] = Math.round(bot.x * 10) / 10;
      patch[`bots/${id}/y`] = Math.round(bot.y * 10) / 10;
      patch[`bots/${id}/radius`] = Math.round(bot.radius * 100) / 100;
      patch[`bots/${id}/vx`] = Math.round(bot.vx * 10000) / 10000;
      patch[`bots/${id}/vy`] = Math.round(bot.vy * 10000) / 10000;
      patch[`bots/${id}/turnAt`] = bot.turnAt;
    }
    if (Object.keys(patch).length) update(ref(db, `rooms/${roomId}`), patch).catch(console.warn);
  }
}

function hostMaintenance(now) {
  if (!localHost || !roomId || !roomState || now - hostLoopAt < 1200) return;
  hostLoopAt = now;

  const food = roomState.food || {};
  const missing = FOOD_TARGET - Object.keys(food).length;
  if (missing > 0) {
    const additions = makeFood(Math.min(missing, 18));
    const patch = {};
    for (const [id, item] of Object.entries(additions)) patch[`food/${id}`] = item;
    update(ref(db, `rooms/${roomId}`), patch).catch(console.warn);
  }
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
    if (x < -20 || y < -20 || x > innerWidth + 20 || y > innerHeight + 20) continue;
    ctx.beginPath();
    ctx.arc(x, y, f.r, 0, Math.PI * 2);
    ctx.fillStyle = f.color || "#fff";
    ctx.fill();
  }
}

function smoothPlayers(dt) {
  const players = roomState?.players || {};
  for (const [id, p] of Object.entries(players)) {
    let rp = renderPlayers.get(id);
    if (!rp) {
      rp = { x: p.x, y: p.y, radius: p.radius };
      renderPlayers.set(id, rp);
    }
    const target = p.uid === uid && local ? local : p;
    const t = 1 - Math.pow(0.001, dt);
    rp.x += (target.x - rp.x) * t;
    rp.y += (target.y - rp.y) * t;
    rp.radius += (target.radius - rp.radius) * t;
  }
  for (const id of renderPlayers.keys()) {
    if (!players[id]) renderPlayers.delete(id);
  }
}

function smoothBots(dt) {
  const bots = roomState?.bots || {};
  for (const [id, remote] of Object.entries(bots)) {
    if (!remote || remote.eatenBy) continue;
    const target = localHost && hostBots.has(id) ? hostBots.get(id) : remote;
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
  for (const id of renderBots.keys()) {
    if (!bots[id] || bots[id]?.eatenBy) renderBots.delete(id);
  }
}

function drawBots(cam) {
  const bots = roomState?.bots || {};
  for (const [id, bot] of Object.entries(bots)) {
    if (!bot || bot.eatenBy) continue;
    const rb = renderBots.get(id) || bot;
    const x = rb.x - cam.x;
    const y = rb.y - cam.y;
    const r = rb.radius;
    if (x < -r - 30 || y < -r - 30 || x > innerWidth + r + 30 || y > innerHeight + r + 30) continue;

    ctx.save();
    ctx.shadowColor = bot.color || "#ff5f6d";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = bot.color || "#ff5f6d";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2.5, r * 0.075);
    ctx.strokeStyle = "rgba(80, 3, 20, .72)";
    ctx.stroke();

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

    const fontSize = Math.max(10, Math.min(18, r * 0.38));
    ctx.font = `900 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(54,7,18,.88)";
    ctx.fillText(bot.name || "Enemy", x, y + r * 0.28);
    ctx.restore();
  }
}

function drawPlayers(cam) {
  const players = roomState?.players || {};
  for (const [id, p] of Object.entries(players)) {
    const rp = renderPlayers.get(id) || p;
    const x = rp.x - cam.x;
    const y = rp.y - cam.y;
    const r = rp.radius;

    ctx.save();
    ctx.shadowColor = p.color || "#fff";
    ctx.shadowBlur = p.uid === uid ? 22 : 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.color || "#fff";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, r * 0.07);
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

    const fontSize = Math.max(12, Math.min(22, r * 0.48));
    ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(8,12,25,.82)";
    ctx.fillText(p.name || "Buddy", x, y);
    ctx.restore();
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
  tickBots(dt, now);
  hostMaintenance(now);
  smoothPlayers(dt);
  smoothBots(dt);

  const cam = getCamera();
  drawGrid(cam);
  drawFood(cam);
  drawBots(cam);
  drawPlayers(cam);
  drawDirection();
  drawDeathNotice(now);
  requestAnimationFrame(frame);
}

createBtn.addEventListener("click", createRoom);
joinBtn.addEventListener("click", joinRoom);
leaveBtn.addEventListener("click", () => leaveRoom(true));
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
window.addEventListener("resize", resizeCanvas);
window.addEventListener("beforeunload", () => {
  // onDisconnect is the reliable cleanup path; this is only a best-effort hint.
  if (db && roomId && uid && localSlot !== null) remove(ref(db, `rooms/${roomId}/players/${localSlot}`)).catch(() => {});
});

resizeCanvas();
requestAnimationFrame(frame);

if (!firebaseConfigured()) {
  menuStatus.textContent = "Setup required: paste your Firebase config into app.js.";
}
