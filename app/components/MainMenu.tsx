"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { Connection } from "@solana/web3.js";
import { GameListing, fetchAllGames } from "../lib/fetch-games";

const TOTAL_SKINS = 5;

interface Props {
  price: number | null;
  connection: Connection | null;
  erConnection?: Connection | null;
  onCreateGame: (skin: number, name: string) => void;
  onJoinGame: (gameId: string, skin: number, name: string) => void;
  onSpectateGame: (gameConfigPda: string) => void;
}

export default function MainMenu({ price, connection, erConnection, onCreateGame, onJoinGame, onSpectateGame }: Props) {
  const [playerName, setPlayerName] = useState("");
  const [selectedSkin, setSelectedSkin] = useState(1);
  const [games, setGames] = useState<GameListing[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!connection) return;
    setLoading(true);
    const list = await fetchAllGames(connection, erConnection);
    setGames(list);
    setLoading(false);
  };

  // Fetch games once on mount
  useEffect(() => {
    refresh();
  }, [connection]);

  return (
    <div className="min-h-screen w-screen flex flex-col items-center justify-center relative overflow-y-auto">
      {/* Background */}
      <div className="fixed inset-0" style={{
        backgroundImage: "url('/LOBBY.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        filter: "blur(6px) brightness(0.4)",
      }} />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-3 w-full max-w-xl px-4 py-8">

        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="text-6xl text-yellow-400" style={{
            textShadow: "0 0 30px rgba(250, 204, 21, 0.3), 0 6px 0 #92400e"
          }}>
            SOL
          </div>
          <div className="text-4xl text-white" style={{
            textShadow: "0 4px 0 #374151"
          }}>
            SURVIVORS
          </div>
          <div className="text-lg text-gray-400 mt-1">
            Price drops = Red light = Don&apos;t move
          </div>
        </div>

        {/* Skin selector */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => setSelectedSkin((s) => s <= 1 ? TOTAL_SKINS : s - 1)}
            className="text-3xl text-white/60 hover:text-white transition"
          >
            &lt;
          </button>
          <div className="relative" style={{ width: 100, height: 120 }}>
            <Image
              src={`/props_${selectedSkin}_front.png`}
              alt={`skin ${selectedSkin}`}
              fill
              className="object-contain"
              style={{ imageRendering: "pixelated" }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/props_1_front.png";
              }}
            />
          </div>
          <button
            onClick={() => setSelectedSkin((s) => s >= TOTAL_SKINS ? 1 : s + 1)}
            className="text-3xl text-white/60 hover:text-white transition"
          >
            &gt;
          </button>
        </div>
        <div className="text-sm text-gray-300">
          Skin #{selectedSkin}
        </div>

        {/* SOL Price */}
        <div className="text-lg text-gray-400">
          SOL/USD: <span className="text-cyan-400">${price?.toFixed(4) ?? "..."}</span>
        </div>

        {/* Name input */}
        <div className="w-full max-w-xs">
          <input
            type="text"
            placeholder="Enter your name..."
            maxLength={16}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full bg-black/50 border-2 border-gray-700 text-white px-4 py-3 text-center text-lg focus:outline-none focus:border-yellow-500 placeholder-gray-600"
          />
        </div>

        {/* Create Game button */}
        <button
          onClick={() => onCreateGame(selectedSkin, playerName)}
          disabled={!price || playerName.length === 0}
          className="w-full max-w-xs py-4 bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 border-2 border-green-900 disabled:border-gray-700 text-white text-xl transition"
          style={{ textShadow: "0 2px 0 rgba(0,0,0,0.3)" }}
        >
          CREATE GAME
        </button>

        {/* Game list */}
        <div className="w-full">
          <div className="flex items-center justify-center gap-3 mb-3">
            <span className="text-sm text-gray-300">— OR JOIN A GAME —</span>
            <button
              onClick={refresh}
              disabled={loading}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 border border-gray-600 text-white text-xs transition"
            >
              {loading ? "..." : "REFRESH"}
            </button>
          </div>

          {loading && (
            <div className="text-center text-gray-500 text-sm py-4">
              Loading games...
            </div>
          )}

          <div className="flex flex-col gap-2">
            {games.map((game) => {
              // Use on-chain status (from ER) to determine lobby vs playing
              const inLobby = game.status === 0;

              return (
                <div
                  key={game.pubkey}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/40 border border-gray-700"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      inLobby ? "bg-green-500 animate-pulse" : "bg-yellow-500"
                    }`} />
                    <span className="text-white text-sm">{game.pubkey.slice(0, 8)}...</span>
                    <span className="text-gray-400 text-xs">{game.activePlayers}/10</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {inLobby ? (
                      <>
                        <span className="text-yellow-400 text-xs mr-2">LOBBY</span>
                        <button
                          onClick={() => onJoinGame(game.pubkey, selectedSkin, playerName)}
                          disabled={playerName.length === 0}
                          className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 border border-green-900 disabled:border-gray-600 text-white text-xs transition"
                        >
                          JOIN
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => onSpectateGame(game.pubkey)}
                        className="px-3 py-1 bg-cyan-700 hover:bg-cyan-600 border border-cyan-900 text-white text-xs transition"
                      >
                        SPECTATE
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!loading && games.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-4">
              No games available — create one!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-[20px] text-gray-400 mt-4">
          Built on MagicBlock Ephemeral Rollups + Pyth Lazer + Bolt
        </div>
      </div>
    </div>
  );
}
