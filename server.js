const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

const io = new Server(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

// --- КОНФИГУРАЦИЯ ---
const TILE_SIZE = 30;
const MAP_WIDTH = 20;
const PLAYER_COLORS = ['#FFFF00', '#00FF00', '#BF00FF', '#0055FF'];

// Физика
const CAM_SPEED_START = 0.8;
const CAM_SPEED_MAX   = 3.0;
const CAM_ACCEL       = 0.000122; 
const PLAYER_SPEED_START = 1.6; 
const PLAYER_SPEED_MAX   = 4.0;
const GHOST_SPEED_START  = 1.5;
const GHOST_SPEED_MAX    = 3.8; 
const FRIGHT_SPEED_START = 1.0;
const FRIGHT_SPEED_MAX   = 2.0;

const POWER_MODE_DURATION = 240;
const PVP_MODE_DURATION = 300;
const DEATH_ANIMATION_FRAMES = 60;
const SPEED_BOOST_DURATION = 420; 
const SCORE_MILESTONE = 10000;    

// --- КОНФИГУРАЦИЯ БОССА ---
const BOSS_TRIGGER_SCORE = 5000; 
const BOSS_HP_MAX = 3;           
const BOSS_WIDTH = 90;           
const BOSS_HEIGHT = 90;          
const BOSS_PROJECTILE_SPEED = 3.5;
const BOSS_DASH_SPEED = 15.0;
const BOSS_RETURN_SPEED = 4.0;
const BOSS_ENTRY_SPEED = 3.0; // Скорость влета

const ROCKET_START_TIME = 10800; 
const ROCKET_WAVE_INTERVAL = 180; 
const ROCKET_WARNING_TIME = 120; 
const ROCKET_Y_OFFSET = 720; 
const SURGE_MIN_INTERVAL = 3600;
const SURGE_MAX_INTERVAL = 18000;
const SURGE_RISE_TIME = 600;
const SURGE_RETURN_TIME = 180;
const SURGE_MAX_HEIGHT = 240;

const TRAIN_MIN_PATTERNS = 10;
const TRAIN_MAX_PATTERNS = 30;
const TRAIN_YELLOW_TIME = 180; 
const TRAIN_RED_TIME = 60;     
const TRAIN_SPEED = 12.0;      
const TRAIN_LENGTH = 40;       

// --- ТАЙЛЫ ---
const TILE = { 
    EMPTY: 0, WALL: 1, DOT: 2, POWER: 3, CHERRY: 4, EVIL: 5, HEART: 6,
    STRAWBERRY: 7, ORANGE: 8, APPLE: 9, MELON: 10, GALAXIAN: 11, BELL: 12, KEY: 13,
    BOSS_ORB: 99 
};

const ITEMS_CONFIG = [
    { id: TILE.CHERRY,     weight: 1000 },
    { id: TILE.STRAWBERRY, weight: 600 },
    { id: TILE.ORANGE,     weight: 400 },
    { id: TILE.APPLE,      weight: 300 },
    { id: TILE.MELON,      weight: 200 },
    { id: TILE.GALAXIAN,   weight: 100 },
    { id: TILE.BELL,       weight: 50 },
    { id: TILE.KEY,        weight: 10 }
];

const lobbies = {};
const DATA_FILE = path.join(__dirname, 'leaderboard.json');
let globalLeaderboard = [];
let saveTimeout = null;

function loadLeaderboard() {
    try { if (fs.existsSync(DATA_FILE)) globalLeaderboard = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (err) { globalLeaderboard = []; }
}
function saveLeaderboard() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { fs.writeFile(DATA_FILE, JSON.stringify(globalLeaderboard, null, 2), (err) => {}); }, 5000);
}
function updateGlobalLeaderboard(name, score) {
    const safeName = (name || "PLAYER").substring(0, 10).toUpperCase().replace(/[<>]/g, "");
    globalLeaderboard.push({ name: safeName, score: parseInt(score) || 0 });
    globalLeaderboard.sort((a, b) => b.score - a.score);
    globalLeaderboard = globalLeaderboard.slice(0, 10);
    saveLeaderboard();
    io.emit('leaderboardUpdate', globalLeaderboard);
}
loadLeaderboard();

function makeId(length) {
    let result = ''; const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}
function lerp(start, end, t) { return start * (1 - t) + end * t; }

const PATTERNS = [
    [[1,0,0,0,0,0,0,0,0,1], [1,0,1,1,1,0,1,1,0,1], [1,0,1,1,1,0,1,1,0,1], [1,0,0,0,0,0,0,0,0,0], [1,0,1,1,1,0,1,0,1,1], [1,0,0,0,0,0,1,0,0,0], [1,0,1,1,1,0,1,1,1,0], [1,0,1,1,1,0,1,1,1,0], [1,0,0,0,0,0,0,0,0,0], [1,1,1,1,1,0,1,1,1,1]],
    [[1,0,0,0,1,0,0,0,0,0], [1,0,1,0,1,0,1,1,1,1], [1,0,1,0,1,0,0,0,0,0], [1,0,1,0,0,0,1,1,1,0], [1,0,1,1,1,0,1,3,0,0], [1,0,1,1,1,0,1,1,1,0], [1,0,0,0,0,0,0,0,0,0], [1,0,1,1,1,1,1,0,1,1], [1,0,0,0,0,0,0,0,0,1], [1,1,1,0,1,1,1,1,0,1]],
    [[1,0,0,0,0,0,0,0,0,1], [1,0,1,1,0,1,1,1,0,1], [1,0,0,0,0,0,0,0,0,0], [1,1,0,1,1,0,1,1,0,1], [1,0,0,0,0,0,0,0,0,0], [1,0,1,1,1,0,1,1,1,1], [1,0,0,3,0,0,0,0,0,1], [1,0,1,1,0,1,1,1,0,1], [1,0,0,0,0,0,0,0,0,0], [1,1,1,0,1,1,1,1,0,1]]
];

function createGame(roomId) {
    const game = {
        id: roomId, players: {}, ghosts: [], 
        cameraY: 0, gameSpeed: CAM_SPEED_START, rows: {}, 
        frightenedTimer: 0, nextGhostSpawn: -400, 
        patternRowIndex: 0, currentPattern: null, 
        isRunning: false, hostId: null, countdown: 0, startTime: 0,
        changes: { removedDots: [], newRows: {} },
        speedBoostTimer: 0, globalThreshold: 0, frameCounter: 0,
        rocketState: { nextCycle: ROCKET_START_TIME, active: false, wavesLeft: 0, nextWaveTime: 0, warnings: [], rockets: [] },
        surge: { state: 'IDLE', currentHeight: 0, nextTime: SURGE_MIN_INTERVAL + Math.floor(Math.random() * (SURGE_MAX_INTERVAL - SURGE_MIN_INTERVAL)) },
        patternsSinceTrain: 0,
        nextTrainLimit: TRAIN_MIN_PATTERNS + Math.floor(Math.random() * (TRAIN_MAX_PATTERNS - TRAIN_MIN_PATTERNS)),
        trainGapRows: 0, 
        train: { state: 'OFF', targetY: 0, timer: 0, dir: 1, ghosts: [] },
        patternFruitConfig: [],
        boss: {
            encountered: false,
            state: 'IDLE', 
            yStart: 0, yBase: 0,
            waveY: 0, // Для анимации уничтожения снизу вверх
            x: 0, y: 0,    
            vx: 1.5,
            hp: BOSS_HP_MAX,
            shootTimer: 0,
            attackState: 'SHOOT', 
            attackTimer: 0,
            projectiles: [],
            phase: 0
        }
    };
    initMap(game);
    return game;
}

