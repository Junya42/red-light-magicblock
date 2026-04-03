"use client";
import { useSolPrice } from "./hooks/useSolPrice";
import Game from "./components/Game";

export default function Home() {
  const { price, history } = useSolPrice();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2">1, 2, 3... SOL-eil</h1>
      <p className="text-gray-500 mb-6 text-sm">Red Light Green Light — powered by SOL price</p>
      <Game price={price} history={history} />
    </div>
  );
}
