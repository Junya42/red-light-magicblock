"use client";
import { useState, useEffect, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { FindComponentPda, Session } from "@magicblock-labs/bolt-sdk";
import { PricePoint } from "../hooks/useSolPrice";
import { startGame as sendStartGame, movePlayer as sendMovePlayer, checkPrice as sendCheckPrice } from "../lib/bolt-actions";
import {
  GAME_CONFIG_COMPONENT,
  PLAYER_STATE_COMPONENT,
  PLAYER_REGISTRY_COMPONENT,
  LEADERBOARD_COMPONENT,
} from "../lib/program-ids";
import Image from "next/image";

const PLAYER_SIZE = 65;
const DOLL_SIZE = 110;
const CHECK_PRICE_INTERVAL_MS = 3_000;
const MOVE_INTERVAL_MS = 80;

const DEFAULT_PYTH_PDA = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");

interface LobbyPlayer {
  name: string;
  skin: number;
  pubkey: string;
}

interface OtherPlayer {
  name: string;
  skin: number;
  y: number;
  prevY: number;
  alive: boolean;
  finished: boolean;
  xPos: number; // fixed random X position on screen
  statePda: string;
}

// Deterministic "random" X from pubkey string
function hashToX(pubkey: string, fieldW: number): number {
  let h = 0;
  for (let i = 0; i < pubkey.length; i++) h = ((h << 5) - h + pubkey.charCodeAt(i)) | 0;
  const margin = PLAYER_SIZE;
  return margin + Math.abs(h % (fieldW - margin * 2));
}

interface Props {
  price: number | null;
  history: PricePoint[];
  skin?: number;
  playerName?: string;
  onBack?: () => void;
  session?: Session | null;
  worldPda?: PublicKey | null;
  gameEntityPda?: PublicKey | null;
  playerEntityPda?: PublicKey | null;
  erConnection?: Connection | null;
  pythPricePda?: PublicKey;
  gameConfigPda?: PublicKey | null; // direct PDA for spectate mode
}

// ─── Parse on-chain data ───

function parsePlayerState(data: Buffer) {
  if (data.length < 78) return null;
  // disc(8) + authority(32) + alive(1) + finished(1) + finish_time(i64=8) + y(u16=2) + name([u8;16]) + name_len(u8=1) + last_move_slot(u64=8) + skin(u8=1)
  // offsets: 8=authority, 40=alive, 41=finished, 42=finish_time, 50=y, 52=name, 68=name_len, 69=last_move_slot, 77=skin
  const nameLen = data.readUInt8(68);
  const nameBytes = data.slice(52, 52 + Math.min(nameLen, 16));
  return {
    authority: new PublicKey(data.slice(8, 40)),
    alive: data.readUInt8(40) === 1,
    finished: data.readUInt8(41) === 1,
    y: data.readUInt16LE(50),
    name: new TextDecoder().decode(nameBytes),
    nameLen,
    skin: data.readUInt8(77),
  };
}

function parsePlayerRegistry(data: Buffer) {
  if (data.length < 649) return null;
  const count = data.readUInt8(648);
  const playerStates: PublicKey[] = [];
  for (let i = 0; i < count; i++) {
    playerStates.push(new PublicKey(data.slice(328 + i * 32, 328 + i * 32 + 32)));
  }
  return { count, playerStates };
}

function parseLeaderboard(data: Buffer): { entries: string[]; count: number } | null {
  // disc(8) + entries(10 * 32 = 320) + count(1) + bolt_metadata(32)
  if (data.length < 329) return null;
  const count = data.readUInt8(328);
  const entries: string[] = [];
  for (let i = 0; i < count && i < 10; i++) {
    const pubkeyBytes = data.slice(8 + i * 32, 8 + i * 32 + 32);
    entries.push(new PublicKey(pubkeyBytes).toBase58());
  }
  return { entries, count };
}

function parseGameConfig(data: Buffer) {
  if (data.length < 51) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    status: data.readUInt8(8),
    activePlayers: data.readUInt8(9),
    light: data.readUInt8(10),
    lastPrice: Number(view.getBigUint64(11, true)),
    lobbyEnd: Number(view.getBigInt64(43, true)),
  };
}

