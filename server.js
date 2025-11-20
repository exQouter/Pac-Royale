const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require("socket.io");

// Настройка Socket.io с CORS (важно для Render)
const io = new Server(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

// --- КОНФИГУРАЦИЯ ---
const TILE_SIZE = 30;
const MAP_WIDTH = 20;
const COLORS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF'];

// --- БАЛАНС ---
const PLAYER_SPEED = 2.0;
const GHOST_SPEED_NORMAL = 1.5;
const GHOST_SPEED_FRIGHTENED = 0.8;
const CAMERA_MAX_SPEED = 1.4;
const CAMERA_START_SPEED = 0.5;
const CAMERA_ACCELERATION = 0.0005; 
const POWER_MODE_DURATION = 240; 
const PVP_MODE_DURATION = 300; 

const TILE = { EMPTY: 0, WALL: 1, DOT: 2, POWER: 3, CHERRY: 4, EVIL: 5, HEART: 6 };

const lobbies = {};
let globalLeaderboard = [];

function makeId(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * characters.length));
    return result;
}

const PATTERNS = [
    [[1,0,0,0,1,0,0,0,0,1,1,0,0,0,0,1,0,0,0,1],[1,0,1,0,1,0,1,1,0,1,1,0,1,1,0,1,0,1,0,1],[1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1],[1,0,1,1,1,0,1,1,1,1,1,1,1,1,0,1,1,1,0,1],[1,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1],[1,0,1,1,1,0,1,0,1,1,1,1,0,1,0,1,1,1,0,1],[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],[1,0,1,1,1,0,1,1,0,1,1,0,1,1,0,1,1,1,0,1],[1,0,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1,0,1],[1,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,1]],
    [[1,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,1],[1,0,1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1,0,1],[1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1],[1,0,1,0,1,1,1,1,0,0,0,0,1,1,1,1,0,1,0,1],[1,0,0,0,1,3,0,0,0,0,0,0,0,0,3,1,0,0,0,1],[1,0,1,0,1,1,1,1,0,1,1,0,1,1,1,1,0,1,0,1],[1,0,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1,0,1],[1,0,1,1,1,0,1,1,1,1,1,1,1,1,0,1,1,1,0,1],[1,0,0,0,1,0,1,0,0,0,0,0,0,1,0,1,0,0,0,1],[1,1,1,0,0,0,0,0,1,1,1,1,0,0,0,0,0,1,1,1]],
    [[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],[1,0,1,1,0,1,1,0,1,1,1,1,0,1,1,0,1,1,0,1],[1,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,1],[1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,1],[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],[1,0,1,1,1,0,1,1,1,1,1,1,1,1,0,1,1,1,0,1],[1,0,0,3,0,0,0,0,0,1,1,0,0,0,0,0,3,0,0,1],[1,0,1,1,0,1,1,1,0,1,1,0,1,1,1,0,1,1,0,1],[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],[1,1,1,0,1,1,1,1,0,1,1,0,1,1,1,1,0,1,1,1]],
    [[1,0,1,0,1,0,1,0,1,1,1,1,0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0,1,0,0,1,0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0,0,0,0,0,0,1,0,1,0,1,0,1],[1,0,1,0,0,0,0,0,1,1,1,1,0,0,0,0,0,1,0,1],[1,0,1,1,1,1,1,0,1,1,1,1,0,1,1,1,1,1,0,1],[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],[1,0,1,0,1,1,1,0,1,1,1,1,0,1,1,1,0,1,0,1],[1,0,1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1,0,1],[1,0,1,0,0,0,1,1,1,0,0,1,1,1,0,0,0,1,0,1],[1,0,1,1,1,0,1,1,1,0,0,1,1,1,0,1,1,1,0,1]]
];

