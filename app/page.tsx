"use client";
import { useState, useCallback, useMemo, useEffect } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import * as anchor from "@coral-xyz/anchor";
import Image from "next/image";
import { useSolPrice } from "./hooks/useSolPrice";
import MainMenu from "./components/MainMenu";
import Game from "./components/Game";
import { createAndJoinGame, joinExistingGame, resolveGameEntity, GameState } from "./lib/bolt-actions";
import { Session } from "@magicblock-labs/bolt-sdk";

const ER_RPC = process.env.NEXT_PUBLIC_ER_RPC || "http://localhost:7799";

function WalletMenu({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 4)}...${address.slice(-4)}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative cursor-pointer hover:scale-105 transition-transform"
      >
        <Image
          src="/WALLET_SELECTED.png"
          alt="Wallet"
          width={200}
          height={50}
          style={{ imageRendering: "pixelated" }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-white text-lg pl-10" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>
          {short}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 bg-black/90 border border-gray-700 flex flex-col min-w-[180px]">
          <button
            onClick={() => {
              navigator.clipboard.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 text-left"
          >
            {copied ? "Copied!" : "Copy address"}
          </button>
          <button
            onClick={() => { onDisconnect(); setOpen(false); }}
            className="px-4 py-2 text-sm text-red-400 hover:bg-gray-800 text-left"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { price, history } = useSolPrice();
  const { connection } = useConnection();
  const { publicKey, signAllTransactions, disconnect } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [skin, setSkin] = useState(1);
  const [playerName, setPlayerName] = useState("");
  const [pendingJoin, setPendingJoin] = useState<{gameConfigPda: string; worldPda: string; gameEntityPda: string} | null>(null);

  // Read ?join=&world=&entity= params from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join");
    const world = params.get("world");
    const entity = params.get("entity");
    if (join && world && entity) setPendingJoin({ gameConfigPda: join, worldPda: world, gameEntityPda: entity });
  }, []);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"" | "creating" | "joining">("");

  const erConnection = useMemo(() => new Connection(ER_RPC, "confirmed"), []);
  const { setVisible: setWalletModalVisible } = useWalletModal();

  // Set global Anchor provider for BOLT SDK
  useMemo(() => {
    if (anchorWallet) {
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      anchor.setProvider(provider);
    }
  }, [anchorWallet, connection]);

  const addLog = useCallback((msg: string) => {
    console.log(msg);
    setLog((prev) => [...prev.slice(-20), msg]);
  }, []);

  const handleCreateGame = useCallback(async (selectedSkin: number, name: string) => {
    if (!publicKey || !signAllTransactions) {
      addLog("Connect your wallet first!");
      return;
    }
    setLoading(true);
    setLog([]);
    setSkin(selectedSkin);
    setPlayerName(name);
    try {
      setPhase("creating");
      const { gameState: state, session: sess } = await createAndJoinGame(
        connection, erConnection, publicKey, signAllTransactions,
        name, selectedSkin, addLog,
      );
      setGameState(state);
      setSession(sess);

      addLog("Done! Entering lobby...");
      setScreen("game");
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
      console.error(e);
    }
    setLoading(false);
    setPhase("");
  }, [publicKey, signAllTransactions, connection, erConnection, addLog]);

  const handleJoinGame = useCallback(async (gameConfigPda: string, selectedSkin: number, name: string, worldPdaStr?: string, gameEntityPdaStr?: string) => {
    if (!publicKey || !signAllTransactions) {
      addLog("Connect your wallet first!");
      return;
    }
    setLoading(true);
    setLog([]);
    setSkin(selectedSkin);
    setPlayerName(name);
    try {
      setPhase("joining");
      let resolved: { worldPda: PublicKey; gameEntityPda: PublicKey } | null = null;

      if (worldPdaStr && gameEntityPdaStr) {
        resolved = { worldPda: new PublicKey(worldPdaStr), gameEntityPda: new PublicKey(gameEntityPdaStr) };
      } else {
        addLog("Resolving game...");
        resolved = await resolveGameEntity(new PublicKey(gameConfigPda), connection);
      }
      if (!resolved) {
        addLog("Error: Could not find game entity");
        setLoading(false);
        setPhase("");
        return;
      }
      addLog(`World: ${resolved.worldPda.toBase58().slice(0, 16)}...`);
      addLog(`Game entity: ${resolved.gameEntityPda.toBase58().slice(0, 16)}...`);

      const { session: sess, playerEntityPda } = await joinExistingGame(
        connection, erConnection, publicKey, signAllTransactions,
        resolved.worldPda, resolved.gameEntityPda,
        name, selectedSkin, addLog,
      );
      setGameState({ ...resolved, playerEntityPda });
      setSession(sess);

      addLog("Done! Entering game...");
      setPendingJoin(null);
      window.history.replaceState({}, "", "/");
      setScreen("game");
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
      console.error(e);
    }
    setLoading(false);
    setPhase("");
  }, [publicKey, signAllTransactions, connection, erConnection, addLog]);

  const handleSpectateGame = useCallback(async (gameConfigPda: string) => {
    // resolveGameEntity uses L1 for world count — works for both localnet and devnet
    const resolved = await resolveGameEntity(new PublicKey(gameConfigPda), connection);
    if (resolved) {
      setGameState({ ...resolved, gameConfigPda: new PublicKey(gameConfigPda) });
    } else {
      // Fallback: no entity PDA, spectate with config-only (no players visible)
      console.warn("Spectate: could not resolve game entity, players won't be visible");
      setGameState({ worldPda: PublicKey.default, gameEntityPda: PublicKey.default, gameConfigPda: new PublicKey(gameConfigPda) });
    }
    setSession(null);
    setScreen("game");
  }, [connection]);

  // ─── Invite screen (from ?join= link) ───
  if (pendingJoin && screen === "menu") {
    return (
      <div className="min-h-screen w-screen flex flex-col items-center justify-center relative">
        <div className="fixed inset-0" style={{
          backgroundImage: "url('/LOBBY.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(6px) brightness(0.4)",
        }} />
        {/* Wallet button */}
        <div className="absolute top-3 right-3 z-50">
          {publicKey ? (
            <WalletMenu address={publicKey.toBase58()} onDisconnect={() => disconnect()} />
          ) : (
            <button
              onClick={() => setWalletModalVisible(true)}
              className="cursor-pointer hover:scale-105 transition-transform"
            >
              <Image src="/WALLET_SELECTOR.png" alt="Select Wallet" width={200} height={50} style={{ imageRendering: "pixelated" }} />
            </button>
          )}
        </div>
        <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-sm px-4">
          <div className="text-5xl text-yellow-400" style={{ textShadow: "0 0 30px rgba(250, 204, 21, 0.3), 0 6px 0 #92400e" }}>
            SOL
          </div>
          <div className="text-3xl text-white" style={{ textShadow: "0 4px 0 #374151" }}>
            SURVIVORS
          </div>
          <div className="text-lg text-cyan-400 mt-4">You&apos;ve been invited!</div>

          {/* Skin selector */}
          <div className="flex items-center gap-6">
            <button onClick={() => setSkin((s) => s <= 1 ? 6 : s - 1)} className="text-3xl text-white/60 hover:text-white transition">&lt;</button>
            <div className="relative" style={{ width: 80, height: 96 }}>
              <Image src={`/props_${skin}_front.png`} alt={`skin ${skin}`} fill className="object-contain" style={{ imageRendering: "pixelated" }} onError={(e) => { (e.target as HTMLImageElement).src = "/props_1_front.png"; }} />
            </div>
            <button onClick={() => setSkin((s) => s >= 6 ? 1 : s + 1)} className="text-3xl text-white/60 hover:text-white transition">&gt;</button>
          </div>

          <input
            type="text"
            placeholder="Enter your name..."
            maxLength={16}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full bg-black/50 border-2 border-gray-700 text-white px-4 py-3 text-center text-lg focus:outline-none focus:border-cyan-500 placeholder-gray-600"
          />
          <button
            onClick={() => handleJoinGame(pendingJoin.gameConfigPda, skin, playerName, pendingJoin.worldPda, pendingJoin.gameEntityPda)}
            disabled={!publicKey || playerName.length === 0 || loading}
            className="w-full py-4 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-800 disabled:text-gray-600 border-2 border-cyan-900 disabled:border-gray-700 text-white text-xl transition"
          >
            JOIN GAME
          </button>
          <button
            onClick={() => { setPendingJoin(null); window.history.replaceState({}, "", "/"); }}
            className="text-sm text-gray-500 hover:text-gray-300 transition"
          >
            go back to lobby
          </button>
        </div>
        {loading && (
          <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center gap-4 px-4">
            <div className="text-3xl text-yellow-400 animate-pulse">Joining game...</div>
            <div className="w-full max-w-lg bg-black/60 border border-gray-700 p-4 max-h-[60vh] overflow-y-auto flex flex-col gap-1">
              {log.map((l, i) => (
                <div key={i} className={l.startsWith("---") ? "text-yellow-400 text-sm mt-2" : l.startsWith("Error") ? "text-red-400 text-sm" : "text-gray-400 text-xs"}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen === "menu") {
    return (
      <div className="relative">
        <MainMenu
          price={price}
          connection={connection}
          erConnection={erConnection}
          onCreateGame={handleCreateGame}
          onJoinGame={handleJoinGame}
        />
        {/* Wallet button */}
        <div className="absolute top-3 right-3 z-50">
          {publicKey ? (
            <WalletMenu address={publicKey.toBase58()} onDisconnect={() => disconnect()} />
          ) : (
            <button
              onClick={() => setWalletModalVisible(true)}
              className="cursor-pointer hover:scale-105 transition-transform"
            >
              <Image
                src="/WALLET_SELECTOR.png"
                alt="Select Wallet"
                width={200}
                height={50}
                style={{ imageRendering: "pixelated" }}
              />
            </button>
          )}
        </div>
        {/* Loading overlay */}
        {loading && (
          <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center gap-4 px-4">
            <div className="text-3xl text-yellow-400 animate-pulse">
              Setting up game...
            </div>
            <div className="w-full max-w-lg bg-black/60 border border-gray-700 p-4 max-h-[60vh] overflow-y-auto flex flex-col gap-1">
              {log.map((l, i) => {
                const isPhaseHeader = l.startsWith("---");
                const isError = l.startsWith("Error");
                return (
                  <div
                    key={i}
                    className={
                      isPhaseHeader ? "text-yellow-400 text-sm mt-2" :
                      isError ? "text-red-400 text-sm" :
                      "text-gray-400 text-xs"
                    }
                  >
                    {l}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden">
      <Game
        price={price}
        history={history}
        skin={skin}
        playerName={playerName}
        onBack={() => { setScreen("menu"); setGameState(null); setSession(null); }}
        session={session}
        worldPda={gameState?.worldPda}
        gameEntityPda={gameState?.gameEntityPda}
        playerEntityPda={gameState?.playerEntityPda}
        erConnection={erConnection}
        gameConfigPda={gameState?.gameConfigPda}
      />
    </div>
  );
}