function initMap(game) {
    game.rows = {};
    game.changes = { removedDots: [], newRows: {} };
    game.cameraY = 0;
    game.patternRowIndex = 0;
    game.currentPattern = null;
    game.train.state = 'OFF';
    game.patternsSinceTrain = 0;
    game.trainGapRows = 0;
    game.patternFruitConfig = [];
    game.boss.state = 'IDLE';
    game.boss.encountered = false;
    game.boss.projectiles = [];
    
    for(let y=30; y>=-50; y--) generateRow(game, y);
    for(let y=20; y<25; y++) { 
        if(!game.rows[y]) continue;
        for(let x=1; x<MAP_WIDTH-1; x++) { game.rows[y][x] = TILE.EMPTY; } 
    }
}

function resetGame(game) {
    game.isRunning = false;
    game.ghosts = [];
    game.gameSpeed = CAM_SPEED_START;
    game.frightenedTimer = 0;
    game.nextGhostSpawn = -400;
    game.speedBoostTimer = 0;
    game.globalThreshold = 0;
    game.frameCounter = 0;
    game.rocketState = { nextCycle: ROCKET_START_TIME, active: false, wavesLeft: 0, nextWaveTime: 0, warnings: [], rockets: [] };
    game.surge = { state: 'IDLE', currentHeight: 0, nextTime: SURGE_MIN_INTERVAL + Math.floor(Math.random() * (SURGE_MAX_INTERVAL - SURGE_MIN_INTERVAL)) };
    game.train = { state: 'OFF', targetY: 0, timer: 0, dir: 1, ghosts: [] };
    game.patternsSinceTrain = 0;
    game.trainGapRows = 0;
    game.nextTrainLimit = TRAIN_MIN_PATTERNS + Math.floor(Math.random() * (TRAIN_MAX_PATTERNS - TRAIN_MIN_PATTERNS));
    game.patternFruitConfig = [];
    
    game.boss = {
        encountered: false, state: 'IDLE', yStart: 0, yBase: 0, waveY: 0, x: 0, y: 0, vx: 2,
        hp: BOSS_HP_MAX, shootTimer: 0, attackState: 'SHOOT', attackTimer: 0, projectiles: [], phase: 0
    };

    const pIds = Object.keys(game.players);
    for (const pid of pIds) {
        const socketConnected = io.sockets.sockets.get(pid);
        if (!socketConnected) { delete game.players[pid]; continue; }
        const p = game.players[pid];
        p.x = (4 + p.colorIdx * 4) * TILE_SIZE;
        p.y = 22 * TILE_SIZE;
        p.vx = 0; p.vy = 0; p.nextDir = null;
        p.score = 0; 
        p.lives = 3; p.alive = true;
        p.invulnTimer = 0; p.pvpTimer = 0; p.deathTimer = 0;
        p.lastMilestone = 0;
        p.itemsCollected = {}; 
        p.stats = { ghosts: 0, players: 0, evil: 0 };
    }
    initMap(game);
}

function getWeightedFruit(game) {
    let maxScore = 0;
    Object.values(game.players).forEach(p => maxScore = Math.max(maxScore, p.score));
    let unlockedCount = Math.floor(maxScore / 700) + 1;
    if (unlockedCount > ITEMS_CONFIG.length) unlockedCount = ITEMS_CONFIG.length;
    const pool = ITEMS_CONFIG.slice(0, unlockedCount);
    let totalWeight = pool.reduce((a,b) => a + b.weight, 0);
    let rnd = Math.random() * totalWeight;
    for (let item of pool) {
        if (rnd < item.weight) return item.id;
        rnd -= item.weight;
    }
    return TILE.CHERRY;
}

// --- НОВАЯ ФУНКЦИЯ: ВОЛНА РАЗРУШЕНИЯ СНИЗУ ВВЕРХ ---
function bossWaveClear(game) {
    const destroyedTiles = [];
    const waveSpeed = 30; // Очень быстрое очищение (1 строка за тик)
    
    // waveY движется ВВЕРХ (уменьшается значение Y)
    game.boss.waveY -= waveSpeed;
    
    const currentWaveYIndex = Math.floor(game.boss.waveY / TILE_SIZE);
    // Чистим диапазон вокруг текущей волны (для надежности)
    for (let y = currentWaveYIndex; y <= currentWaveYIndex + 2; y++) {
        if (!game.rows[y]) continue;
        let rowChanged = false;
        for (let x = 1; x < MAP_WIDTH - 1; x++) { 
            if (game.rows[y][x] !== TILE.EMPTY) {
                destroyedTiles.push({ x: x * TILE_SIZE, y: y * TILE_SIZE, type: game.rows[y][x] });
                game.rows[y][x] = TILE.EMPTY;
                rowChanged = true;
            }
        }
        if (rowChanged) {
            if (!game.changes.newRows) game.changes.newRows = {};
            game.changes.newRows[y] = game.rows[y];
        }
    }
    return destroyedTiles;
}