function createGame(roomId) {
    const game = {
        id: roomId, players: {}, ghosts: [], cameraY: 0, gameSpeed: CAMERA_START_SPEED,
        rows: {}, frightenedTimer: 0, nextGhostSpawn: -400, leaderboard: [],
        patternRowIndex: 0, currentPattern: null, isRunning: false, hostId: null, countdown: 0
    };
    for(let y=30; y>=-50; y--) generateRow(game, y);
    for(let y=20; y<25; y++) { for(let x=1; x<MAP_WIDTH-1; x++) { if(!game.rows[y]) game.rows[y]=[]; game.rows[y][x] = TILE.EMPTY; } }
    return game;
}

function generateRow(game, yIndex) {
    if (!game.currentPattern || game.patternRowIndex >= 10) {
        game.currentPattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
        game.patternRowIndex = 0;
    }
    const row = [...game.currentPattern[9 - game.patternRowIndex]];
    game.patternRowIndex++;
    for(let i=0; i<row.length; i++) { 
        if(row[i] === 0) {
            const r = Math.random();
            if (r < 0.0005) row[i] = TILE.EVIL; else if (r < 0.0020) row[i] = TILE.HEART; else if (r < 0.0070) row[i] = TILE.CHERRY; else row[i] = TILE.DOT;
        } else if (row[i] === 3) { row[i] = TILE.POWER; }
    }
    game.rows[yIndex] = row;
    const cleanupThreshold = Math.floor(game.cameraY / TILE_SIZE) + 60;
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
        if(!code) return;
        const roomId = code.toUpperCase();
        if (lobbies[roomId]) joinRoom(socket, roomId, nickname);
        else socket.emit('errorMsg', 'Lobby not found');
    });
    function joinRoom(socket, roomId, nickname) {
        const game = lobbies[roomId];
        if (game.isRunning) { socket.emit('errorMsg', 'Game already started'); return; }
        const usedIdx = Object.values(game.players).map(p => p.colorIdx);
        let myIdx = -1;
        for(let i=0; i<4; i++) { if(!usedIdx.includes(i)) { myIdx = i; break; } }
        if(myIdx === -1) { socket.emit('errorMsg', 'Lobby full'); return; }
        game.players[socket.id] = {
            id: socket.id, name: (nickname || `P${myIdx+1}`).substring(0, 10).toUpperCase(),
            colorIdx: myIdx, color: COLORS[myIdx], x: (4 + myIdx * 4) * TILE_SIZE, y: 22 * TILE_SIZE,
            vx: 0, vy: 0, nextDir: null, score: 0, lives: 3, alive: true, invulnTimer: 0, pvpTimer: 0
        };
        currentRoom = roomId;
        socket.join(roomId);
        socket.emit('init', { id: socket.id, colorIdx: myIdx });
        io.to(roomId).emit('lobbyUpdate', { players: Object.values(game.players), hostId: game.hostId, roomId: roomId });
    }
    socket.on('startGame', () => {
        if (currentRoom && lobbies[currentRoom] && lobbies[currentRoom].hostId === socket.id) {
            lobbies[currentRoom].isRunning = true;
            lobbies[currentRoom].countdown = 3; 
            io.to(currentRoom).emit('gameStarted');
        }
    });
    socket.on('input', (dir) => {
        if (currentRoom && lobbies[currentRoom]) {
            const p = lobbies[currentRoom].players[socket.id];
            if (p && p.alive) p.nextDir = dir;
        }
    });
    socket.on('submitScore', ({ name, score }) => {
        const safeName = (name || "PLAYER").substring(0, 10).toUpperCase();
        globalLeaderboard.push({ name: safeName, score: parseInt(score) || 0 });
        globalLeaderboard.sort((a, b) => b.score - a.score);
        globalLeaderboard = globalLeaderboard.slice(0, 10);
        io.emit('leaderboardUpdate', globalLeaderboard);
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
        if (game.countdown > 0) {
            io.to(roomId).emit('state', { cameraY: game.cameraY, gameSpeed: 0, rows: game.rows, players: game.players, ghosts: game.ghosts, frightenedTimer: game.frightenedTimer, countdown: game.countdown });
            continue;
        }
        updateGamePhysics(game);
        io.to(roomId).emit('state', { cameraY: game.cameraY, gameSpeed: game.gameSpeed, rows: game.rows, players: game.players, ghosts: game.ghosts, frightenedTimer: game.frightenedTimer, countdown: game.countdown });
    }
}, 1000 / 60);

