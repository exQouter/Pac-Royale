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
const COLORS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF'];

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

const SPEED_BOOST_DURATION = 420; // 7 секунд
const SCORE_MILESTONE = 10000;    

// --- ROCKET SETTINGS ---
const ROCKET_START_TIME = 10800; // 3 минуты
const ROCKET_WAVE_INTERVAL = 180; // 3 сек между волнами
const ROCKET_WARNING_TIME = 120; // 2 сек предупреждение
const ROCKET_Y_OFFSET = 720; 

const TILE = { EMPTY: 0, WALL: 1, DOT: 2, POWER: 3, CHERRY: 4, EVIL: 5, HEART: 6 };

const lobbies = {};

// --- ЛИДЕРБОРД ---
const DATA_FILE = path.join(__dirname, 'leaderboard.json');
let globalLeaderboard = [];
let saveTimeout = null;

function loadLeaderboard() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            globalLeaderboard = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (err) { globalLeaderboard = []; }
}

function saveLeaderboard() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        fs.writeFile(DATA_FILE, JSON.stringify(globalLeaderboard, null, 2), (err) => {
            if (err) console.error('Save error:', err);
        });
    }, 5000);
}

function updateGlobalLeaderboard(name, score) {
    const safeName = (name || "PLAYER").substring(0, 10).toUpperCase();
    globalLeaderboard.push({ name: safeName, score: parseInt(score) || 0 });
    globalLeaderboard.sort((a, b) => b.score - a.score);
    globalLeaderboard = globalLeaderboard.slice(0, 10);
    saveLeaderboard();
    io.emit('leaderboardUpdate', globalLeaderboard);
}

loadLeaderboard();

function makeId(length) {
    let result = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

function lerp(start, end, t) { return start * (1 - t) + end * t; }

// --- ПАТТЕРНЫ ---
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
        speedBoostTimer: 0,
        globalThreshold: 0,
        frameCounter: 0,
        rocketState: {
            nextCycle: ROCKET_START_TIME,
            active: false,
            wavesLeft: 0,
            nextWaveTime: 0,
            warnings: [],
            rockets: []
        }
    };
    for(let y=30; y>=-50; y--) generateRow(game, y);
    for(let y=20; y<25; y++) { for(let x=1; x<MAP_WIDTH-1; x++) { if(!game.rows[y]) game.rows[y]=[]; game.rows[y][x] = TILE.EMPTY; } }
    game.changes.newRows = {}; 
    return game;
}