function generateRow(game, yIndex) {
    // Если босс в активных фазах, генерируем ТОЛЬКО БОКОВЫЕ СТЕНЫ
    if (game.boss.state === 'PRE_ATTACK' || game.boss.state === 'ACTIVE' || game.boss.state === 'VULNERABLE') {
        const row = new Array(MAP_WIDTH).fill(TILE.EMPTY);
        row[0] = TILE.WALL; row[MAP_WIDTH - 1] = TILE.WALL;
        game.rows[yIndex] = row;
        if (!game.changes.newRows) game.changes.newRows = {};
        game.changes.newRows[yIndex] = row;
        cleanOldRows(game);
        return;
    }

    if (game.trainGapRows > 0) {
        const row = new Array(MAP_WIDTH).fill(TILE.EMPTY);
        row[0] = TILE.WALL; row[MAP_WIDTH - 1] = TILE.WALL;
        game.rows[yIndex] = row;
        if (!game.changes.newRows) game.changes.newRows = {};
        game.changes.newRows[yIndex] = row;
        if (game.trainGapRows === 3) {
            game.train.state = 'WAITING'; game.train.targetY = yIndex * TILE_SIZE;
            game.train.dir = Math.random() > 0.5 ? 1 : -1; game.train.ghosts = [];
        }
        game.trainGapRows--;
        cleanOldRows(game);
        return; 
    }

    if (!game.currentPattern || game.patternRowIndex >= 10) {
        game.patternsSinceTrain++;
        
        let maxScore = 0;
        Object.values(game.players).forEach(p => maxScore = Math.max(maxScore, p.score));
        
        // ТРИГГЕР БОССА - ТЕПЕРЬ ВКЛЮЧАЕТ WARNING
        if (!game.boss.encountered && maxScore >= BOSS_TRIGGER_SCORE) {
            game.boss.encountered = true;
            game.boss.state = 'WARNING'; 
            game.boss.yStart = yIndex * TILE_SIZE; 
            
            // ИЗМЕНЕНИЕ 1: Таймер ожидания 5 секунд (было 3)
            game.boss.shootTimer = 300; 
            
            // ИЗМЕНЕНИЕ 2: Звук нагнетания
            io.to(game.id).emit('sfx', 'bossBuildup');
            
            io.to(game.id).emit('popup', {x: (MAP_WIDTH*TILE_SIZE)/2 - 50, y: game.cameraY + 200, text: "WARNING!", color: "#FF0000"});
            // Продолжаем генерировать нормальные лабиринты, чтобы было что рушить
        }

        if (game.patternsSinceTrain >= game.nextTrainLimit) {
            game.trainGapRows = 5; 
            game.patternsSinceTrain = 0;
            game.nextTrainLimit = TRAIN_MIN_PATTERNS + Math.floor(Math.random() * (TRAIN_MAX_PATTERNS - TRAIN_MIN_PATTERNS));
            generateRow(game, yIndex);
            return;
        }

        game.currentPattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
        game.patternRowIndex = 0;
        game.patternFruitConfig = [];
        const itemsCount = Math.floor(Math.random() * 3);
        if (itemsCount > 0) {
            const possibleRows = Array.from({length:10},(_,i)=>i);
            for (let i=0; i<itemsCount; i++) {
                const rnd = Math.floor(Math.random() * possibleRows.length);
                game.patternFruitConfig.push(possibleRows.splice(rnd, 1)[0]);
            }
        }
    }
    
    const patternIdx = game.patternRowIndex;
    const half = game.currentPattern[9 - patternIdx];
    game.patternRowIndex++;
    const row = new Array(MAP_WIDTH);
    
    let fruitSpawnInfo = null;
    if (game.patternFruitConfig.includes(patternIdx)) {
        const validIndices = [];
        for(let k=0; k<10; k++) if (half[k] !== 1 && half[k] !== 3) validIndices.push(k);
        if (validIndices.length > 0) {
            fruitSpawnInfo = { idx: validIndices[Math.floor(Math.random() * validIndices.length)], side: Math.random() < 0.5 ? 'left' : 'right', type: getWeightedFruit(game) };
        }
    }

    function getStandardContent() {
        const r = Math.random();
        if (r < 0.0005) return TILE.EVIL; 
        if (r < 0.0025) return TILE.HEART; 
        return TILE.DOT;
    }

    for(let i = 0; i < 10; i++) { 
        let val = half[i];
        const right = 19 - i;
        if (val === 1) { row[i] = TILE.WALL; row[right] = TILE.WALL; } 
        else if (val === 3) { row[i] = TILE.POWER; row[right] = TILE.POWER; } 
        else { 
            let leftItem = getStandardContent();
            let rightItem = getStandardContent();
            if (fruitSpawnInfo && fruitSpawnInfo.idx === i) {
                if (fruitSpawnInfo.side === 'left') leftItem = fruitSpawnInfo.type;
                else rightItem = fruitSpawnInfo.type;
            }
            row[i] = leftItem; row[right] = rightItem;
        }
    }
    game.rows[yIndex] = row;
    if (!game.changes.newRows) game.changes.newRows = {};
    game.changes.newRows[yIndex] = row;
    cleanOldRows(game);
}

function cleanOldRows(game) {
    const cleanupThreshold = Math.floor(game.cameraY / TILE_SIZE) + 50;
    const keys = Object.keys(game.rows);
    if (keys.length > 150) { for (const k of keys) { if (parseInt(k) > cleanupThreshold) delete game.rows[k]; } }
}

function getTile(game, x, y) { if (!game.rows[y]) return TILE.WALL; return game.rows[y][x]; }