function updateGamePhysics(game) {
    game.cameraY -= game.gameSpeed;
    if(game.gameSpeed < CAMERA_MAX_SPEED) game.gameSpeed += CAMERA_ACCELERATION;
    const topRow = Math.floor(game.cameraY / TILE_SIZE) - 5;
    if(!game.rows[topRow]) generateRow(game, topRow);
    if(game.frightenedTimer > 0) game.frightenedTimer--;

    const playerIds = Object.keys(game.players);
    for (let id of playerIds) {
        let p = game.players[id];
        if(!p || !p.alive) continue;
        if(p.invulnTimer > 0) p.invulnTimer--;
        if(p.pvpTimer > 0) p.pvpTimer--;
        const gx = Math.round(p.x / TILE_SIZE), gy = Math.round(p.y / TILE_SIZE), px = gx * TILE_SIZE, py = gy * TILE_SIZE;
        if (Math.abs(p.x - px) <= PLAYER_SPEED && Math.abs(p.y - py) <= PLAYER_SPEED) {
            if (p.nextDir) { if (getTile(game, gx + p.nextDir.x, gy + p.nextDir.y) !== TILE.WALL) { p.x = px; p.y = py; p.vx = p.nextDir.x * PLAYER_SPEED; p.vy = p.nextDir.y * PLAYER_SPEED; p.nextDir = null; } }
            if (getTile(game, gx + Math.sign(p.vx), gy + Math.sign(p.vy)) === TILE.WALL) { p.vx = 0; p.vy = 0; p.x = px; p.y = py; }
        }
        p.x += p.vx; p.y += p.vy;
        const tile = getTile(game, gx, gy);
        if(tile === TILE.DOT) { game.rows[gy][gx] = TILE.EMPTY; p.score += 10; }
        else if(tile === TILE.POWER) { game.rows[gy][gx] = TILE.EMPTY; p.score += 50; game.frightenedTimer = POWER_MODE_DURATION; io.to(game.id).emit('sfx', 'power'); }
        else if(tile === TILE.CHERRY) { game.rows[gy][gx] = TILE.EMPTY; p.score += 100; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "+100"}); io.to(game.id).emit('sfx', 'eatFruit'); }
        else if(tile === TILE.EVIL) { game.rows[gy][gx] = TILE.EMPTY; p.pvpTimer = PVP_MODE_DURATION; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "EVIL MODE!", color: "#FF0000"}); io.to(game.id).emit('sfx', 'power'); }
        else if(tile === TILE.HEART) { game.rows[gy][gx] = TILE.EMPTY; if (p.lives < 3) { p.lives++; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "1UP!", color: "#FF69B4"}); } else { p.score += 100; io.to(game.id).emit('popup', {x: p.x, y: p.y, text: "+100", color: "#FFF"}); } io.to(game.id).emit('sfx', 'eatFruit'); }
        if(p.y > game.cameraY + 800) loseLife(game, p);
    }
    for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
            const p1 = game.players[playerIds[i]], p2 = game.players[playerIds[j]];
            if (p1.alive && p2.alive && Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2) < TILE_SIZE) {
                if (p1.pvpTimer > 0 && p2.invulnTimer <= 0) { p1.score += p2.score; p2.score = 0; io.to(game.id).emit('popup', {x: p1.x, y: p1.y, text: "ATE PLAYER!"}); loseLife(game, p2); }
                else if (p2.pvpTimer > 0 && p1.invulnTimer <= 0) { p2.score += p1.score; p1.score = 0; io.to(game.id).emit('popup', {x: p2.x, y: p2.y, text: "ATE PLAYER!"}); loseLife(game, p1); }
            }
        }
    }
    if (game.cameraY < game.nextGhostSpawn) {
        let sx, sy, tries=0; do { sx = Math.floor(Math.random()*(MAP_WIDTH-4)+2)*TILE_SIZE; sy = (Math.floor(game.cameraY/TILE_SIZE)-2)*TILE_SIZE; tries++; } while (getTile(game, sx/TILE_SIZE, sy/TILE_SIZE)===TILE.WALL && tries<10);
        game.ghosts.push({ x: sx, y: sy, vx: 0, vy: 0, lastDir: {x:0,y:0}, dead: false, color: ['red','pink','cyan','orange'][Math.floor(Math.random()*4)] });
        game.nextGhostSpawn -= 500;
    }
    game.ghosts.forEach(g => {
        const speed = game.frightenedTimer > 0 ? GHOST_SPEED_FRIGHTENED : GHOST_SPEED_NORMAL;
        const gx = Math.round(g.x / TILE_SIZE), gy = Math.round(g.y / TILE_SIZE), px = gx * TILE_SIZE, py = gy * TILE_SIZE;
        const stuck = (g.vx===0 && g.vy===0);
        const atCenter = (Math.abs(g.x-px) <= speed/2 && Math.abs(g.y-py) <= speed/2);
        if (stuck || atCenter) {
            if(!stuck) { g.x = px; g.y = py; }
            let target = null, minDist = Infinity;
            for(let pid in game.players) { const pl = game.players[pid]; if(pl.alive) { let d = (pl.x-g.x)**2 + (pl.y-g.y)**2; if(d < minDist) { minDist = d; target = pl; } } }
            const dirs = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
            let valid = dirs.filter(d => getTile(game, gx+d.x, gy+d.y) !== TILE.WALL);
            if (!stuck && valid.length > 1) { const bx = -Math.sign(g.lastDir.x||g.vx), by = -Math.sign(g.lastDir.y||g.vy); const noBack = valid.filter(d => d.x!==bx || d.y!==by); if(noBack.length > 0) valid = noBack; }
            if (valid.length > 0) {
                if (target) valid.sort((a, b) => { const da = ((gx+a.x)*TILE_SIZE-target.x)**2 + ((gy+a.y)*TILE_SIZE-target.y)**2; const db = ((gx+b.x)*TILE_SIZE-target.x)**2 + ((gy+b.y)*TILE_SIZE-target.y)**2; return game.frightenedTimer > 0 ? db - da : da - db; });
                else valid.sort(()=>Math.random()-0.5);
                const best = valid[0]; g.vx = best.x * speed; g.vy = best.y * speed; g.lastDir = {x: best.x, y: best.y};
            } else { g.vx = 0; g.vy = 0; }
        }
        g.x += g.vx; g.y += g.vy;
        for(let pid in game.players) {
            const p = game.players[pid];
            if(p.alive && Math.abs(p.x-g.x)<20 && Math.abs(p.y-g.y)<20) {
                if(game.frightenedTimer > 0) { p.score += 200; g.dead = true; io.to(game.id).emit('sfx', 'eatGhost'); io.to(game.id).emit('popup', {x: g.x, y: g.y, text: "+200"}); }
                else if(p.invulnTimer <= 0) loseLife(game, p);
            }
        }
    });
    game.ghosts = game.ghosts.filter(g => !g.dead && g.y < game.cameraY + 900);
}

function loseLife(game, p) {
    p.lives--; io.to(game.id).emit('sfx', 'death');
    if(p.lives > 0) {
        const cy = Math.floor((game.cameraY + 400) / TILE_SIZE); let foundX = 10;
        for(let x=2; x<MAP_WIDTH-2; x++) { if(getTile(game, x, cy) !== TILE.WALL) { foundX = x; break; } }
        p.x = foundX * TILE_SIZE; p.y = cy * TILE_SIZE; p.vx = 0; p.vy = 0; p.invulnTimer = 120; p.pvpTimer = 0; game.gameSpeed *= 0.7;
    } else { p.alive = false; io.to(p.id).emit('gameOver', p.score); }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));