function generateRow(game, yIndex) {
    if (!game.currentPattern || game.patternRowIndex >= 10) {
        game.currentPattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
        game.patternRowIndex = 0;
    }
    const half = game.currentPattern[9 - game.patternRowIndex];
    game.patternRowIndex++;
    const row = new Array(MAP_WIDTH);

    function getContent() {
        const r = Math.random();
        if (r < 0.0005) return TILE.EVIL; else if (r < 0.0020) return TILE.HEART; else if (r < 0.0070) return TILE.CHERRY; return TILE.DOT;
    }

    for(let i = 0; i < 10; i++) { 
        const val = half[i], right = 19 - i;
        if (val === 1) { row[i] = TILE.WALL; row[right] = TILE.WALL; } 
        else if (val === 3) { row[i] = TILE.POWER; row[right] = TILE.POWER; } 
        else { row[i] = getContent(); row[right] = getContent(); }
    }
    game.rows[yIndex] = row;
    game.changes.newRows[yIndex] = row;

    const cleanupThreshold = Math.floor(game.cameraY / TILE_SIZE) + 45;
    for (let k in game.rows) { if (parseInt(k) > cleanupThreshold) delete game.rows[k]; }
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
        
        const usedIdx = Object.values(game.players).map(p => p.colorIdx);
        let myIdx = -1;
        for(let i=0; i<4; i++) if(!usedIdx.includes(i)) { myIdx = i; break; }
        
        if(myIdx === -1) { socket.emit('errorMsg', 'Lobby full'); return; }
        
        game.players[socket.id] = {
            id: socket.id, name: (nickname || `P${myIdx+1}`).substring(0, 10).toUpperCase(),
            colorIdx: myIdx, color: COLORS[myIdx], 
            x: (4 + myIdx * 4) * TILE_SIZE, y: 22 * TILE_SIZE,
            vx: 0, vy: 0, nextDir: null, score: 0, lives: 3, alive: true, 
            invulnTimer: 0, pvpTimer: 0, deathTimer: 0,
            stats: { cherries: 0, ghosts: 0, players: 0, evil: 0 }
        };
        currentRoom = roomId;
        socket.join(roomId);
        socket.emit('init', { id: socket.id, colorIdx: myIdx });
        socket.emit('fullMap', game.rows);
        io.to(roomId).emit('lobbyUpdate', { players: Object.values(game.players), hostId: game.hostId, roomId: roomId });
    }

    socket.on('startGame', () => {
        if (currentRoom && lobbies[currentRoom] && lobbies[currentRoom].hostId === socket.id) {
            lobbies[currentRoom].isRunning = true;
            lobbies[currentRoom].countdown = 3;
            lobbies[currentRoom].startTime = Date.now();
            io.to(currentRoom).emit('fullMap', lobbies[currentRoom].rows);
            io.to(currentRoom).emit('gameStarted');
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

setInterval(() => {
    for (const roomId in lobbies) {
        const game = lobbies[roomId];
        if (!game.isRunning) continue;
        
        if (game.countdown > -1) game.countdown -= 1/60;
        
        game.changes = { removedDots: [], newRows: {} };
        
        const s = { 
            t: Date.now(), camY: game.cameraY, players: game.players, ghosts: game.ghosts, ft: game.frightenedTimer, cd: game.countdown, st: game.startTime, changes: game.changes, sbt: game.speedBoostTimer,
            rockets: game.rocketState.rockets, warnings: game.rocketState.warnings
        };

        if (game.countdown > 0) {
            io.to(roomId).emit('state', s);
            continue;
        }
        
        updateGamePhysics(game);
        s.rockets = game.rocketState.rockets;
        s.warnings = game.rocketState.warnings;
        io.to(roomId).emit('state', s);
    }
}, 1000 / 60);

function handleRocketLogic(game) {
    const rs = game.rocketState;
    const fc = game.frameCounter;

    if (!rs.active && fc >= rs.nextCycle) {
        rs.active = true;
        rs.wavesLeft = 3;
        rs.nextWaveTime = fc; 
    }

    if (rs.active) {
        if (rs.wavesLeft > 0 && fc >= rs.nextWaveTime) {
            rs.wavesLeft--;
            rs.nextWaveTime = fc + ROCKET_WAVE_INTERVAL; 

            const patterns = ['CENTER', 'SIDES', 'LEFT', 'RIGHT', 'SYMMETRY'];
            const pat = patterns[Math.floor(Math.random() * patterns.length)];
            let cols = [];

            if (pat === 'CENTER') cols = [8,9,10,11];
            else if (pat === 'LEFT') cols = [2,3,4,5];
            else if (pat === 'RIGHT') cols = [14,15,16,17];
            else if (pat === 'SIDES') cols = [2,3,16,17];
            else if (pat === 'SYMMETRY') cols = [5,6,13,14];

            cols.forEach(col => {
                rs.warnings.push({ x: col * TILE_SIZE, y: game.cameraY + ROCKET_Y_OFFSET, timer: ROCKET_WARNING_TIME });
            });
            io.to(game.id).emit('sfx', 'warning');
        } else if (rs.wavesLeft === 0 && rs.warnings.length === 0 && rs.rockets.length === 0) {
            rs.active = false;
            rs.nextCycle = fc + 1800 + Math.floor(Math.random() * 5400); 
        }
    }

    const gColors = ['red','pink','cyan','orange'];

    for (let i = rs.warnings.length - 1; i >= 0; i--) {
        let w = rs.warnings[i];
        w.y = game.cameraY + ROCKET_Y_OFFSET; 
        w.timer--;
        if (w.timer <= 0) {
            rs.rockets.push({
                x: w.x,
                y: game.cameraY + 950, 
                vx: 0,
                vy: -PLAYER_SPEED_MAX * 2, 
                color: gColors[Math.floor(Math.random()*4)]
            });
            rs.warnings.splice(i, 1);
            if (i === 0) io.to(game.id).emit('sfx', 'rocket');
        }
    }

    for (let i = rs.rockets.length - 1; i >= 0; i--) {
        let r = rs.rockets[i];
        r.y += r.vy;
        if (r.y < game.cameraY - 200) { rs.rockets.splice(i, 1); continue; }
        for (let pid in game.players) {
            const p = game.players[pid];
            if (p.alive && p.deathTimer === 0 && p.invulnTimer <= 0) {
                if (Math.abs(p.x - r.x) < 20 && Math.abs(p.y - r.y) < 20) { loseLife(game, p); }
            }
        }
    }
}

function updateGamePhysics(game) {
    const anyAlive = Object.values(game.players).some(p => p.alive);
    if (!anyAlive) return;

    game.frameCounter++;

    let speedMult = 1.0;
    if (game.speedBoostTimer > 0) { game.speedBoostTimer--; speedMult = 1.5; }

    if(game.gameSpeed < CAM_SPEED_MAX) game.gameSpeed += CAM_ACCEL;
    game.cameraY -= game.gameSpeed * speedMult;

    handleRocketLogic(game);

    let ratio = (game.gameSpeed - CAM_SPEED_START) / (CAM_SPEED_MAX - CAM_SPEED_START);
    if (ratio < 0) ratio = 0; if (ratio > 1) ratio = 1;

    const pSpeed = lerp(PLAYER_SPEED_START, PLAYER_SPEED_MAX, ratio) * speedMult;
    const gSpeed = lerp(GHOST_SPEED_START, GHOST_SPEED_MAX, ratio) * speedMult;
    const fSpeed = lerp(FRIGHT_SPEED_START, FRIGHT_SPEED_MAX, ratio) * speedMult;

    const topRow = Math.floor(game.cameraY / TILE_SIZE) - 5;
    if(!game.rows[topRow]) generateRow(game, topRow);
    if(game.frightenedTimer > 0) game.frightenedTimer--;

    const pIds = Object.keys(game.players);
    for (let id of pIds) {
        let p = game.players[id];
        if(!p.alive) continue;
        if (p.deathTimer > 0) { p.deathTimer--; if (p.deathTimer === 0) finalizeDeath(game, p); continue; }
        if(p.invulnTimer > 0) p.invulnTimer--;
        if(p.pvpTimer > 0) p.pvpTimer--;
        
        const myMilestone = Math.floor(p.score / SCORE_MILESTONE);
        if (myMilestone > game.globalThreshold) {
            game.globalThreshold = myMilestone; 
            game.speedBoostTimer = SPEED_BOOST_DURATION;
            p.invulnTimer = SPEED_BOOST_DURATION; 
            io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "HYPER SPEED!", color: "#FFFF00"});
            io.to(game.id).emit('sfx', 'power');
        }

        const gx = Math.round(p.x / TILE_SIZE), gy = Math.round(p.y / TILE_SIZE);
        const px = gx * TILE_SIZE, py = gy * TILE_SIZE;
        let spd = pSpeed; if (p.pvpTimer > 0) spd *= 1.3;

        const moveStep = spd;
        if (Math.abs(p.x - px) <= moveStep && Math.abs(p.y - py) <= moveStep) {
            if (p.nextDir && getTile(game, gx + p.nextDir.x, gy + p.nextDir.y) !== TILE.WALL) { 
                p.x = px; p.y = py; p.vx = p.nextDir.x * spd; p.vy = p.nextDir.y * spd; p.nextDir = null; 
            }
            if (getTile(game, gx + Math.sign(p.vx), gy + Math.sign(p.vy)) === TILE.WALL) { p.vx = 0; p.vy = 0; p.x = px; p.y = py; }
        }

        if (p.vx !== 0) p.vx = Math.sign(p.vx) * spd;
        if (p.vy !== 0) p.vy = Math.sign(p.vy) * spd;
        p.x += p.vx; p.y += p.vy;
        
        const tile = getTile(game, gx, gy);
        if(tile > TILE.WALL) {
            game.rows[gy][gx] = TILE.EMPTY;
            game.changes.removedDots.push({x: gx, y: gy});
            if(tile === TILE.DOT) { p.score += 10; }
            else if(tile === TILE.POWER) { p.score += 50; game.frightenedTimer = POWER_MODE_DURATION; io.to(game.id).emit('sfx', 'power'); }
            else if(tile === TILE.CHERRY) { p.score += 100; p.stats.cherries++; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "+100"}); io.to(game.id).emit('sfx', 'eatFruit'); }
            else if(tile === TILE.EVIL) { p.pvpTimer = PVP_MODE_DURATION; p.stats.evil++; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "EVIL MODE!", color: "#FF0000"}); io.to(game.id).emit('sfx', 'power'); }
            else if(tile === TILE.HEART) { if (p.lives < 3) { p.lives++; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "1UP!", color: "#FF69B4"}); } else { p.score += 100; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "+100", color: "#FFF"}); } io.to(game.id).emit('sfx', 'eatFruit'); }
        }
        if(p.y > game.cameraY + 800) loseLife(game, p);
    }

    for (let i = 0; i < pIds.length; i++) {
        for (let j = i + 1; j < pIds.length; j++) {
            const p1 = game.players[pIds[i]], p2 = game.players[pIds[j]];
            if (p1.alive && p2.alive && p1.deathTimer === 0 && p2.deathTimer === 0) {
                if (Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2) < TILE_SIZE) {
                    if (p1.pvpTimer > 0 && p2.invulnTimer <= 0) { p1.score += p2.score; p2.score = 0; p1.stats.players++; io.to(game.id).emit('popup', {x: p1.x, y: p1.y, text: "ATE PLAYER!"}); loseLife(game, p2); }
                    else if (p2.pvpTimer > 0 && p1.invulnTimer <= 0) { p2.score += p1.score; p1.score = 0; p2.stats.players++; io.to(game.id).emit('popup', {x: p2.x, y: p2.y, text: "ATE PLAYER!"}); loseLife(game, p1); }
                }
            }
        }
    }

    if (game.cameraY < game.nextGhostSpawn) {
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
            for(let pid in game.players) { const pl = game.players[pid]; if(pl.alive && pl.deathTimer === 0) { let d = (pl.x-g.x)**2 + (pl.y-g.y)**2; if(d < minDist) { minDist = d; target = pl; } } }
            const dirs = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
            let valid = dirs.filter(d => getTile(game, gx+d.x, gy+d.y) !== TILE.WALL);
            if (!stuck && valid.length > 1) { 
                const bx = -Math.sign(g.lastDir.x||g.vx), by = -Math.sign(g.lastDir.y||g.vy); 
                const noBack = valid.filter(d => d.x!==bx || d.y!==by); if(noBack.length > 0) valid = noBack; 
            }
            if (valid.length > 0) {
                if (target) {
                    valid.sort((a, b) => { 
                        const da = ((gx+a.x)*TILE_SIZE-target.x)**2 + ((gy+a.y)*TILE_SIZE-target.y)**2; 
                        const db = ((gx+b.x)*TILE_SIZE-target.x)**2 + ((gy+b.y)*TILE_SIZE-target.y)**2; 
                        return game.frightenedTimer > 0 ? db - da : da - db; 
                    });
                } else valid.sort(()=>Math.random()-0.5);
                const best = valid[0]; g.vx = best.x * speed; g.vy = best.y * speed; g.lastDir = {x: best.x, y: best.y};
            } else { g.vx = 0; g.vy = 0; }
        }
        g.x += g.vx; g.y += g.vy;
        for(let pid in game.players) {
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
        const cy = Math.floor((game.cameraY + 400) / TILE_SIZE); 
        let foundX = 10;
        for(let x=2; x<MAP_WIDTH-2; x++) if(getTile(game, x, cy) !== TILE.WALL) { foundX = x; break; } 
        p.x = foundX * TILE_SIZE; p.y = cy * TILE_SIZE; p.vx = 0; p.vy = 0; p.invulnTimer = 120; p.pvpTimer = 0; p.deathTimer = 0; 
        game.gameSpeed = Math.max(CAM_SPEED_START, game.gameSpeed * 0.7);
    } else { 
        p.alive = false; 
        updateGlobalLeaderboard(p.name, p.score);
        const matchResults = Object.values(game.players).sort((a,b) => b.score - a.score);
        io.to(p.id).emit('gameOver', {
            score: p.score,
            stats: p.stats,
            leaderboard: matchResults.map(pl => ({name: pl.name, score: pl.score, color: pl.color, alive: pl.alive}))
        }); 
    }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));