io.on('connection', (socket) => {
    let currentRoom = null;
    socket.emit('leaderboardUpdate', globalLeaderboard);

    socket.on('createLobby', ({ nickname }) => {
        const roomId = makeId(5);
        lobbies[roomId] = createGame(roomId);
        lobbies[roomId].hostId = socket.id;
        joinRoom(socket, roomId, nickname);
    });

    socket.on('joinLobby', ({ code, nickname }) => {
        const roomId = (code || "").toUpperCase();
        if (lobbies[roomId]) joinRoom(socket, roomId, nickname);
        else socket.emit('errorMsg', 'Lobby not found');
    });

    function joinRoom(socket, roomId, nickname) {
        const game = lobbies[roomId];
        if (game.isRunning) { socket.emit('errorMsg', 'Game already started'); return; }
        const currentPlayers = Object.values(game.players);
        const usedSlots = currentPlayers.map(p => p.colorIdx);
        let mySlot = -1;
        for(let i=0; i<4; i++) if(!usedSlots.includes(i)) { mySlot = i; break; }
        if(mySlot === -1) { socket.emit('errorMsg', 'Lobby full'); return; }
        let myColor = PLAYER_COLORS[mySlot];
        const usedColors = currentPlayers.map(p => p.color);
        if (usedColors.includes(myColor)) { for (let color of PLAYER_COLORS) { if (!usedColors.includes(color)) { myColor = color; break; } } }
        if (!myColor) myColor = PLAYER_COLORS[0];

        game.players[socket.id] = {
            id: socket.id, name: (nickname || `P${mySlot+1}`).substring(0, 10).toUpperCase().replace(/[<>]/g, ""),
            colorIdx: mySlot, color: myColor, 
            x: (4 + mySlot * 4) * TILE_SIZE, y: 22 * TILE_SIZE,
            vx: 0, vy: 0, nextDir: null, score: 0, lives: 3, alive: true, 
            invulnTimer: 0, pvpTimer: 0, deathTimer: 0,
            lastMilestone: 0, itemsCollected: {}, stats: { ghosts: 0, players: 0, evil: 0 }
        };
        currentRoom = roomId;
        socket.join(roomId);
        socket.emit('init', { id: socket.id, colorIdx: mySlot });
        socket.emit('fullMap', game.rows);
        io.to(roomId).emit('lobbyUpdate', { players: Object.values(game.players), hostId: game.hostId, roomId: roomId });
    }

    socket.on('changeColor', (colorIndex) => {
        if (currentRoom && lobbies[currentRoom] && !lobbies[currentRoom].isRunning) {
            const game = lobbies[currentRoom];
            const p = game.players[socket.id];
            const isTaken = Object.values(game.players).some(player => player.id !== socket.id && player.color === PLAYER_COLORS[colorIndex]);
            if (p && PLAYER_COLORS[colorIndex] && !isTaken) {
                p.color = PLAYER_COLORS[colorIndex];
                io.to(currentRoom).emit('lobbyUpdate', { players: Object.values(game.players), hostId: game.hostId, roomId: currentRoom });
            }
        }
    });

    socket.on('startGame', () => {
        if (currentRoom && lobbies[currentRoom] && lobbies[currentRoom].hostId === socket.id) {
            lobbies[currentRoom].isRunning = true;
            lobbies[currentRoom].countdown = 3;
            lobbies[currentRoom].startTime = Date.now();
            io.to(currentRoom).emit('fullMap', lobbies[currentRoom].rows);
            io.to(currentRoom).emit('gameStarted');
        }
    });

    socket.on('returnToLobby', () => {
        if (currentRoom && lobbies[currentRoom]) {
            const game = lobbies[currentRoom];
            resetGame(game);
            io.to(currentRoom).emit('lobbyUpdate', { players: Object.values(game.players), hostId: game.hostId, roomId: currentRoom });
        }
    });

    socket.on('input', (dir) => {
        if (currentRoom && lobbies[currentRoom]) {
            const p = lobbies[currentRoom].players[socket.id];
            if (p && p.alive && p.deathTimer === 0) p.nextDir = dir;
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && lobbies[currentRoom]) {
            const game = lobbies[currentRoom];
            if (socket.id === game.hostId) {
                delete lobbies[currentRoom];
                io.to(currentRoom).emit('roomClosed');
            } else {
                if (game.isRunning) {
                    if(game.players[socket.id]) { game.players[socket.id].alive = false; game.players[socket.id].lives = 0; }
                } else {
                    delete game.players[socket.id];
                    io.to(currentRoom).emit('lobbyUpdate', { players: Object.values(game.players), hostId: game.hostId, roomId: currentRoom });
                }
            }
        }
    });
});

let tickCount = 0;

setInterval(() => {
    tickCount++;
    const roomIds = Object.keys(lobbies);
    for (const roomId of roomIds) {
        const game = lobbies[roomId];
        if (!game || !game.isRunning) continue;
        
        if (game.countdown > -1) game.countdown -= 1/60;
        
        if (game.countdown > 0) {
            if (tickCount % 2 === 0) {
                io.to(roomId).emit('state', { 
                    t: Date.now(), cd: game.countdown, players: game.players, camY: game.cameraY, 
                    rockets: [], warnings: [], ghosts: [], surgeHeight: 0, train: game.train, boss: game.boss
                });
            }
            continue;
        }
        
        updateGamePhysics(game);

        if (tickCount % 2 === 0) {
            const fastPlayers = {};
            const pIds = Object.keys(game.players);
            for(const pid of pIds) {
                const p = game.players[pid];
                fastPlayers[pid] = {
                    id: p.id, name: p.name, colorIdx: p.colorIdx, color: p.color,
                    score: p.score, lives: p.lives, alive: p.alive,
                    x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100,
                    vx: p.vx, vy: p.vy,
                    deathTimer: p.deathTimer, invulnTimer: p.invulnTimer, pvpTimer: p.pvpTimer
                };
            }
            const fastGhosts = game.ghosts.map(g => ({
                x: Math.round(g.x), y: Math.round(g.y),
                color: g.color, vx: g.vx, vy: g.vy, dead: g.dead
            }));
            
            const trainData = { state: game.train.state, targetY: game.train.targetY, ghosts: game.train.ghosts.map(g => ({ x: Math.round(g.x), y: Math.round(g.y), color: g.color, vx: g.vx })) };
            const bossProj = game.boss.projectiles.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), type: p.type }));

            const s = { 
                t: Date.now(), cd: game.countdown, camY: Math.round(game.cameraY * 100) / 100, 
                players: fastPlayers, ghosts: fastGhosts, 
                ft: game.frightenedTimer, st: game.startTime, 
                changes: game.changes, sbt: game.speedBoostTimer,
                rockets: game.rocketState.rockets, warnings: game.rocketState.warnings,
                surgeHeight: Math.round(game.surge.currentHeight),
                train: trainData,
                boss: { state: game.boss.state, x: Math.round(game.boss.x), y: Math.round(game.boss.y), hp: game.boss.hp, projectiles: bossProj, attackState: game.boss.attackState }
            };
            io.to(roomId).emit('state', s);
            game.changes = { removedDots: [], newRows: {} };
        }
    }
}, 1000 / 60);