export default function Game({
  price, history, skin = 1, playerName = "Player", onBack,
  session, worldPda, gameEntityPda, playerEntityPda, erConnection,
  pythPricePda = DEFAULT_PYTH_PDA, gameConfigPda: gameConfigPdaProp,
}: Props) {
  const isSpectate = !session;
  // In normal mode, derive PDAs from entity. In spectate mode, use direct PDA.
  const resolvedGameConfigPda = gameConfigPdaProp
    || (gameEntityPda ? FindComponentPda({ componentId: GAME_CONFIG_COMPONENT, entity: gameEntityPda }) : null);
  const validGameEntity = gameEntityPda && gameEntityPda.toBase58() !== PublicKey.default.toBase58() ? gameEntityPda : null;
  const resolvedRegistryPda = validGameEntity
    ? FindComponentPda({ componentId: PLAYER_REGISTRY_COMPONENT, entity: validGameEntity })
    : null;
  const resolvedLeaderboardPda = validGameEntity
    ? FindComponentPda({ componentId: LEADERBOARD_COMPONENT, entity: validGameEntity })
    : null;
  const fieldRef = useRef<HTMLDivElement>(null);
  const [fieldW, setFieldW] = useState(800);
  const [fieldH, setFieldH] = useState(600);

  useEffect(() => {
    const measure = () => {
      if (fieldRef.current) {
        setFieldW(fieldRef.current.clientWidth);
        setFieldH(fieldRef.current.clientHeight);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Lines at fixed fractions of screen height
  const FINISH_LINE_Y = fieldH * (2 / 9);  // 2/9 = finish (top area)
  const START_LINE_Y = fieldH - 30;        // bottom of screen = start

  // ─── State ───
  const [gameStatus, setGameStatus] = useState<"lobby" | "playing" | "ended">("lobby");
  const [light, setLight] = useState<"green" | "red">("green");
  const [onChainY, setOnChainY] = useState(0); // 0-200 from chain
  const [playerAlive, setPlayerAlive] = useState(true);
  const [playerFinished, setPlayerFinished] = useState(false);
  const [keysDown, setKeysDown] = useState<Set<string>>(new Set());
  const [isMoving, setIsMoving] = useState(false);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyCountdown, setLobbyCountdown] = useState(40);
  const [lobbyEnd, setLobbyEnd] = useState(0);
  const [startGameSent, setStartGameSent] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [otherPlayers, setOtherPlayers] = useState<OtherPlayer[]>([]);
  const [leaderboard, setLeaderboard] = useState<string[]>([]); // pubkeys in finish order
  const gameStartRef = useRef(0);
  const movePendingRef = useRef(false);
  const otherSubsRef = useRef<number[]>([]);

  // Responsive scale: 1.0 on desktop (800+), 0.85 min on mobile
  const scale = Math.max(0.85, Math.min(1, fieldW / 800));

  // Map on-chain Y (0=start at 7/9, 200=finish at 0/9) to screen Y
  const screenY = START_LINE_Y - (onChainY / 200) * (START_LINE_Y - FINISH_LINE_Y);
  const playerX = fieldW / 2;
  const pSize = PLAYER_SIZE * scale;
  const dSize = DOLL_SIZE * scale;

  // ─── Subscribe to GameConfig on ER ───
  useEffect(() => {
    if (!erConnection || !resolvedGameConfigPda) return;
    const pda = resolvedGameConfigPda;

    const handleConfig = (data: Buffer) => {
      const cfg = parseGameConfig(data);
      if (!cfg) return;
      setLobbyEnd(cfg.lobbyEnd);
      setLight(cfg.light === 1 ? "red" : "green");
      if (cfg.lastPrice > 0) setLastPrice(cfg.lastPrice / 1e8);
      if (cfg.status === 1) {
        setGameStatus(prev => {
          if (prev !== "playing") gameStartRef.current = Date.now();
          return "playing";
        });
      }
    };

    erConnection.getAccountInfo(pda).then(info => {
      if (info) handleConfig(info.data as Buffer);
    });
    const subId = erConnection.onAccountChange(pda, (info) => handleConfig(info.data as Buffer));
    return () => { erConnection.removeAccountChangeListener(subId); };
  }, [erConnection, resolvedGameConfigPda]);

  // ─── Subscribe to own PlayerState on ER ───
  useEffect(() => {
    if (!erConnection || !playerEntityPda) return;
    const pda = FindComponentPda({ componentId: PLAYER_STATE_COMPONENT, entity: playerEntityPda });

    const subId = erConnection.onAccountChange(pda, (info) => {
      const ps = parsePlayerState(info.data as Buffer);
      if (!ps) return;
      setOnChainY(ps.y);
      setPlayerAlive(ps.alive);
      setPlayerFinished(ps.finished);
      if (!ps.alive || ps.finished) setGameStatus("ended");
    });
    return () => { erConnection.removeAccountChangeListener(subId); };
  }, [erConnection, playerEntityPda]);

  // ─── Subscribe to PlayerRegistry on ER → discover players + subscribe to their state ───
  useEffect(() => {
    if (!erConnection || !resolvedRegistryPda) return;
    const pda = resolvedRegistryPda;
    const myAuthority = session?.signer?.publicKey?.toBase58() || playerEntityPda?.toBase58() || "";

    const processRegistry = async (playerStatePdas: PublicKey[]) => {
      // Batch fetch all player states in ONE call instead of N sequential calls
      const players: LobbyPlayer[] = [];
      const others: OtherPlayer[] = [];
      try {
        const infos = await erConnection.getMultipleAccountsInfo(playerStatePdas);
        for (let i = 0; i < playerStatePdas.length; i++) {
          const info = infos[i];
          if (!info) continue;
          const ps = parsePlayerState(info.data as Buffer);
          if (!ps) continue;
          const statePda = playerStatePdas[i];
          players.push({ name: ps.name || "???", skin: ps.skin || 1, pubkey: ps.authority.toBase58() });
          const myStatePda = playerEntityPda ? FindComponentPda({ componentId: PLAYER_STATE_COMPONENT, entity: playerEntityPda }).toBase58() : null;
          if (!myStatePda || statePda.toBase58() !== myStatePda) {
            others.push({
              name: ps.name || "???",
              skin: ps.skin || 1,
              y: ps.y,
              prevY: ps.y,
              alive: ps.alive,
              finished: ps.finished,
              xPos: hashToX(statePda.toBase58(), fieldW),
              statePda: statePda.toBase58(),
            });
          }
        }
      } catch (err) { console.warn("processRegistry fetch failed:", err); }
      setLobbyPlayers(players);
      setOtherPlayers(others);

      // Unsubscribe old subs
      for (const s of otherSubsRef.current) {
        erConnection.removeAccountChangeListener(s);
      }
      otherSubsRef.current = [];

      // Subscribe to each other player's state for live Y updates
      const myStatePda = playerEntityPda ? FindComponentPda({ componentId: PLAYER_STATE_COMPONENT, entity: playerEntityPda }).toBase58() : null;
      for (const statePda of playerStatePdas) {
        if (myStatePda && statePda.toBase58() === myStatePda) continue;
        const subId = erConnection.onAccountChange(statePda, (info) => {
          const ps = parsePlayerState(info.data as Buffer);
          if (!ps) return;
          setOtherPlayers(prev => prev.map(op =>
            op.statePda === statePda.toBase58()
              ? { ...op, prevY: op.y, y: ps.y, alive: ps.alive, finished: ps.finished }
              : op
          ));
        });
        otherSubsRef.current.push(subId);
      }
    };

    erConnection.getAccountInfo(pda).then(info => {
      if (!info) return;
      const reg = parsePlayerRegistry(info.data as Buffer);
      if (reg && reg.count > 0) processRegistry(reg.playerStates);
    });
    const subId = erConnection.onAccountChange(pda, (accountInfo) => {
      const reg = parsePlayerRegistry(accountInfo.data as Buffer);
      if (reg && reg.count > 0) processRegistry(reg.playerStates);
    });
    return () => {
      erConnection.removeAccountChangeListener(subId);
      for (const s of otherSubsRef.current) erConnection.removeAccountChangeListener(s);
      otherSubsRef.current = [];
    };
  }, [erConnection, resolvedRegistryPda, playerEntityPda, fieldW]);

  // ─── Subscribe to Leaderboard on ER ───
  useEffect(() => {
    if (!erConnection || !resolvedLeaderboardPda) return;
    const pda = resolvedLeaderboardPda;

    const handleLeaderboard = (data: Buffer) => {
      const lb = parseLeaderboard(data);
      if (lb) setLeaderboard(lb.entries);
    };

    erConnection.getAccountInfo(pda).then(info => {
      if (info) handleLeaderboard(info.data as Buffer);
    }).catch(() => {});
    const subId = erConnection.onAccountChange(pda, (info) => handleLeaderboard(info.data as Buffer));
    return () => { erConnection.removeAccountChangeListener(subId); };
  }, [erConnection, resolvedLeaderboardPda]);

  // ─── Lobby countdown from on-chain lobby_end ───
  useEffect(() => {
    if (gameStatus !== "lobby" || lobbyEnd === 0) return;
    const id = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setLobbyCountdown(Math.max(0, lobbyEnd - now));
    }, 200);
    return () => clearInterval(id);
  }, [gameStatus, lobbyEnd]);

  // ─── Auto-send startGame when lobby ends ───
  useEffect(() => {
    if (gameStatus !== "lobby" || lobbyCountdown > 0 || startGameSent) return;
    if (!session || !worldPda || !gameEntityPda || !erConnection) return;

    setStartGameSent(true);
    console.log("Lobby over — sending start-game...");
    sendStartGame(erConnection, session, worldPda, gameEntityPda, pythPricePda)
      .then(() => console.log("start-game confirmed!"))
      .catch((e) => { console.error("start-game failed:", e); setStartGameSent(false); });
  }, [gameStatus, lobbyCountdown, startGameSent, session, worldPda, gameEntityPda, erConnection, pythPricePda]);

  // ─── checkPrice interval (every 3s during playing) ───
  useEffect(() => {
    if (gameStatus !== "playing") return;
    if (!session || !worldPda || !gameEntityPda || !erConnection) return;

    const id = setInterval(() => {
      sendCheckPrice(erConnection, session, worldPda, gameEntityPda, pythPricePda)
        .catch((e) => console.warn("checkPrice:", e.message));
    }, CHECK_PRICE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [gameStatus, session, worldPda, gameEntityPda, erConnection, pythPricePda]);

  // ─── Keyboard (only W / ArrowUp) ───
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "w", "z"].includes(e.key)) {
        e.preventDefault();
        setKeysDown(prev => new Set(prev).add(e.key));
      }
    };
    const onUp = (e: KeyboardEvent) => {
      setKeysDown(prev => { const n = new Set(prev); n.delete(e.key); return n; });
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);

  // ─── Send movePlayer on-chain when key held (throttled) ───
  useEffect(() => {
    if (gameStatus !== "playing" || !playerAlive || playerFinished) return;
    if (!session || !worldPda || !gameEntityPda || !playerEntityPda || !erConnection) return;

    const hasUp = keysDown.has("ArrowUp") || keysDown.has("w") || keysDown.has("z");
    setIsMoving(hasUp);
    if (!hasUp) return;

    // Send one immediately
    if (!movePendingRef.current) {
      movePendingRef.current = true;
      sendMovePlayer(erConnection, session, worldPda, playerEntityPda, gameEntityPda)
        .catch((e) => console.warn("movePlayer:", e.message))
        .finally(() => { movePendingRef.current = false; });
    }

    const id = setInterval(() => {
      if (movePendingRef.current) return;
      movePendingRef.current = true;
      sendMovePlayer(erConnection, session, worldPda, playerEntityPda, gameEntityPda)
        .catch((e) => console.warn("movePlayer:", e.message))
        .finally(() => { movePendingRef.current = false; });
    }, MOVE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [gameStatus, keysDown, playerAlive, playerFinished, session, worldPda, gameEntityPda, playerEntityPda, erConnection]);

  const elapsed = gameStatus !== "lobby" ? ((Date.now() - gameStartRef.current) / 1000).toFixed(1) : "0";

  // Resolve leaderboard pubkeys to player names
  const leaderboardNames = leaderboard.map((pubkey, i) => {
    const player = lobbyPlayers.find(p => p.pubkey === pubkey);
    return { rank: i + 1, name: player?.name || pubkey.slice(0, 6) + "...", skin: player?.skin || 1, pubkey };
  });

  return (
    <div className="flex flex-col items-center gap-4 w-full h-full flex-1">
      {/* HUD — pixel card top right */}
      <div className="absolute top-1 right-1 md:top-2 md:right-2 z-50 p-2 md:p-4 flex flex-col gap-0 items-center justify-center" style={{ imageRendering: "pixelated", width: fieldW < 600 ? 150 : 180, height: fieldW < 600 ? 160 : 190, backgroundImage: "url('/CARD.png')", backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" }}>
        <div className="text-gray-600 text-xs md:text-sm">SOL/USD</div>

        <div className="flex items-baseline gap-1">
          <span className="text-blue-700 text-xs md:text-lg">last:</span>
          <span className="text-gray-800 text-sm md:text-xl">{lastPrice ? lastPrice.toFixed(2) : "..."}</span>
        </div>

        <div className={`text-lg md:text-2xl ${light === "red" ? "text-red-600" : "text-green-600"}`}>
          {light === "red" ? "▼ RED" : "▲ GREEN"}
        </div>

        <div className="flex items-baseline gap-1">
          <span className="text-rose-600 text-xs md:text-lg">now:</span>
          <span className="text-gray-800 text-sm md:text-xl">{price?.toFixed(2) ?? "..."}</span>
        </div>

        {gameStatus === "playing" && !isSpectate && (
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-gray-500 text-[10px]">Y:</span>
            <span className="text-gray-800 text-sm md:text-sm">{onChainY}/200</span>
          </div>
        )}

        {(gameStatus === "ended" || isSpectate) && onBack && (
          <button
            onClick={onBack}
            className="mt-1 px-3 py-1 md:mt-2 md:px-4 md:py-2 bg-gray-700 hover:bg-gray-600 border-2 border-gray-500 text-white text-sm md:text-sm transition"
          >
            {isSpectate ? "GO BACK" : "MENU"}
          </button>
        )}
      </div>

      {/* Game field — fullscreen */}
      <div ref={fieldRef} className="relative overflow-hidden flex-1 w-full">
        <Image src="/BACKGROUND.png" alt="field" fill className="object-fill" priority />

        {/* Finish line (2/9) — checkerboard pattern */}
        <div className="absolute left-0 w-full z-10" style={{
          top: FINISH_LINE_Y - 12,
          height: 24,
          backgroundImage: `repeating-conic-gradient(#000 0% 25%, #fff 0% 50%)`,
          backgroundSize: "24px 24px",
        }} />


        {/* Doll + lights — above finish line (0/9) */}
        <div
          className="absolute z-20 transition-transform duration-300"
          style={{ left: fieldW / 2 - dSize / 2, top: FINISH_LINE_Y - dSize * 1.5 - 10, width: dSize, height: dSize * 1.5 }}
        >
          <Image
            src={light === "red" ? "/girls front.png" : "/girls back.png"}
            alt="doll"
            fill
            className="object-contain"
          />
        </div>
        {/* Light right */}
        <div
          className="absolute z-19"
          style={{ left: fieldW / 2 + dSize / 2, top: FINISH_LINE_Y - 200 * scale - 10, width: 140 * scale, height: 200 * scale }}
        >
          <Image
            src={light === "red" ? "/red lights.png" : "/green lights.png"}
            alt="light"
            fill
            className="object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
        {/* Light left (mirrored) */}
        <div
          className="absolute z-19"
          style={{ left: fieldW / 2 - dSize / 2 - 140 * scale, top: FINISH_LINE_Y - 200 * scale - 10, width: 140 * scale, height: 200 * scale, transform: "scaleX(-1)" }}
        >
          <Image
            src={light === "red" ? "/red lights.png" : "/green lights.png"}
            alt="light"
            fill
            className="object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        </div>

        {/* Other players */}
        {gameStatus === "playing" && otherPlayers.map((op) => {
          const opScreenY = START_LINE_Y - (op.y / 200) * (START_LINE_Y - FINISH_LINE_Y);
          const opMoving = op.y !== op.prevY;
          const opSprite = !op.alive ? `/props_${op.skin}_dead.png` : opMoving ? `/props_${op.skin}_back.png` : `/props_${op.skin}_front.png`;
          const opHop = (opMoving && op.alive) ? (Math.floor(Date.now() / 200) % 2 === 0 ? -4 : 0) : 0;
          return (
            <div key={op.statePda} className="absolute z-25" style={{ left: op.xPos - pSize / 2, top: opScreenY - pSize + opHop, width: pSize, height: pSize * 1.2 }}>
              <Image src={opSprite} alt={op.name} fill className="object-contain" style={{ opacity: 0.85 }} />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm text-white font-bold" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
                {op.name}
              </div>
            </div>
          );
        })}

        {/* My player sprite (hidden in spectate) */}
        {!isSpectate && (() =>{
          let sprite = `/props_${skin}_front.png`;
          if (!playerAlive) sprite = `/props_${skin}_dead.png`;
          else if (playerFinished) sprite = `/props_${skin}_front.png`;
          else if (isMoving) sprite = `/props_${skin}_back.png`;

          const hopOffset = (isMoving && playerAlive && !playerFinished) ? (Math.floor(Date.now() / 200) % 2 === 0 ? -4 : 0) : 0;

          return (
            <div
              className="absolute z-30"
              style={{ left: playerX - pSize / 2, top: screenY - pSize + hopOffset, width: pSize, height: pSize * 1.2 }}
            >
              <Image src={sprite} alt="player" fill className="object-contain" />
              {/* My name in pink/violet */}
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-bold" style={{ color: "#e879f9", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
                {playerName}
              </div>
              <div
                className="absolute rounded-full"
                style={{ bottom: 8, left: '15%', width: '70%', height: 8, background: 'radial-gradient(ellipse, rgba(0,0,0,0.35) 0%, transparent 70%)' }}
              />
            </div>
          );
        })()}

        {/* Lobby overlay */}
        {gameStatus === "lobby" && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center">
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative z-10 flex flex-col items-center gap-6">
              <div className="text-4xl text-white drop-shadow-lg">
                LOBBY
              </div>

              <div className="flex flex-col items-center">
                <div className="text-8xl text-yellow-400 drop-shadow-lg" style={{
                  textShadow: "0 0 20px rgba(250, 204, 21, 0.5), 0 4px 0 #b45309"
                }}>
                  {lobbyCountdown}
                </div>
                <div className="text-lg text-white/60 mt-2">
                  {lobbyCountdown > 0 ? "GAME STARTS IN" : "STARTING..."}
                </div>
              </div>

              {/* Player list — real players from chain */}
              <div className="flex flex-col items-center gap-3 mt-4 relative" style={{ backgroundImage: "url('/lobby_player.png')", backgroundSize: "100% 100%", backgroundRepeat: "no-repeat", padding: "40px 50px", minWidth: 380, minHeight: 200 }}>
                <div className="text-xl text-white font-bold" style={{ textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>
                  PLAYERS ({lobbyPlayers.length}/10)
                </div>
                <div className="flex flex-wrap gap-6 justify-center">
                  {lobbyPlayers.map((p, i) => (
                    <div key={i} className="flex flex-col items-center gap-2">
                      <div className="relative" style={{ width: 70, height: 84 }}>
                        <Image
                          src={`/props_${p.skin}_front.png`}
                          alt={p.name}
                          fill
                          className="object-contain"
                          style={{ imageRendering: "pixelated" }}
                        />
                      </div>
                      <span className="text-base text-white font-bold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
                        {p.name}
                      </span>
                    </div>
                  ))}
                  {lobbyPlayers.length === 0 && (
                    <div className="text-sm text-gray-500">Waiting for players...</div>
                  )}
                </div>
              </div>

              {/* Share button */}
              <button
                onClick={() => {
                  const url = `${window.location.origin}?join=${resolvedGameConfigPda?.toBase58()}&world=${worldPda?.toBase58()}&entity=${gameEntityPda?.toBase58()}`;
                  navigator.clipboard.writeText(url);
                  setShareCopied(true);
                  setTimeout(() => setShareCopied(false), 2000);
                }}
                className="px-6 py-3 bg-cyan-700 hover:bg-cyan-600 border-2 border-cyan-900 text-white text-lg transition"
              >
                {shareCopied ? "LINK COPIED!" : "SHARE GAME"}
              </button>

              <div className="text-base md:text-xl text-yellow-300 font-bold mt-3" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 20px rgba(250,204,21,0.3)" }}>
                {fieldW < 600 ? "Push the button to move — DON'T MOVE during RED LIGHT" : "Press W / Z / Arrow Up to move — DON\u0027T MOVE during RED LIGHT"}
              </div>
            </div>
          </div>
        )}

        {/* Controls hint during playing — hidden on mobile */}
        {gameStatus === "playing" && fieldW >= 600 && (
          <div className="absolute bottom-4 left-0 w-full text-center z-30">
            <span className="text-lg text-yellow-300 font-bold" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 20px rgba(250,204,21,0.3)" }}>
              Press W / Z / Arrow Up — DON&apos;T MOVE during RED LIGHT
            </span>
          </div>
        )}

        {/* Mobile move button */}
        {gameStatus === "playing" && fieldW < 600 && (
          <div className="absolute z-50 flex flex-col items-center" style={{ bottom: 20, right: 20 }}>
            <span className="text-sm text-yellow-300 font-bold mb-2" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.9)" }}>PUSH TO MOVE</span>
            <div
              className="relative select-none"
              style={{ width: 160, height: 95, touchAction: "none" }}
              onTouchStart={(e) => { e.preventDefault(); setKeysDown(prev => new Set(prev).add("w")); }}
              onTouchEnd={(e) => { e.preventDefault(); setKeysDown(prev => { const n = new Set(prev); n.delete("w"); return n; }); }}
              onMouseDown={() => setKeysDown(prev => new Set(prev).add("w"))}
              onMouseUp={() => setKeysDown(prev => { const n = new Set(prev); n.delete("w"); return n; })}
            >
              <Image
                src={keysDown.has("w") ? "/BOUTON_PRESSED.png" : "/BOUTON.png"}
                alt="move"
                fill
                className="object-contain"
                style={{ imageRendering: "pixelated" }}
                draggable={false}
              />
            </div>
          </div>
        )}


        {/* Leaderboard — top left, visible when there are finishers */}
        {(gameStatus === "playing" || gameStatus === "ended") && leaderboardNames.length > 0 && (
          <div className="absolute top-1 left-1 md:top-3 md:left-3 z-40 md:bg-black/60 md:border md:border-gray-700 px-4 py-3 md:px-3 md:py-2">
            <div className="text-base md:text-xs text-yellow-400 font-bold mb-2 md:mb-1">LEADERBOARD</div>
            {leaderboardNames.map((e) => {
              const isMe = e.name === playerName;
              return (
                <div key={e.pubkey} className="flex items-center gap-3 md:gap-2 py-2 md:py-1">
                  <span className="text-yellow-400 text-lg md:text-sm w-8 md:w-6">#{e.rank}</span>
                  <div className="relative" style={{ width: fieldW < 600 ? 40 : 28, height: fieldW < 600 ? 48 : 34 }}>
                    <Image src={`/props_${e.skin}_front.png`} alt={e.name} fill className="object-contain" style={{ imageRendering: "pixelated" }} />
                  </div>
                  <span className={`text-lg md:text-sm font-bold ${isMe ? "text-fuchsia-400" : "text-white"}`} style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{e.name}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Game over overlay */}
        {gameStatus === "ended" && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none">
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative z-10 flex flex-col items-center gap-3 pointer-events-auto">
              <div className={`text-5xl font-bold drop-shadow-lg ${playerFinished ? "text-green-400" : "text-red-500"}`}>
                {playerFinished ? "YOU WIN!" : "ELIMINATED"}
              </div>
              <div className="text-white/70 text-sm drop-shadow">{elapsed}s</div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
