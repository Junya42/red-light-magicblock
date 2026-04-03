"use client";
import { useState, useMemo } from "react";
import { Connection } from "@solana/web3.js";
import { useSolPrice } from "./hooks/useSolPrice";
import MainMenu from "./components/MainMenu";
import Game from "./components/Game";

const RPC_URL = "http://localhost:8899";

export default function Home() {
  const { price, history } = useSolPrice();
  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [skin, setSkin] = useState(1);
  const [playerName, setPlayerName] = useState("");

  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);

  if (screen === "menu") {
    return (
      <MainMenu
        price={price}
        connection={connection}
        onCreateGame={(s, name) => {
          setSkin(s);
          setPlayerName(name);
          setScreen("game");
        }}
        onJoinGame={(id, s, name) => {
          setSkin(s);
          setPlayerName(name);
          setScreen("game");
        }}
      />
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
