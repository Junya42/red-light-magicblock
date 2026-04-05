"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

const ORACLE_PROGRAM = new PublicKey("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
const SOL_FEED_ID = "6"; // Pyth Lazer SOL/USD
const PRICE_EXPONENT = 8;
const ER_WSS = "wss://devnet-eu.magicblock.app";
const ER_RPC = "https://devnet-eu.magicblock.app";

function derivePricePda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("price_feed"),
      Buffer.from("pyth-lazer"),
      Buffer.from(SOL_FEED_ID),
    ],
    ORACLE_PROGRAM
  )[0];
}

export interface PricePoint {
  price: number;
  timestamp: number;
}

export function useSolPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const connRef = useRef<Connection | null>(null);
  const subRef = useRef<number | null>(null);

  const parsePrice = useCallback((data: Buffer): number | null => {
    if (data.length < 81) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const raw = Number(view.getBigUint64(73, true));
    return raw / Math.pow(10, PRICE_EXPONENT);
  }, []);

  useEffect(() => {
    const pda = derivePricePda();
    const conn = new Connection(ER_RPC, { wsEndpoint: ER_WSS, commitment: "confirmed" });
    connRef.current = conn;

    // No initial fetch — WS subscription provides the price
    // (avoids burning ER rate limit on page load)

    // Subscribe
    const subId = conn.onAccountChange(pda, (accountInfo) => {
      const p = parsePrice(Buffer.from(accountInfo.data));
      if (p) {
        const now = Date.now();
        setPrice(p);
        setHistory((prev) => {
          const cutoff = now - 120_000; // keep 2 min of history
          const filtered = prev.filter((pt) => pt.timestamp > cutoff);
          return [...filtered, { price: p, timestamp: now }];
        });
      }
    }, "confirmed");
    subRef.current = subId;

    return () => {
      if (subRef.current !== null && connRef.current) {
        connRef.current.removeAccountChangeListener(subRef.current);
      }
    };
  }, [parsePrice]);

  return { price, history };
}
