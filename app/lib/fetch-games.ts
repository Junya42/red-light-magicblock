import { Connection, PublicKey } from "@solana/web3.js";
import { GAME_CONFIG_COMPONENT } from "./program-ids";

export interface GameListing {
  pubkey: string;       // GameConfig PDA address
  status: number;       // 0=Waiting, 1=Playing, 2=Finished
  activePlayers: number;
  light: number;        // 0=green, 1=red
  lobbyEnd: number;     // unix timestamp
  startTime: number;    // unix timestamp
}

/**
 * BOLT component layout for GameConfig:
 * disc(8) + status(1) + active_players(1) + light(1) +
 * last_price(8) + last_check_time(8) + red_until(8) +
 * start_time(8) + lobby_end(8)
 */
const STATUS_OFFSET = 8;
const ACTIVE_PLAYERS_OFFSET = 9;
const LIGHT_OFFSET = 10;
const START_TIME_OFFSET = 35;
const LOBBY_END_OFFSET = 43;

function parseGameConfigData(data: Buffer | Uint8Array): GameListing | null {
  if (data.length < 51) return null;
  const status = data[STATUS_OFFSET];
  if (status > 2) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    pubkey: "",
    status,
    activePlayers: data[ACTIVE_PLAYERS_OFFSET],
    light: data[LIGHT_OFFSET],
    startTime: Number(view.getBigInt64(START_TIME_OFFSET, true)),
    lobbyEnd: Number(view.getBigInt64(LOBBY_END_OFFSET, true)),
  };
}

// Backoff: skip ER refresh for a while after failures
let erBackoffUntil = 0;
let erBackoffMs = 5000;

/**
 * Fetch game list from L1, then refresh each game's state from ER
 * (activePlayers, status, light are updated on ER, not L1)
 */
export async function fetchAllGames(
  l1Connection: Connection,
  erConnection?: Connection | null,
): Promise<GameListing[]> {
  try {
    // 1. Get all GameConfig PDAs from L1
    const accounts = await l1Connection.getProgramAccounts(GAME_CONFIG_COMPONENT, {
      commitment: "confirmed",
    });

    const games: GameListing[] = [];

    for (const { pubkey, account } of accounts) {
      const parsed = parseGameConfigData(account.data);
      if (!parsed) continue;
      parsed.pubkey = pubkey.toBase58();
      games.push(parsed);
    }

    // 2. If ER connection available, refresh live data from ER (with backoff)
    if (erConnection && games.length > 0 && Date.now() > erBackoffUntil) {
      try {
        const pdas = games.map(g => new PublicKey(g.pubkey));
        const erAccounts = await erConnection.getMultipleAccountsInfo(pdas);
        for (let i = 0; i < games.length; i++) {
          const erData = erAccounts[i]?.data;
          if (!erData) continue;
          const erParsed = parseGameConfigData(erData as Buffer);
          if (!erParsed) continue;
          // Override with ER state (live data)
          games[i].status = erParsed.status;
          games[i].activePlayers = erParsed.activePlayers;
          games[i].light = erParsed.light;
        }
        // Success — reset backoff
        erBackoffMs = 5000;
      } catch (err) {
        console.warn("ER fetch failed, backing off:", err);
        erBackoffUntil = Date.now() + erBackoffMs;
        erBackoffMs = Math.min(erBackoffMs * 2, 60000); // max 60s backoff
      }
    }

    // 3. Filter
    const maxLobbyEnd = Math.max(...games.map(g => g.lobbyEnd).filter(t => t > 0), 0);
    return games
      .filter((g) => {
        if (g.status > 1) return false;
        if (g.lobbyEnd === 0 && g.startTime === 0) return false;
        // Game over after lobby (60s) + playing (150s) = 210s from start
        if (g.lobbyEnd > 0 && maxLobbyEnd > 0 && g.lobbyEnd + 150 < maxLobbyEnd - 60) return false;
        if (maxLobbyEnd > 0 && g.lobbyEnd > 0 && g.lobbyEnd < maxLobbyEnd - 30 * 60) return false;
        return true;
      })
      .sort((a, b) => b.lobbyEnd - a.lobbyEnd);
  } catch (e) {
    console.error("Failed to fetch games:", e);
    return [];
  }
}
