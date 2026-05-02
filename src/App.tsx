import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Users, Zap, Play, ChevronRight } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import confetti from 'canvas-confetti';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Point {
  x: number;
  y: number;
}

interface Player {
  id: string;
  name: string;
  color: string;
  segments: Point[];
  score: number;
  activeEffects: { [key: string]: number };
}

interface Food {
  id: string;
  x: number;
  y: number;
  value: number;
  color: string;
}

interface PowerUp {
  id: string;
  x: number;
  y: number;
  type: 'shield' | 'speed' | 'shrink';
}

const COLORS = {
  bg: '#07070c',
  grid: 'rgba(255, 255, 255, 0.05)',
  accent: '#00d2ff',
  secondary: '#ff006e',
};

export default function Game() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<{ players: Player[]; food: Food[]; powerUps: PowerUp[] }>({ players: [], food: [], powerUps: [] });
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [worldSize, setWorldSize] = useState(4000);
  const [isGameOver, setIsGameOver] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [isJoined, setIsJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [numPlayers, setNumPlayers] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const camera = useRef({ x: 0, y: 0 });
  
  // High-performance state storage to avoid React re-renders for the canvas
  const stateRef = useRef<{ players: Player[]; food: Food[]; powerUps: PowerUp[] }>({ players: [], food: [], powerUps: [] });
  const serverId = useRef<string | null>(null);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('init', (data: { worldSize: number; id: string }) => {
      setWorldSize(data.worldSize);
      setPlayerId(data.id);
      serverId.current = data.id;
    });

    newSocket.on('update', (data: { players: Player[]; food: Food[]; powerUps: PowerUp[] }) => {
      stateRef.current = data;
      setNumPlayers(data.players.length);
      setGameState(data); 
    });

    newSocket.on('gameover', (data: { score: number }) => {
      setFinalScore(data.score);
      setIsGameOver(true);
      setIsJoined(false);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    });

    return () => { newSocket.disconnect(); };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - (canvas.width / 2);
      const y = e.clientY - rect.top - (canvas.height / 2);
      socket?.emit('updateAngle', Math.atan2(y, x));
    };

    const handleKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space') socket?.emit('boost', true); };
    const handleKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') socket?.emit('boost', false); };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [socket]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false }); // Performance hint
    if (!ctx) return;

    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    const { players: currentPlayers, food: currentFood, powerUps: currentPowerUps } = stateRef.current;
    const myPlayer = currentPlayers.find(p => p.id === serverId.current);
    
    if (myPlayer && myPlayer.segments.length > 0) {
      const head = myPlayer.segments[0];
      camera.current.x += (head.x - camera.current.x) * 0.15;
      camera.current.y += (head.y - camera.current.y) * 0.15;
    }

    // Black background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2 - camera.current.x, canvas.height / 2 - camera.current.y);

    // Optimized Grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    const gS = 80;
    const startX = Math.max(0, Math.floor((camera.current.x - canvas.width / 2) / gS) * gS);
    const endX = Math.min(worldSize, Math.ceil((camera.current.x + canvas.width / 2) / gS) * gS);
    const startY = Math.max(0, Math.floor((camera.current.y - canvas.height / 2) / gS) * gS);
    const endY = Math.min(worldSize, Math.ceil((camera.current.y + canvas.height / 2) / gS) * gS);

    for (let x = startX; x <= endX; x += gS) {
      ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, endY); ctx.stroke();
    }
    for (let y = startY; y <= endY; y += gS) {
      ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();
    }

    const viewportMargin = 100;
    const vX = camera.current.x - canvas.width / 2 - viewportMargin;
    const vY = camera.current.y - canvas.height / 2 - viewportMargin;
    const vW = canvas.width + viewportMargin * 2;
    const vH = canvas.height + viewportMargin * 2;

    // Power-Ups
    currentPowerUps?.forEach(pu => {
      if (pu.x < vX || pu.x > vX + vW || pu.y < vY || pu.y > vY + vH) return;
      
      const time = Date.now() / 500;
      const pulse = Math.sin(time) * 5;
      
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, 15 + pulse, 0, Math.PI * 2);
      
      let color = '#FFF';
      if (pu.type === 'shield') color = '#00D2FF';
      if (pu.type === 'speed') color = '#FF4E00';
      if (pu.type === 'shrink') color = '#AA00FF';
      
      ctx.fillStyle = color;
      ctx.shadowBlur = 20;
      ctx.shadowColor = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      
      // Icon letter
      ctx.fillStyle = 'white';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pu.type[0].toUpperCase(), pu.x, pu.y + 4);
    });

    // Food
    currentFood.forEach(f => {
      if (f.x < vX || f.x > vX + vW || f.y < vY || f.y > vY + vH) return;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 4 + f.value / 2, 0, Math.PI * 2);
      ctx.fillStyle = f.color;
      ctx.fill();
    });

    // Players
    currentPlayers.forEach(p => {
      if (p.segments.length < 2) return;
      const head = p.segments[0];
      const distSq = Math.pow(head.x - camera.current.x, 2) + Math.pow(head.y - camera.current.y, 2);
      if (distSq > 2000 * 2000) return; // Simple culling

      ctx.beginPath();
      ctx.lineWidth = 24 + Math.min(p.score / 50, 20);
      ctx.strokeStyle = p.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.moveTo(p.segments[0].x, p.segments[0].y);
      for (let i = 1; i < p.segments.length; i++) {
        ctx.lineTo(p.segments[i].x, p.segments[i].y);
      }
      ctx.stroke();

      // Shield Aura
      if (p.activeEffects?.shield) {
        ctx.beginPath();
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0, 210, 255, 0.4)';
        ctx.arc(head.x, head.y, (24 + Math.min(p.score / 50, 20))/2 + 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Eyes
      const next = p.segments[1];
      const angle = Math.atan2(head.y - next.y, head.x - next.x);
      const eyeOffset = ctx.lineWidth / 3;
      const eX1 = head.x + Math.cos(angle + 0.5) * eyeOffset;
      const eY1 = head.y + Math.sin(angle + 0.5) * eyeOffset;
      const eX2 = head.x + Math.cos(angle - 0.5) * eyeOffset;
      const eY2 = head.y + Math.sin(angle - 0.5) * eyeOffset;

      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(eX1, eY1, 5, 0, Math.PI * 2);
      ctx.arc(eX2, eY2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'black';
      ctx.beginPath();
      ctx.arc(eX1, eY1, 2, 0, Math.PI * 2);
      ctx.arc(eX2, eY2, 2, 0, Math.PI * 2);
      ctx.fill();

      if (p.id === serverId.current || p.score > 200) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, head.x, head.y - ctx.lineWidth - 5);
      }
    });

    ctx.restore();
    requestRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(draw);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, []); // Only once, relies on Ref for state

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;
    socket?.emit('join', playerName);
    setIsJoined(true);
    setIsGameOver(false);
  };

  const leaderboard = [...gameState.players].sort((a, b) => b.score - a.score).slice(0, 10);
  const currentPlayer = gameState.players.find(p => p.id === playerId);

  return (
    <div className="relative w-full h-screen overflow-hidden font-sans bg-[#07070c] text-white selection:bg-[#00d2ff]/30">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
      />

      {/* Brand Logo Overlay */}
      <div className="absolute top-6 left-6 font-extrabold italic text-2xl tracking-tighter pointer-events-none drop-shadow-lg">
        <span className="text-[#00d2ff]">WORM</span>
        <span className="text-white">GEN.IO</span>
      </div>

      <AnimatePresence>
        {!isJoined && !isGameOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center z-50 bg-[#07070c]/60 backdrop-blur-sm"
          >
            <div className="w-full max-w-md p-10 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-[32px] shadow-[0_32px_64px_rgba(0,0,0,0.5)]">
              <div className="flex flex-col items-center mb-10">
                <div className="w-24 h-24 bg-gradient-to-br from-[#00d2ff] to-[#ff006e] rounded-3xl flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(0,210,255,0.4)]">
                   <Zap className="w-12 h-12 text-white fill-current" />
                </div>
                <h1 className="text-5xl font-black tracking-tight mb-2">WORMGEN</h1>
                <p className="text-white/40 text-xs uppercase tracking-[0.3em] font-medium">Evolution is Mandatory</p>
              </div>

              <form onSubmit={handleJoin} className="space-y-6">
                <div className="relative group">
                  <input
                    type="text"
                    placeholder="Worm Persona"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    maxLength={15}
                    className="w-full h-16 bg-black/20 border border-white/10 rounded-2xl px-6 font-bold text-lg outline-none focus:border-[#00d2ff] transition-all placeholder:text-white/20 group-hover:bg-black/30"
                  />
                  <Users className="absolute right-6 top-1/2 -translate-y-1/2 text-white/20 w-5 h-5 pointer-events-none" />
                </div>
                <button
                  type="submit"
                  className="w-full h-16 bg-[#00d2ff] hover:bg-[#00e5ff] active:scale-[0.98] transition-all rounded-2xl font-black text-xl text-black flex items-center justify-center gap-3 shadow-[0_10px_20px_rgba(0,210,255,0.3)] shadow-[#00d2ff]/20"
                >
                  SPAWN WORM
                  <ChevronRight className="w-6 h-6" />
                </button>
              </form>

              <div className="mt-12 pt-8 border-t border-white/5 flex justify-between">
                  <div className="text-center">
                     <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Online</p>
                     <p className="text-xl font-bold">{gameState.players.length}</p>
                  </div>
                  <div className="text-center">
                     <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Arena</p>
                     <p className="text-xl font-bold">4000x4000</p>
                  </div>
                  <div className="text-center">
                     <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">Version</p>
                     <p className="text-xl font-bold">2.4.0</p>
                  </div>
              </div>
            </div>
          </motion.div>
        )}

        {isGameOver && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 flex items-center justify-center z-50 bg-[#07070c]/80 backdrop-blur-xl"
          >
            <div className="text-center">
              <h2 className="text-8xl font-black mb-4 tracking-tighter bg-gradient-to-b from-white to-white/40 bg-clip-text text-transparent italic">WASTED</h2>
              <div className="text-4xl font-light text-[#00d2ff] mb-12 uppercase tracking-[0.2em]">{Math.floor(finalScore)} Points</div>
              <button
                onClick={() => setIsGameOver(false)}
                className="px-16 py-6 bg-[#00d2ff] text-black font-black rounded-2xl hover:scale-105 active:scale-95 transition-all text-2xl shadow-[0_0_30px_rgba(0,210,255,0.4)]"
              >
                RE-EVOLVE
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game HUD (Frosted Glass Panels) */}
      {isJoined && (
        <>
          {/* Leaderboard Panel */}
          <div className="absolute top-6 right-6 w-[240px] bg-white/10 backdrop-blur-xl p-5 rounded-2xl border border-white/20 shadow-2xl z-10">
            <div className="text-[11px] uppercase tracking-[0.1em] text-white/60 mb-4 font-bold border-b border-white/10 pb-2 flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 text-yellow-500" />
              Leaderboard
            </div>
            <div className="space-y-1.5">
              {leaderboard.map((p, i) => (
                <div key={p.id} className={cn("flex justify-between items-center text-xs py-1 border-b border-white/5 last:border-0", p.id === playerId ? "text-[#00d2ff] font-bold" : "text-white/80")}>
                  <div className="flex items-center gap-2 truncate pr-2">
                     <span className={cn("inline-block w-4 opacity-50 font-mono", i === 0 && "text-yellow-400 opacity-100")}>{i + 1}.</span>
                     <span className="truncate">{p.name}</span>
                  </div>
                  <span className="font-mono text-[11px] font-medium">{Math.floor(p.score).toLocaleString()}</span>
                </div>
              ))}
              
              {/* If player not in top 10 */}
              {!leaderboard.find(p => p.id === playerId) && currentPlayer && (
                <div className="mt-3 pt-3 border-t border-white/20 border-dashed flex justify-between items-center text-xs text-[#00d2ff] font-bold">
                   <div className="flex items-center gap-2 truncate">
                      <span className="opacity-50">??.</span>
                      <span className="truncate">YOU</span>
                   </div>
                   <span className="font-mono">{Math.floor(currentPlayer.score).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Current Score Panel */}
          <div className="absolute bottom-10 left-10 z-10 w-[240px] flex flex-col gap-4">
             <div className="bg-white/10 backdrop-blur-xl p-6 rounded-2xl border border-white/20 shadow-2xl">
                <div className="text-3xl font-light mb-1 leading-none tracking-tight">
                    {Math.floor(currentPlayer?.score || 0).toLocaleString()}
                </div>
                <div className="text-[10px] uppercase font-bold tracking-[0.15em] text-white/40 mb-5">
                    Current Score
                </div>
                
                <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px] uppercase tracking-wider">
                       <span className="text-white/60">Boost Core</span>
                       <span className="text-[#ff4e00] font-bold">{currentPlayer && currentPlayer.score > 20 ? 'Active' : 'Empty'}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                       <motion.div 
                         initial={{ width: 0 }}
                         animate={{ width: currentPlayer ? `${Math.min((currentPlayer.score / 200) * 100, 100)}%` : 0 }}
                         className="h-full bg-gradient-to-r from-[#ff4e00] to-[#f27d26] shadow-[0_0_8px_#ff4e00]"
                       />
                    </div>
                </div>
             </div>

             {/* Active Power-Ups List */}
             {currentPlayer && Object.keys(currentPlayer.activeEffects).length > 0 && (
               <div className="space-y-2">
                  {Object.entries(currentPlayer.activeEffects).map(([type, expiry]) => {
                    const remaining = Math.max(0, Math.floor(((expiry as number) - Date.now()) / 1000));
                    if (remaining <= 0) return null;
                    
                    return (
                      <motion.div 
                        initial={{ x: -20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        key={type}
                        className="bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20 flex items-center justify-between"
                      >
                         <div className="flex items-center gap-2">
                            <Zap className={cn("w-4 h-4", type === 'shield' ? "text-[#00D2FF]" : "text-[#FF4E00]")} />
                            <span className="text-[10px] font-bold uppercase tracking-widest">{type}</span>
                         </div>
                         <span className="text-[10px] font-mono opacity-50">{remaining}s</span>
                      </motion.div>
                    );
                  })}
               </div>
             )}
          </div>

          {/* Minimap Panel */}
          <div className="absolute bottom-10 right-10 w-32 h-32 bg-white/10 backdrop-blur-xl rounded-full border border-white/20 shadow-2xl flex items-center justify-center p-2 z-10">
             <div className="relative w-full h-full bg-black/20 rounded-full overflow-hidden border border-white/5">
                {/* World Boundary in minimap */}
                <div className="absolute inset-x-0 inset-y-0 opacity-10 border border-white" />
                
                {/* Players in minimap */}
                {gameState.players.map(p => {
                  if (p.segments.length === 0) return null;
                  const head = p.segments[0];
                  return (
                    <div 
                      key={p.id}
                      className={cn(
                        "absolute w-1 h-1 rounded-full",
                        p.id === playerId ? "w-1.5 h-1.5 z-10 ring-1 ring-white" : ""
                      )}
                      style={{ 
                        left: `${(head.x / worldSize) * 100}%`, 
                        top: `${(head.y / worldSize) * 100}%`,
                        backgroundColor: p.color,
                        boxShadow: `0 0 4px ${p.color}`
                      }}
                    />
                  );
                })}
             </div>
          </div>
          
          {/* Controls hint */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 opacity-30 pointer-events-none text-center">
             <p className="text-[9px] uppercase tracking-[0.4em] font-bold mb-2">Navigator Active</p>
             <div className="flex gap-2 justify-center">
                <span className="px-2 py-1 bg-white/10 rounded border border-white/20 text-[8px] animate-pulse">SPACE TO BOOST</span>
             </div>
          </div>
        </>
      )}
    </div>
  );
}