function handleBossLogic(game) {
    if (game.boss.state === 'IDLE' || game.boss.state === 'DEFEATED') return;

    // --- 1. ПРЕДУПРЕЖДЕНИЕ (ТРЯСКА) ---
    if (game.boss.state === 'WARNING') {
        game.boss.shootTimer--; // Используем это как общий таймер
        if (game.boss.shootTimer <= 0) {
            game.boss.state = 'ENTERING';
            // Спавним босса для влета
            game.boss.x = (MAP_WIDTH * TILE_SIZE) / 2 - BOSS_WIDTH / 2;
            game.boss.y = game.cameraY - 200; 
            // Точка старта волны уничтожения (с самого низа экрана)
            game.boss.waveY = game.cameraY + 900;
            
            io.to(game.id).emit('sfx', 'bossEntry'); 
            io.to(game.id).emit('music', 'startBoss'); 
            io.to(game.id).emit('popup', {x: game.boss.x, y: game.boss.y + 300, text: "INCOMING!", color: "#FF0000"});
        }
    }

    // --- 2. ВЛЕТ БОССА + ОЧИСТКА ВОЛНОЙ ---
    else if (game.boss.state === 'ENTERING') {
        // Привидения убегают
        for (let g of game.ghosts) { g.vy = 10; g.vx = 0; }
        
        // Босс летит вниз
        game.boss.y += BOSS_ENTRY_SPEED;
        
        // Волна уничтожения идет снизу вверх
        const debris = bossWaveClear(game);
        if (debris.length > 0) {
            if (game.frameCounter % 4 === 0) io.to(game.id).emit('sfx', 'destroy');
            io.to(game.id).emit('debris', debris);
        }

        game.cameraY -= CAM_SPEED_START; 

        // Босс занял позицию?
        if (game.boss.y >= game.cameraY + 50) {
            game.boss.state = 'PRE_ATTACK';
            game.boss.yBase = game.boss.y;
            game.boss.hp = BOSS_HP_MAX;
            game.boss.attackState = 'WAIT';
            
            // ИЗМЕНЕНИЕ 3: Таймер перед стрельбой теперь 1 секунда (было 2)
            game.boss.shootTimer = 60; 
            
            game.ghosts = []; 
            io.to(game.id).emit('popup', {x: game.boss.x, y: game.boss.y + 300, text: "READY?", color: "#FFFF00"});
        }
    } 
    // --- 3. ЗАДЕРЖКА ПЕРЕД АТАКОЙ ---
    else if (game.boss.state === 'PRE_ATTACK') {
        game.gameSpeed = 0;
        
        // ИЗМЕНЕНИЕ 4: Босс может двигаться пока ждет
        game.boss.x += game.boss.vx;
        if (game.boss.x <= TILE_SIZE || game.boss.x + BOSS_WIDTH >= (MAP_WIDTH - 1) * TILE_SIZE) { game.boss.vx *= -1; }
        
        game.boss.shootTimer--;
        if (game.boss.shootTimer <= 0) {
            game.boss.state = 'ACTIVE';
            game.boss.attackState = 'SHOOT';
            game.boss.shootTimer = 180;
            io.to(game.id).emit('popup', {x: game.boss.x, y: game.boss.y + 300, text: "FIGHT!", color: "#FF0000"});
        }
        checkBossBodyCollision(game);
    }
    // --- 4. АКТИВНАЯ ФАЗА ---
    else if (game.boss.state === 'ACTIVE') {
        game.gameSpeed = 0;
        checkBossBodyCollision(game);

        if (game.boss.attackState === 'SHOOT') {
            game.boss.x += game.boss.vx;
            if (game.boss.x <= TILE_SIZE || game.boss.x + BOSS_WIDTH >= (MAP_WIDTH - 1) * TILE_SIZE) { game.boss.vx *= -1; }
            game.boss.shootTimer--;
            if (game.boss.shootTimer <= 0) {
                game.boss.attackState = 'CHARGE'; game.boss.attackTimer = 120; 
                io.to(game.id).emit('popup', {x: game.boss.x, y: game.boss.y + 100, text: "WARNING!", color: "#FFFF00"});
                io.to(game.id).emit('sfx', 'bossCharge');
            }
            if (game.frameCounter % 60 === 0) { 
                const typeRoll = Math.random(); let pType = 'harmful'; 
                if (typeRoll > 0.6) pType = 'edible'; if (typeRoll > 0.8) pType = 'orb';    
                game.boss.projectiles.push({ x: game.boss.x + BOSS_WIDTH / 2 - 15, y: game.boss.y + BOSS_HEIGHT, vx: (Math.random() - 0.5) * 3, vy: BOSS_PROJECTILE_SPEED, type: pType });
                io.to(game.id).emit('sfx', 'rocket');
            }
        }
        else if (game.boss.attackState === 'CHARGE') {
            game.boss.attackTimer--;
            if (game.boss.attackTimer <= 0) { game.boss.attackState = 'DASH'; io.to(game.id).emit('sfx', 'bossDash'); }
        }
        else if (game.boss.attackState === 'DASH') {
            game.boss.y += BOSS_DASH_SPEED;
            if (game.boss.y > game.cameraY + 1000) { game.boss.attackState = 'RETURN'; game.boss.y = game.cameraY - 300; }
            checkBossCollision(game, true); 
        }
        else if (game.boss.attackState === 'RETURN') {
            game.boss.y += BOSS_RETURN_SPEED;
            if (game.boss.y >= game.boss.yBase) { game.boss.y = game.boss.yBase; game.boss.attackState = 'SHOOT'; game.boss.shootTimer = 300; }
        }
    } 
    // --- 5. УЯЗВИМОСТЬ ---
    else if (game.boss.state === 'VULNERABLE') {
        game.gameSpeed = 0;
        game.boss.x += (Math.random() - 0.5) * 4; 
        checkBossCollision(game, false); 
    }

    // Обновление снарядов
    for (let i = game.boss.projectiles.length - 1; i >= 0; i--) {
        const p = game.boss.projectiles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.y > game.cameraY + 900) { game.boss.projectiles.splice(i, 1); continue; }
        const pIds = Object.keys(game.players);
        for (const pid of pIds) {
            const pl = game.players[pid];
            if (!pl.alive || pl.deathTimer > 0) continue;
            if (Math.abs(pl.x - p.x) < 20 && Math.abs(pl.y - p.y) < 20) {
                if (p.type === 'harmful') { if (pl.invulnTimer <= 0) loseLife(game, pl); } 
                else if (p.type === 'edible') {
                    pl.score += 200; game.boss.projectiles.splice(i, 1);
                    io.to(game.id).emit('sfx', 'eatGhost'); io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "+200", color: "#AAF"}); break;
                } else if (p.type === 'orb') {
                    game.boss.hp--; pl.score += 500; game.boss.projectiles.splice(i, 1); io.to(game.id).emit('sfx', 'power');
                    if (game.boss.hp <= 0) {
                        game.boss.state = 'VULNERABLE';
                        io.to(game.id).emit('music', 'scared'); 
                        io.to(game.id).emit('popup', {x: game.boss.x, y: game.boss.y + 100, text: "ATTACK BOSS!", color: "#FFFF00"});
                    } else { io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "HIT!", color: "#FFF"}); }
                    break;
                }
            }
        }
    }

    if (game.boss.state === 'VULNERABLE') {
        const pIds = Object.keys(game.players);
        for (const pid of pIds) {
            const pl = game.players[pid];
            if (!pl.alive) continue;
            if (pl.x > game.boss.x && pl.x < game.boss.x + BOSS_WIDTH && pl.y > game.boss.y && pl.y < game.boss.y + BOSS_HEIGHT) {
                pl.score += 5000;
                game.boss.state = 'DEFEATED';
                game.boss.projectiles = []; 
                
                // ИЗМЕНЕНИЕ 5: Эффект страха для всех привидений
                game.frightenedTimer = POWER_MODE_DURATION;
                
                io.to(game.id).emit('sfx', 'eatGhost');
                io.to(game.id).emit('music', 'victory'); 
                io.to(game.id).emit('popup', {x: game.boss.x, y: game.boss.y, text: "BOSS DEFEATED +5000", color: "#FFD700"});
                
                setTimeout(() => {
                    game.gameSpeed = CAM_SPEED_START;
                    game.currentPattern = null; 
                    game.boss.state = 'IDLE'; 
                }, 3000);
            }
        }
    }
}

function checkBossBodyCollision(game) {
    const pIds = Object.keys(game.players);
    for (const pid of pIds) {
        const pl = game.players[pid];
        if (!pl.alive || pl.invulnTimer > 0) continue;
        if (pl.x > game.boss.x && pl.x < game.boss.x + BOSS_WIDTH &&
            pl.y > game.boss.y && pl.y < game.boss.y + BOSS_HEIGHT) {
            loseLife(game, pl);
        }
    }
}

