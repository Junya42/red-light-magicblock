"use client";
import { useState, useCallback, useMemo } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import * as anchor from "@coral-xyz/anchor";
import Image from "next/image";
import { useSolPrice } from "./hooks/useSolPrice";
import MainMenu from "./components/MainMenu";
import Game from "./components/Game";
import { createAndJoinGame, GameState } from "./lib/bolt-actions";
import { Session } from "@magicblock-labs/bolt-sdk";

const ER_RPC = "http://localhost:7799";

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

  const handleJoinGame = useCallback(async (gameId: string, selectedSkin: number, name: string) => {
    // TODO: resolve gameId → worldPda + gameEntityPda, then createSessionAndJoin
    addLog(`Joining game ${gameId.slice(0, 8)}... (not yet implemented)`);
  }, [addLog]);

  if (screen === "menu") {
    return (
      <div className="relative">
        <MainMenu
          price={price}
          connection={connection}
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
        onBack={() => setScreen("menu")}
      />
    </div>
  );
}
