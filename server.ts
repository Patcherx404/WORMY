import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

const PORT = 3000;
const WORLD_SIZE = 4000;
const INITIAL_SPEED = 3.5;
const BOOST_SPEED = 6;
const TICK_RATE = 30; // 30ms = ~33 ticks per second

interface Point {
  x: number;
  y: number;
}

enum PowerUpType {
  SHIELD = "shield",
  SUPER_SPEED = "speed",
  SHRINK_WAVE = "shrink"
}

interface PowerUp {
  id: string;
  x: number;
  y: number;
  type: PowerUpType;
}

interface Player {
  id: string;
  name: string;
  color: string;
  segments: Point[];
  angle: number;
  speed: number;
  score: number;
  isBoosting: boolean;
  isBot?: boolean;
  activeEffects: { [key in PowerUpType]?: number };
}

interface Food {
  id: string;
  x: number;
  y: number;
  value: number;
  color: string;
}

const colors = [
  "#FF3366", "#33FF66", "#3366FF", "#FFFF33", "#FF33FF", "#33FFFF",
  "#FF8800", "#AA00FF", "#00E676", "#FFD600", "#FF1744"
];

const players: Map<string, Player> = new Map();
const food: Food[] = [];
const powerUps: PowerUp[] = [];
const MAX_FOOD = 1200;
const MAX_POWER_UPS = 8;