function checkBossCollision(game, lethal) {
    const pIds = Object.keys(game.players);
    for (const pid of pIds) {
        const pl = game.players[pid];
        if (!pl.alive) continue;
        if (pl.x > game.boss.x && pl.x < game.boss.x + BOSS_WIDTH && pl.y > game.boss.y && pl.y < game.boss.y + BOSS_HEIGHT) {
            if (lethal) { if (pl.invulnTimer <= 0) loseLife(game, pl); } 
            else {
                pl.score += 5000;
                game.boss.state = 'DEFEATED';
                game.boss.projectiles = []; 
                
                // ИЗМЕНЕНИЕ 5: Эффект страха для всех привидений
                game.frightenedTimer = POWER_MODE_DURATION;

                io.to(game.id).emit('sfx', 'eatGhost');
                io.to(game.id).emit('music', 'victory');
                io.to(game.id).emit('popup', {x: game.boss.x, y: game.boss.y, text: "BOSS DEFEATED +5000", color: "#FFD700"});
                
                setTimeout(() => {
                    game.gameSpeed = CAM_SPEED_START;
                    game.currentPattern = null; 
                    game.boss.state = 'IDLE'; 
                }, 2000);
            }
        }
    }
}

// ... Rocket/Surge/Train Logic ...
function handleRocketLogic(game) { const rs = game.rocketState; const fc = game.frameCounter; if (!rs.active && fc >= rs.nextCycle) { if (game.surge.state !== 'IDLE') { rs.nextCycle = fc + 120; return; } rs.active = true; rs.wavesLeft = 3; rs.nextWaveTime = fc; } if (rs.active) { if (rs.wavesLeft > 0 && fc >= rs.nextWaveTime) { rs.wavesLeft--; rs.nextWaveTime = fc + ROCKET_WAVE_INTERVAL; const patterns = ['CENTER', 'SIDES', 'LEFT', 'RIGHT', 'SYMMETRY']; const pat = patterns[Math.floor(Math.random() * patterns.length)]; let cols = []; if (pat === 'CENTER') cols = [8,9,10,11]; else if (pat === 'LEFT') cols = [2,3,4,5]; else if (pat === 'RIGHT') cols = [14,15,16,17]; else if (pat === 'SIDES') cols = [2,3,16,17]; else if (pat === 'SYMMETRY') cols = [5,6,13,14]; cols.forEach(col => { rs.warnings.push({ x: col * TILE_SIZE, y: game.cameraY + ROCKET_Y_OFFSET, timer: ROCKET_WARNING_TIME }); }); io.to(game.id).emit('sfx', 'warning'); } else if (rs.wavesLeft === 0 && rs.warnings.length === 0 && rs.rockets.length === 0) { rs.active = false; rs.nextCycle = fc + 1800 + Math.floor(Math.random() * 5400); } } const gColors = ['red','pink','cyan','orange']; for (let i = rs.warnings.length - 1; i >= 0; i--) { let w = rs.warnings[i]; w.y = game.cameraY + ROCKET_Y_OFFSET; w.timer--; if (w.timer <= 0) { rs.rockets.push({ x: w.x, y: game.cameraY + 950, vx: 0, vy: -PLAYER_SPEED_MAX * 2, color: gColors[Math.floor(Math.random()*4)] }); rs.warnings.splice(i, 1); if (i === 0) io.to(game.id).emit('sfx', 'rocket'); } } for (let i = rs.rockets.length - 1; i >= 0; i--) { let r = rs.rockets[i]; r.y += r.vy; if (r.y < game.cameraY - 200) { rs.rockets.splice(i, 1); continue; } const pIds = Object.keys(game.players); for (const pid of pIds) { const p = game.players[pid]; if (p.alive && p.deathTimer === 0 && p.invulnTimer <= 0 && Math.abs(p.x - r.x) < 20 && Math.abs(p.y - r.y) < 20) loseLife(game, p); } } }
function handleSurgeLogic(game) { const s = game.surge; const fc = game.frameCounter; if (s.state === 'IDLE') { if (fc >= s.nextTime) { if (game.rocketState.active) { s.nextTime = fc + 120; return; } s.state = 'RISING'; io.to(game.id).emit('sfx', 'warning'); } } else if (s.state === 'RISING') { const riseSpeed = SURGE_MAX_HEIGHT / SURGE_RISE_TIME; s.currentHeight += riseSpeed; if (s.currentHeight >= SURGE_MAX_HEIGHT) { s.currentHeight = SURGE_MAX_HEIGHT; s.state = 'RETURNING'; } } else if (s.state === 'RETURNING') { const returnSpeed = SURGE_MAX_HEIGHT / SURGE_RETURN_TIME; s.currentHeight -= returnSpeed; if (s.currentHeight <= 0) { s.currentHeight = 0; s.state = 'IDLE'; s.nextTime = fc + SURGE_MIN_INTERVAL + Math.floor(Math.random() * (SURGE_MAX_INTERVAL - SURGE_MIN_INTERVAL)); } } }
function handleTrainLogic(game) { const t = game.train; if (t.state === 'OFF') return; const screenY = t.targetY - game.cameraY; if (t.state === 'WAITING') { if (screenY > 100 && screenY < 900) { t.state = 'YELLOW'; t.timer = TRAIN_YELLOW_TIME; io.to(game.id).emit('sfx', 'trainBell'); } } else if (t.state === 'YELLOW') { t.timer--; if (t.timer <= 0) { t.state = 'RED'; t.timer = TRAIN_RED_TIME; } } else if (t.state === 'RED') { t.timer--; if (t.timer <= 0) { t.state = 'CROSSING'; const ghostCount = TRAIN_LENGTH; const colors = ['red','pink','cyan','orange']; const startX = t.dir === 1 ? -150 : (MAP_WIDTH * TILE_SIZE + 150); const offsets = [-TILE_SIZE, 0, TILE_SIZE]; for (let rowOffset of offsets) { const yPos = t.targetY + rowOffset; for(let i=0; i<ghostCount; i++) { t.ghosts.push({ x: startX - (i * 35 * t.dir), y: yPos, color: colors[(i + Math.abs(rowOffset)) % 4], vx: t.dir * TRAIN_SPEED }); } } io.to(game.id).emit('sfx', 'trainRumble'); } } else if (t.state === 'CROSSING') { let stillActive = false; const limit = MAP_WIDTH * TILE_SIZE + 300; for (let g of t.ghosts) { g.x += g.vx; if (t.dir === 1 && g.x < limit) stillActive = true; if (t.dir === -1 && g.x > -300) stillActive = true; const pIds = Object.keys(game.players); for (const pid of pIds) { const p = game.players[pid]; if (p.alive && p.deathTimer === 0 && p.invulnTimer <= 0 && Math.abs(p.x - g.x) < 25 && Math.abs(p.y - g.y) < 25) loseLife(game, p); } } if (!stillActive) { t.state = 'OFF'; t.ghosts = []; } } }

