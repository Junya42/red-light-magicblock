"use client";
import { useSolPrice } from "./hooks/useSolPrice";
import Game from "./components/Game";

export default function Home() {
  const { price, history } = useSolPrice();

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden">
      <Game price={price} history={history} />
    </div>
  );
}
