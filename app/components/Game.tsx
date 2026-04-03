"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { PricePoint } from "../hooks/useSolPrice";
import Image from "next/image";

const PLAYER_SIZE = 24;
const DOLL_SIZE = 170;
const MOVE_SPEED = 4;
const CHECK_INTERVAL_MS = 5_000;
const RED_DURATION_MS = 3_000;

interface Player {
  id: string;
  x: number;
  y: number;
  alive: boolean;
  finished: boolean;
  color: string;
}

interface Props {
  price: number | null;
  history: PricePoint[];
}

const PLAYER_COLORS = ["#22d3ee", "#a78bfa", "#f472b6", "#facc15", "#4ade80", "#fb923c"];

export default function Game({ price, history }: Props) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const [fieldW, setFieldW] = useState(800);
  const [fieldH, setFieldH] = useState(600);

  // Measure field on mount + resize
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

  const FINISH_Y = 40;
  const START_Y = fieldH - 60;

  const [gameState, setGameState] = useState<"lobby" | "playing" | "ended">("lobby");
  const [light, setLight] = useState<"green" | "red">("green");
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState(0);
  const [redUntil, setRedUntil] = useState(0);
  const [player, setPlayer] = useState<Player>({
    id: "local",
    x: 400,
    y: 540,
    alive: true,
    finished: false,
    color: PLAYER_COLORS[0],
  });
  const [keysDown, setKeysDown] = useState<Set<string>>(new Set());
  const [priceLog, setPriceLog] = useState<{ time: number; price: number; result: "up" | "down" }[]>([]);
  const animRef = useRef<number>(0);
  const gameStartRef = useRef(0);

  const startGame = useCallback(() => {
    if (!price) return;
    setGameState("playing");
    setLight("green");
    setLastPrice(price);
    setLastCheckTime(Date.now());
    setRedUntil(0);
    setPriceLog([]);
    setPlayer((p) => ({ ...p, x: fieldW / 2, y: START_Y, alive: true, finished: false }));
    gameStartRef.current = Date.now();
  }, [price]);

  // Keyboard
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(e.key)) {
        e.preventDefault();
        setKeysDown((prev) => new Set(prev).add(e.key));
      }
    };
    const onUp = (e: KeyboardEvent) => {
      setKeysDown((prev) => {
        const next = new Set(prev);
        next.delete(e.key);
        return next;
      });
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);

  // Price check logic
  useEffect(() => {
    if (gameState !== "playing" || !price) return;

    const now = Date.now();

    // Still in red light period
    if (now < redUntil) {
      setLight("red");
      return;
    }

    // Time for a new check?
    if (now - lastCheckTime >= CHECK_INTERVAL_MS) {
      if (lastPrice !== null) {
        if (price < lastPrice) {
          // Price dropped → RED LIGHT
          setLight("red");
          setRedUntil(now + RED_DURATION_MS);
          setPriceLog((prev) => [...prev, { time: now, price, result: "down" }]);
        } else {
          // Price same or up → GREEN LIGHT
          setLight("green");
          setPriceLog((prev) => [...prev, { time: now, price, result: "up" }]);
        }
      }
      setLastPrice(price);
      setLastCheckTime(now);
    }

    // Red light expired → back to green
    if (light === "red" && now >= redUntil && redUntil > 0) {
      setLight("green");
    }
  }, [price, gameState, lastCheckTime, lastPrice, redUntil, light]);

  // Game loop
  useEffect(() => {
    if (gameState !== "playing") return;

    const loop = () => {
      setPlayer((prev) => {
        if (!prev.alive || prev.finished) return prev;

        let dx = 0;
        let dy = 0;
        if (keysDown.has("ArrowUp") || keysDown.has("w")) dy -= MOVE_SPEED;
        if (keysDown.has("ArrowDown") || keysDown.has("s")) dy += MOVE_SPEED;
        if (keysDown.has("ArrowLeft") || keysDown.has("a")) dx -= MOVE_SPEED;
        if (keysDown.has("ArrowRight") || keysDown.has("d")) dx += MOVE_SPEED;

        const isMoving = dx !== 0 || dy !== 0;

        // RED LIGHT — moving = death
        if (light === "red" && isMoving) {
          return { ...prev, alive: false };
        }

        if (!isMoving) return prev;

        const newX = Math.max(PLAYER_SIZE / 2, Math.min(fieldW - PLAYER_SIZE / 2, prev.x + dx));
        const newY = Math.max(0, Math.min(fieldH, prev.y + dy));

        // Reached the top?
        if (newY <= FINISH_Y) {
          setGameState("ended");
          return { ...prev, x: newX, y: FINISH_Y, finished: true };
        }

        return { ...prev, x: newX, y: newY };
      });

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [gameState, keysDown, light]);

  // Death → end game
  useEffect(() => {
    if (!player.alive && gameState === "playing") {
      setGameState("ended");
    }
  }, [player.alive, gameState]);

  const elapsed = gameState !== "lobby" ? ((Date.now() - gameStartRef.current) / 1000).toFixed(1) : "0";

  return (
    <div className="flex flex-col items-center gap-4 w-full h-full flex-1">
      {/* HUD */}
      <div className="flex items-center gap-6">
        <div className="text-2xl font-mono">
          SOL/USD{" "}
          <span className="text-cyan-400 font-bold">
            {price ? `$${price.toFixed(4)}` : "..."}
          </span>
        </div>
        <div className={`px-4 py-1 rounded-full font-bold text-sm ${
          light === "green" ? "bg-green-500 text-black" : "bg-red-500 text-white animate-pulse"
        }`}>
          {light === "green" ? "GREEN LIGHT" : "RED LIGHT"}
        </div>
        {gameState === "lobby" && (
          <button
            onClick={startGame}
            disabled={!price}
            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 rounded-xl font-bold text-white transition"
          >
            Start
          </button>
        )}
        {gameState === "ended" && (
          <button
            onClick={startGame}
            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold text-white transition"
          >
            Retry
          </button>
        )}
      </div>

      {/* Game field — fullscreen */}
      <div
        ref={fieldRef}
        className="relative overflow-hidden flex-1 w-full"
      >
        {/* Background */}
        <Image
          src="/BACKGROUND.png"
          alt="field"
          fill
          className="object-cover"
          priority
        />

        {/* Finish line label */}
        <div className="absolute top-8 left-0 w-full text-center text-xs text-white/50 font-mono z-10">
          FINISH
        </div>

        {/* Doll */}
        <div
          className="absolute z-20 transition-transform duration-300"
          style={{
            left: fieldW / 2 - DOLL_SIZE / 2,
            top: -40,
            width: DOLL_SIZE,
            height: DOLL_SIZE * 1.5,
          }}
        >
          <Image
            src={light === "red" ? "/girls front.png" : "/girls back.png"}
            alt="doll"
            fill
            className="object-contain"
          />
        </div>

        {/* Player */}
        {player.alive && (
          <div
            className="absolute z-30 rounded-full border-2 transition-all duration-75"
            style={{
              left: player.x - PLAYER_SIZE / 2,
              top: player.y - PLAYER_SIZE / 2,
              width: PLAYER_SIZE,
              height: PLAYER_SIZE,
              backgroundColor: player.color,
              borderColor: "white",
              boxShadow: `0 0 8px ${player.color}`,
            }}
          />
        )}

        {/* Death marker */}
        {!player.alive && (
          <div
            className="absolute z-30 text-2xl"
            style={{ left: player.x - 12, top: player.y - 12 }}
          >
            💀
          </div>
        )}

        {/* Game over overlay */}
        {gameState === "ended" && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60">
            <div className="text-center">
              <div className={`text-4xl font-bold mb-2 ${player.finished ? "text-green-400" : "text-red-400"}`}>
                {player.finished ? "YOU WIN!" : "ELIMINATED"}
              </div>
              <div className="text-gray-400 font-mono text-sm">
                Time: {elapsed}s
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Price log */}
      {priceLog.length > 0 && (
        <div className="flex gap-2 flex-wrap max-w-full px-4">
          {priceLog.map((log, i) => (
            <div
              key={i}
              className={`px-2 py-1 rounded text-xs font-mono ${
                log.result === "up" ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
              }`}
            >
              ${log.price.toFixed(2)} {log.result === "up" ? "▲" : "▼"}
            </div>
          ))}
        </div>
      )}

      {/* Controls hint */}
      {gameState === "playing" && (
        <div className="text-xs text-gray-600 font-mono">
          Arrow keys or WASD to move — DON&apos;T MOVE during RED LIGHT
        </div>
      )}
    </div>
  );
}