function updateGamePhysics(game) {
    const pIds = Object.keys(game.players);
    const anyAlive = pIds.some(id => game.players[id].alive);
    if (!anyAlive) return;

    game.frameCounter++;
    let playerSpeedMult = 1.0; let ghostSpeedMult = 1.0;
    if (game.speedBoostTimer > 0) { game.speedBoostTimer--; playerSpeedMult = 1.5; ghostSpeedMult = 0.5; }
    if(game.gameSpeed < CAM_SPEED_MAX) game.gameSpeed += CAM_ACCEL;
    
    handleBossLogic(game);
    if (game.boss.state !== 'ACTIVE' && game.boss.state !== 'VULNERABLE' && game.boss.state !== 'PRE_ATTACK') { 
        game.cameraY -= game.gameSpeed * playerSpeedMult; 
    }
    
    handleRocketLogic(game); handleSurgeLogic(game); handleTrainLogic(game);

    let ratio = (game.gameSpeed - CAM_SPEED_START) / (CAM_SPEED_MAX - CAM_SPEED_START);
    if (ratio < 0) ratio = 0; if (ratio > 1) ratio = 1;
    const pSpeed = lerp(PLAYER_SPEED_START, PLAYER_SPEED_MAX, ratio) * playerSpeedMult;
    const gSpeed = lerp(GHOST_SPEED_START, GHOST_SPEED_MAX, ratio) * ghostSpeedMult;
    const fSpeed = lerp(FRIGHT_SPEED_START, FRIGHT_SPEED_MAX, ratio) * ghostSpeedMult;

    const topRow = Math.floor(game.cameraY / TILE_SIZE) - 5;
    if(!game.rows[topRow]) generateRow(game, topRow);
    if(game.frightenedTimer > 0) game.frightenedTimer--;
    const deathY = (game.cameraY + 800) - game.surge.currentHeight;

    for (const id of pIds) {
        let p = game.players[id];
        if(!p.alive) continue;
        if (p.deathTimer > 0) { p.deathTimer--; if (p.deathTimer === 0) finalizeDeath(game, p); continue; }
        if(p.invulnTimer > 0) p.invulnTimer--; if(p.pvpTimer > 0) p.pvpTimer--;

        const myMilestone = Math.floor(p.score / SCORE_MILESTONE);
        if (myMilestone > game.globalThreshold) {
            game.globalThreshold = myMilestone; game.speedBoostTimer = SPEED_BOOST_DURATION; p.invulnTimer = SPEED_BOOST_DURATION; 
            io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "HYPER SPEED!", color: "#FFFF00"}); io.to(game.id).emit('sfx', 'power');
        }
        if (myMilestone > p.lastMilestone) {
            p.lastMilestone = myMilestone; if (p.lives < 3) { p.lives++; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "1UP!", color: "#FF69B4"}); io.to(game.id).emit('sfx', 'eatFruit'); }
        }

        const gx = Math.round(p.x / TILE_SIZE), gy = Math.round(p.y / TILE_SIZE);
        const px = gx * TILE_SIZE, py = gy * TILE_SIZE;
        let spd = pSpeed; if (p.pvpTimer > 0) spd *= 1.3;
        const moveStep = spd; const distSq = (p.x - px)**2 + (p.y - py)**2;
        
        if (distSq <= moveStep * moveStep) {
            if (p.nextDir && getTile(game, gx + p.nextDir.x, gy + p.nextDir.y) !== TILE.WALL) { p.x = px; p.y = py; p.vx = p.nextDir.x * spd; p.vy = p.nextDir.y * spd; p.nextDir = null; }
            if (getTile(game, gx + Math.sign(p.vx), gy + Math.sign(p.vy)) === TILE.WALL) { p.vx = 0; p.vy = 0; p.x = px; p.y = py; }
        }
        if (p.vx !== 0) p.vx = Math.sign(p.vx) * spd; if (p.vy !== 0) p.vy = Math.sign(p.vy) * spd;
        p.x += p.vx; p.y += p.vy;
        
        const tile = getTile(game, gx, gy);
        if(tile > TILE.WALL) {
            game.rows[gy][gx] = TILE.EMPTY;
            if(!game.changes.removedDots) game.changes.removedDots = [];
            game.changes.removedDots.push({x: gx, y: gy});
            const collectItem = (type, points, color, popupText) => { p.score += points; p.itemsCollected[type] = (p.itemsCollected[type] || 0) + 1; if (popupText) io.to(game.id).emit('popup', {x: p.x, y: p.y, text: popupText, color: color}); io.to(game.id).emit('sfx', 'eatFruit'); };
            if(tile === TILE.DOT) { p.score += 10; }
            else if(tile === TILE.POWER) { p.score += 50; game.frightenedTimer = POWER_MODE_DURATION; io.to(game.id).emit('sfx', 'power'); }
            else if(tile === TILE.CHERRY) collectItem(TILE.CHERRY, 100, "#FFFFFF", "+100");
            else if(tile === TILE.STRAWBERRY) collectItem(TILE.STRAWBERRY, 200, "#FFFFFF", "+200");
            else if(tile === TILE.ORANGE) collectItem(TILE.ORANGE, 300, "#FFFFFF", "+300");
            else if(tile === TILE.APPLE) collectItem(TILE.APPLE, 400, "#FFFFFF", "+400");
            else if(tile === TILE.MELON) collectItem(TILE.MELON, 500, "#FFFFFF", "+500");
            else if(tile === TILE.GALAXIAN) collectItem(TILE.GALAXIAN, 800, "#FFFFFF", "+800");
            else if(tile === TILE.BELL) collectItem(TILE.BELL, 1000, "#FFFFFF", "+1000");
            else if(tile === TILE.KEY) collectItem(TILE.KEY, 1500, "#FFFFFF", "+1500");
            else if(tile === TILE.EVIL) { p.pvpTimer = PVP_MODE_DURATION; p.stats.evil++; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "EVIL MODE!", color: "#FF0000"}); io.to(game.id).emit('sfx', 'power'); }
            else if(tile === TILE.HEART) { if (p.lives < 3) { p.lives++; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "1UP!", color: "#FF69B4"}); } else { p.score += 100; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "+100", color: "#FFF"}); } io.to(game.id).emit('sfx', 'eatFruit'); }
        }
        if(p.y > deathY) loseLife(game, p);
    }

    for (let i = 0; i < pIds.length; i++) {
        for (let j = i + 1; j < pIds.length; j++) {
            const p1 = game.players[pIds[i]], p2 = game.players[pIds[j]];
            if (!p1 || !p2) continue;
            if (p1.alive && p2.alive && p1.deathTimer === 0 && p2.deathTimer === 0) {
                if (Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2) < TILE_SIZE) {
                    if (p1.pvpTimer > 0 && p2.invulnTimer <= 0) { p1.score += p2.score; p2.score = 0; p1.stats.players++; io.to(game.id).emit('popup', {x: p1.x, y: p1.y, text: "ATE PLAYER!"}); loseLife(game, p2); }
                    else if (p2.pvpTimer > 0 && p1.invulnTimer <= 0) { p2.score += p1.score; p1.score = 0; p2.stats.players++; io.to(game.id).emit('popup', {x: p2.x, y: p2.y, text: "ATE PLAYER!"}); loseLife(game, p1); }
                }
            }
        }
    }

    if (game.boss.state === 'IDLE' && game.cameraY < game.nextGhostSpawn) {
        let sx, sy, tries=0; 
        do { sx = Math.floor(Math.random()*(MAP_WIDTH-4)+2)*TILE_SIZE; sy = (Math.floor(game.cameraY/TILE_SIZE)-2)*TILE_SIZE; tries++; } while (getTile(game, sx/TILE_SIZE, sy/TILE_SIZE)===TILE.WALL && tries<10);
        game.ghosts.push({ x: sx, y: sy, vx: 0, vy: 0, lastDir: {x:0,y:0}, dead: false, color: ['red','pink','cyan','orange'][Math.floor(Math.random()*4)] });
        game.nextGhostSpawn -= 500;
    }

    game.ghosts.forEach(g => {
        const speed = game.frightenedTimer > 0 ? fSpeed : gSpeed;
        const gx = Math.round(g.x / TILE_SIZE), gy = Math.round(g.y / TILE_SIZE), px = gx * TILE_SIZE, py = gy * TILE_SIZE;
        const stuck = (g.vx===0 && g.vy===0), atCenter = (Math.abs(g.x-px) <= speed/2 && Math.abs(g.y-py) <= speed/2);
        if (stuck || atCenter) {
            if(!stuck) { g.x = px; g.y = py; }
            let target = null, minDist = Infinity;
            const pIds = Object.keys(game.players);
            for(const pid of pIds) { const pl = game.players[pid]; if(pl.alive && pl.deathTimer === 0) { let d = (pl.x-g.x)**2 + (pl.y-g.y)**2; if(d < minDist) { minDist = d; target = pl; } } }
            const dirs = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
            let valid = dirs.filter(d => getTile(game, gx+d.x, gy+d.y) !== TILE.WALL);
            if (!stuck && valid.length > 1) { const bx = -Math.sign(g.lastDir.x||g.vx), by = -Math.sign(g.lastDir.y||g.vy); const noBack = valid.filter(d => d.x!==bx || d.y!==by); if(noBack.length > 0) valid = noBack; }
            if (valid.length > 0) {
                if (target) {
                    valid.sort((a, b) => { const da = ((gx+a.x)*TILE_SIZE-target.x)**2 + ((gy+a.y)*TILE_SIZE-target.y)**2; const db = ((gx+b.x)*TILE_SIZE-target.x)**2 + ((gy+b.y)*TILE_SIZE-target.y)**2; return game.frightenedTimer > 0 ? db - da : da - db; });
                } else valid.sort(()=>Math.random()-0.5);
                const best = valid[0]; g.vx = best.x * speed; g.vy = best.y * speed; g.lastDir = {x: best.x, y: best.y};
            } else { g.vx = 0; g.vy = 0; }
        }
        let allowMove = true;
        if (['YELLOW', 'RED', 'CROSSING'].includes(game.train.state)) {
            const nextY = g.y + g.vy; const safeDistance = 60; 
            if (Math.abs(nextY - game.train.targetY) < safeDistance) allowMove = false;
        }
        if (allowMove) { g.x += g.vx; g.y += g.vy; }
        
        const pIds = Object.keys(game.players);
        for(const pid of pIds) {
            const p = game.players[pid];
            if(p.alive && p.deathTimer === 0 && Math.abs(p.x-g.x)<20 && Math.abs(p.y-g.y)<20) {
                if(game.frightenedTimer > 0) { p.score += 200; p.stats.ghosts++; g.dead = true; io.to(game.id).emit('sfx', 'eatGhost'); io.to(game.id).emit('popup', {x: g.x, y: g.y, text: "+200"}); }
                else if(p.invulnTimer <= 0) loseLife(game, p);
            }
        }
    });
    game.ghosts = game.ghosts.filter(g => !g.dead && g.y < game.cameraY + 900);
}