// Helper to generate food
function spawnFood(count: number) {
  if (food.length >= MAX_FOOD) return;
  const toSpawn = Math.min(count, MAX_FOOD - food.length);
  for (let i = 0; i < toSpawn; i++) {
    food.push({
      id: Math.random().toString(36).substring(7),
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      value: Math.floor(Math.random() * 5) + 1,
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }
}

spawnFood(800);

function spawnPowerUps() {
  if (powerUps.length >= MAX_POWER_UPS) return;
  const types = [PowerUpType.SHIELD, PowerUpType.SUPER_SPEED, PowerUpType.SHRINK_WAVE];
  const toSpawn = MAX_POWER_UPS - powerUps.length;
  for (let i = 0; i < toSpawn; i++) {
    powerUps.push({
      id: Math.random().toString(36).substring(7),
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      type: types[Math.floor(Math.random() * types.length)]
    });
  }
}

spawnPowerUps();

// Simple AI Bots
function spawnBots(count: number) {
  for (let i = 0; i < count; i++) {
    const id = "bot_" + Math.random().toString(36).substring(7);
    const startX = Math.random() * WORLD_SIZE;
    const startY = Math.random() * WORLD_SIZE;
    players.set(id, {
      id,
      name: "Bot " + (i + 1),
      color: colors[Math.floor(Math.random() * colors.length)],
      segments: Array.from({ length: 5 }, (_, j) => ({ x: startX - j * 5, y: startY })),
      angle: Math.random() * Math.PI * 2,
      speed: INITIAL_SPEED,
      score: 50,
      isBoosting: false,
      isBot: true,
      activeEffects: {}
    });
  }
}

spawnBots(10);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("join", (name: string) => {
      const startX = Math.random() * WORLD_SIZE;
      const startY = Math.random() * WORLD_SIZE;
      players.set(socket.id, {
        id: socket.id,
        name: name || "Player",
        color: colors[Math.floor(Math.random() * colors.length)],
        segments: Array.from({ length: 5 }, (_, i) => ({ x: startX - i * 5, y: startY })),
        angle: 0,
        speed: INITIAL_SPEED,
        score: 50,
        isBoosting: false,
        activeEffects: {}
      });
      socket.emit("init", { worldSize: WORLD_SIZE, id: socket.id });
    });

    socket.on("updateAngle", (angle: number) => {
      const player = players.get(socket.id);
      if (player) player.angle = angle;
    });

    socket.on("boost", (isBoosting: boolean) => {
      const player = players.get(socket.id);
      if (player) player.isBoosting = isBoosting;
    });

    socket.on("disconnect", () => {
      players.delete(socket.id);
    });
  });

  // Game Loop
  const GRID_SIZE = 250; // Size of spatial buckets
  let tickCounter = 0;
  
  setInterval(() => {
    tickCounter++;
    if (tickCounter % 100 === 0) spawnPowerUps();

    const now = Date.now();
    // 1. Prepare Spatial Grid for collisions
    const grid: Map<string, Array<{player: Player, segment: Point}>> = new Map();
    players.forEach(p => {
      p.segments.forEach(seg => {
        const key = `${Math.floor(seg.x / GRID_SIZE)},${Math.floor(seg.y / GRID_SIZE)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push({player: p, segment: seg});
      });
    });

    // 2. Prepare Synced Segments for broadcast (cache once per tick)
    const syncedPlayerData = Array.from(players.values()).map(p => {
      const syncedSegments = [];
      if (p.segments.length > 0) {
        syncedSegments.push(p.segments[0]);
        let lastSaved = p.segments[0];
        for (let i = 1; i < p.segments.length; i++) {
          const s = p.segments[i];
          const dx = s.x - lastSaved.x;
          const dy = s.y - lastSaved.y;
          const distSq = dx*dx + dy*dy;
          if (distSq > 144 || i === p.segments.length - 1) { // 12px jump
            syncedSegments.push(s);
            lastSaved = s;
          }
        }
      }
      return { id: p.id, name: p.name, color: p.color, segments: syncedSegments, score: p.score };
    });

    // 3. Logic & Physics Update
    players.forEach((player, id) => {
      // Clean up expired effects
      Object.keys(player.activeEffects).forEach(type => {
        if (player.activeEffects[type as PowerUpType]! < now) {
          delete player.activeEffects[type as PowerUpType];
        }
      });

      // AI Logic
      if (player.isBot) {
        if (Math.random() < 0.02) player.angle += (Math.random() - 0.5) * Math.PI;
        const head = player.segments[0];
        if (head.x < 100 || head.x > WORLD_SIZE - 100 || head.y < 100 || head.y > WORLD_SIZE - 100) {
          player.angle += 0.1;
        }
      }

      let speed = player.isBoosting && player.score > 20 ? BOOST_SPEED : INITIAL_SPEED;
      
      // Super Speed effect
      if (player.activeEffects[PowerUpType.SUPER_SPEED]) {
        speed = BOOST_SPEED * 1.5;
        // No score drain during power-up
      } else if (player.isBoosting && player.score > 20) {
        player.score -= 0.1;
      }

      const headPos = player.segments[0];
      const newHead = {
        x: headPos.x + Math.cos(player.angle) * speed,
        y: headPos.y + Math.sin(player.angle) * speed
      };

      // Boundary check
      if (newHead.x < 0) newHead.x = 0;
      if (newHead.x > WORLD_SIZE) newHead.x = WORLD_SIZE;
      if (newHead.y < 0) newHead.y = 0;
      if (newHead.y > WORLD_SIZE) newHead.y = WORLD_SIZE;

      player.segments.unshift(newHead);

      // Trimming
      const desiredTotalLength = 50 + (player.score * 1.5);
      let currentLength = 0;
      let lastSeg = player.segments[0];
      let trimIndex = -1;
      for (let i = 1; i < player.segments.length; i++) {
        const seg = player.segments[i];
        const dx = seg.x - lastSeg.x;
        const dy = seg.y - lastSeg.y;
        currentLength += Math.sqrt(dx*dx + dy*dy);
        lastSeg = seg;
        if (currentLength > desiredTotalLength) {
          trimIndex = i;
          break;
        }
      }
      if (trimIndex !== -1) player.segments = player.segments.slice(0, trimIndex + 1);

      // Collision via Grid
      const gx = Math.floor(newHead.x / GRID_SIZE);
      const gy = Math.floor(newHead.y / GRID_SIZE);
      let dead = false;
      
      check_loop:
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(`${gx+ox},${gy+oy}`);
          if (!bucket) continue;
          for (const item of bucket) {
            // Collision with others
            if (item.player.id === id) {
               // Skip own head segments
               if (player.segments.slice(0, 15).some(s => s === item.segment)) continue;
            }
            
            const dx = item.segment.x - newHead.x;
            const dy = item.segment.y - newHead.y;
            const minDist = 15 + (item.player.score / 200);
            if (dx*dx + dy*dy < minDist * minDist) {
              dead = true;
              break check_loop;
            }
          }
        }
      }

      if (dead) {
        // Shield effect prevents death
        if (player.activeEffects[PowerUpType.SHIELD]) {
          dead = false;
        } else {
          player.segments.forEach((pS, pI) => {
          if (pI % 15 === 0) {
            food.push({
              id: Math.random().toString(36).substring(7),
              x: pS.x + (Math.random() - 0.5) * 40,
              y: pS.y + (Math.random() - 0.5) * 40,
              value: 5,
              color: player.color
            });
          }
        });
        if (!player.isBot) io.to(id).emit("gameover", { score: player.score });
        players.delete(id);
        if (player.isBot) setTimeout(() => spawnBots(1), 1000);
        return;
      }
    }

      // Food logic
      const pr = 25 + (player.score / 100);
      const prSq = pr*pr;
      const fIdx = food.findIndex(f => {
        const dx = f.x - newHead.x;
        const dy = f.y - newHead.y;
        return (dx*dx + dy*dy) < prSq;
      });
      if (fIdx !== -1) {
        player.score += food[fIdx].value;
        food.splice(fIdx, 1);
        spawnFood(1);
      }

      // Power-up logic
      const puIdx = powerUps.findIndex(pu => {
        const dx = pu.x - newHead.x;
        const dy = pu.y - newHead.y;
        return (dx*dx + dy*dy) < 40 * 40;
      });

      if (puIdx !== -1) {
        const pu = powerUps.splice(puIdx, 1)[0];
        
        if (pu.type === PowerUpType.SHRINK_WAVE) {
          // Pulse effect: shrink nearby opponents immediately
          players.forEach((other, otherId) => {
            if (otherId === id) return;
            const dx = other.segments[0].x - newHead.x;
            const dy = other.segments[0].y - newHead.y;
            if (dx*dx + dy*dy < 1000 * 1000) {
              other.score = Math.max(10, other.score * 0.6);
            }
          });
        } else {
          player.activeEffects[pu.type] = Date.now() + 8000; // 8 seconds duration
        }
      }
    });

    // 4. Broadcast
    const VIEW_DIST_SQ = 1400 * 1400;
    players.forEach((player, id) => {
      if (player.isBot) return;
      const head = player.segments[0];
      const nearbyPlayers = syncedPlayerData.filter(p => {
        if (p.segments.length === 0) return false;
        const dx = p.segments[0].x - head.x;
        const dy = p.segments[0].y - head.y;
        return (dx*dx + dy*dy) < VIEW_DIST_SQ;
      }).map(p => {
        // Add active effects for synced players
        const actualPlayer = players.get(p.id);
        return {
          ...p,
          activeEffects: actualPlayer?.activeEffects || {}
        };
      });

      const nearbyFood = food.filter(f => {
        const dx = f.x - head.x;
        const dy = f.y - head.y;
        return (dx*dx + dy*dy) < VIEW_DIST_SQ;
      });

      const nearbyPowerUps = powerUps.filter(pu => {
        const dx = pu.x - head.x;
        const dy = pu.y - head.y;
        return (dx*dx + dy*dy) < VIEW_DIST_SQ;
      });

      io.to(id).emit("update", { 
        players: nearbyPlayers, 
        food: nearbyFood,
        powerUps: nearbyPowerUps
      });
    });
  }, TICK_RATE);


  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
