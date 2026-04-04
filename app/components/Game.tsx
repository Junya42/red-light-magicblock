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
  const resolvedRegistryPda = gameEntityPda
    ? FindComponentPda({ componentId: PLAYER_REGISTRY_COMPONENT, entity: gameEntityPda })
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

  const FINISH_LINE_Y = 40;

  // ─── State ───
  const [gameStatus, setGameStatus] = useState<"lobby" | "playing" | "ended">("lobby");
  const [light, setLight] = useState<"green" | "red">("green");
  const [onChainY, setOnChainY] = useState(0); // 0-300 from chain
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
  const gameStartRef = useRef(0);
  const movePendingRef = useRef(false);
  const otherSubsRef = useRef<number[]>([]);

  // Map on-chain Y (0=start, 300=finish) to screen Y
  const START_Y = fieldH - 60;
  const screenY = START_Y - (onChainY / 300) * (START_Y - FINISH_LINE_Y);
  const playerX = fieldW / 2;

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
          if (playerEntityPda && statePda.toBase58() !== FindComponentPda({ componentId: PLAYER_STATE_COMPONENT, entity: playerEntityPda }).toBase58()) {
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
      } catch { /* ER might be rate-limited */ }
      setLobbyPlayers(players);
      setOtherPlayers(others);

      // Unsubscribe old subs
      for (const s of otherSubsRef.current) {
        erConnection.removeAccountChangeListener(s);
      }
      otherSubsRef.current = [];

      // Subscribe to each other player's state for live Y updates
      for (const statePda of playerStatePdas) {
        if (playerEntityPda && statePda.toBase58() === FindComponentPda({ componentId: PLAYER_STATE_COMPONENT, entity: playerEntityPda }).toBase58()) continue;
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

  return (
    <div className="flex flex-col items-center gap-4 w-full h-full flex-1">
      {/* HUD — pixel card top right */}
      <div className="absolute top-2 right-2 z-50 p-4 flex flex-col gap-0 items-center justify-center" style={{ imageRendering: "pixelated", width: 180, height: 190, backgroundImage: "url('/CARD.png')", backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" }}>
        <div className="text-gray-600 text-sm">SOL/USD</div>

        <div className="flex items-baseline gap-1">
          <span className="text-blue-700 text-lg">last:</span>
          <span className="text-gray-800 text-xl">{lastPrice?.toFixed(4) ?? "..."}</span>
        </div>

        <div className={`text-2xl ${light === "red" ? "text-red-600" : "text-green-600"}`}>
          {light === "red" ? "▼ RED" : "▲ GREEN"}
        </div>

        <div className="flex items-baseline gap-1">
          <span className="text-rose-600 text-lg">now:</span>
          <span className="text-gray-800 text-xl">{price?.toFixed(4) ?? "..."}</span>
        </div>

        {gameStatus === "playing" && !isSpectate && (
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-gray-500 text-[10px]">Y:</span>
            <span className="text-gray-800 text-sm">{onChainY}/300</span>
          </div>
        )}
        {isSpectate && (
          <div className="text-cyan-700 text-xs mt-1 font-bold">SPECTATING</div>
        )}

        {(gameStatus === "ended" || isSpectate) && onBack && (
          <button
            onClick={onBack}
            className="mt-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 border-2 border-gray-500 text-white text-sm transition"
          >
            {isSpectate ? "GO BACK" : "MENU"}
          </button>
        )}
      </div>

      {/* Game field — fullscreen */}
      <div ref={fieldRef} className="relative overflow-hidden flex-1 w-full">
        <Image src="/BACKGROUND.png" alt="field" fill className="object-fill" priority />

        {/* Finish line label */}
        <div className="absolute top-8 left-0 w-full text-center text-xs text-white/50 font-mono z-10">
          FINISH
        </div>

        {/* Doll + lights */}
        <div
          className="absolute z-20 transition-transform duration-300"
          style={{ left: fieldW / 2 - DOLL_SIZE / 2, top: 0, width: DOLL_SIZE, height: DOLL_SIZE * 1.5 }}
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
          style={{ left: fieldW / 2 + DOLL_SIZE / 2 + 10, top: 0, width: 140, height: 200 }}
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
          style={{ left: fieldW / 2 - DOLL_SIZE / 2 - 150, top: 0, width: 140, height: 200, transform: "scaleX(-1)" }}
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
          const opScreenY = START_Y - (op.y / 300) * (START_Y - FINISH_LINE_Y);
          const opMoving = op.y !== op.prevY;
          const opSprite = !op.alive ? `/props_${op.skin}_dead.png` : opMoving ? `/props_${op.skin}_back.png` : `/props_${op.skin}_front.png`;
          const opHop = (opMoving && op.alive) ? (Math.floor(Date.now() / 200) % 2 === 0 ? -4 : 0) : 0;
          return (
            <div key={op.statePda} className="absolute z-25" style={{ left: op.xPos - PLAYER_SIZE / 2, top: opScreenY - PLAYER_SIZE + opHop, width: PLAYER_SIZE, height: PLAYER_SIZE * 1.2 }}>
              <Image src={opSprite} alt={op.name} fill className="object-contain" style={{ opacity: 0.85 }} />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm text-white font-bold" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}>
                {op.name}
              </div>
            </div>
          );
        })}

        {/* My player sprite */}
        {(() => {
          let sprite = `/props_${skin}_front.png`;
          if (!playerAlive) sprite = `/props_${skin}_dead.png`;
          else if (playerFinished) sprite = `/props_${skin}_front.png`;
          else if (isMoving) sprite = `/props_${skin}_back.png`;

          const hopOffset = (isMoving && playerAlive && !playerFinished) ? (Math.floor(Date.now() / 200) % 2 === 0 ? -4 : 0) : 0;

          return (
            <div
              className="absolute z-30"
              style={{ left: playerX - PLAYER_SIZE / 2, top: screenY - PLAYER_SIZE + hopOffset, width: PLAYER_SIZE, height: PLAYER_SIZE * 1.2 }}
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
                  const url = `${window.location.origin}?world=${worldPda?.toBase58()}&game=${gameEntityPda?.toBase58()}`;
                  navigator.clipboard.writeText(url);
                  setShareCopied(true);
                  setTimeout(() => setShareCopied(false), 2000);
                }}
                className="px-6 py-3 bg-cyan-700 hover:bg-cyan-600 border-2 border-cyan-900 text-white text-lg transition"
              >
                {shareCopied ? "LINK COPIED!" : "SHARE GAME"}
              </button>

              <div className="text-xl text-yellow-300 font-bold mt-3" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 20px rgba(250,204,21,0.3)" }}>
                Press W / Z / Arrow Up to move — DON&apos;T MOVE during RED LIGHT
              </div>
            </div>
          </div>
        )}

        {/* Controls hint during playing */}
        {gameStatus === "playing" && (
          <div className="absolute bottom-4 left-0 w-full text-center z-30">
            <span className="text-lg text-yellow-300 font-bold" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 20px rgba(250,204,21,0.3)" }}>
              Press W / Z / Arrow Up — DON&apos;T MOVE during RED LIGHT
            </span>
          </div>
        )}

        {/* Game over text */}
        {gameStatus === "ended" && (
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-40 text-center">
            <div className={`text-5xl font-bold drop-shadow-lg ${playerFinished ? "text-green-400" : "text-red-500"}`}>
              {playerFinished ? "YOU WIN!" : "ELIMINATED"}
            </div>
            <div className="text-white/70 text-sm mt-2 drop-shadow">
              {elapsed}s
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