function loseLife(game, p) {
    if (p.deathTimer > 0) return; 
    p.deathTimer = DEATH_ANIMATION_FRAMES; p.vx = 0; p.vy = 0; io.to(game.id).emit('sfx', 'death');
}

function finalizeDeath(game, p) {
    p.lives--;
    if(p.lives > 0) {
        let spawnFound = false, attempts = 0;
        while (!spawnFound && attempts < 50) {
            attempts++;
            const rx = Math.floor(Math.random() * 16) + 2; 
            const ry = Math.floor((game.cameraY + 200 + Math.random() * 400) / TILE_SIZE);
            if (getTile(game, rx, ry) !== TILE.WALL) {
                const px = rx * TILE_SIZE; const py = ry * TILE_SIZE; let safe = true;
                for (let g of game.ghosts) { const dist = Math.sqrt(Math.pow(g.x - px, 2) + Math.pow(g.y - py, 2)); if (dist < 3 * TILE_SIZE) { safe = false; break; } }
                if (safe) { p.x = px; p.y = py; spawnFound = true; }
            }
        }
        if (!spawnFound) { const cy = Math.floor((game.cameraY + 400) / TILE_SIZE); let foundX = 10; for(let x=2; x<MAP_WIDTH-2; x++) if(getTile(game, x, cy) !== TILE.WALL) { foundX = x; break; } p.x = foundX * TILE_SIZE; p.y = cy * TILE_SIZE; }
        p.vx = 0; p.vy = 0; p.invulnTimer = 120; p.pvpTimer = 0; p.deathTimer = 0; 
        game.gameSpeed = Math.max(CAM_SPEED_START, game.gameSpeed * 0.7);
    } else { 
        p.alive = false; 
        updateGlobalLeaderboard(p.name, p.score);
        const matchResults = Object.values(game.players).sort((a,b) => b.score - a.score);
        const anyAlive = Object.values(game.players).some(pl => pl.alive);
        const allDead = !anyAlive;
        
        io.to(p.id).emit('gameOver', { score: p.score, stats: p.stats, items: p.itemsCollected, leaderboard: matchResults.map(pl => ({name: pl.name, score: pl.score, color: pl.color, alive: pl.alive})), allDead: allDead });
        if (allDead) io.to(game.id).emit('matchEnded');
    }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));