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
 * Fetch all GameConfig accounts from on-chain.
 * Parses the raw bytes to extract game state.
 *
 * BOLT component layout:
 * - 8 bytes: discriminator
 * - Then the fields in struct order:
 *   status (u8), active_players (u8), light (u8),
 *   last_price (u64), last_check_time (i64), red_until (i64),
 *   start_time (i64), lobby_end (i64),
 *   leaderboard ([[u8;32];10] = 320 bytes), finishers (u8)
 */
const STATUS_OFFSET = 8;         // after discriminator
const ACTIVE_PLAYERS_OFFSET = 9;
const LIGHT_OFFSET = 10;
const START_TIME_OFFSET = 35;    // 8 + 1 + 1 + 1 + 8 + 8 + 8
const LOBBY_END_OFFSET = 43;     // START_TIME_OFFSET + 8

export async function fetchAllGames(connection: Connection): Promise<GameListing[]> {
  try {
    const accounts = await connection.getProgramAccounts(GAME_CONFIG_COMPONENT, {
      commitment: "confirmed",
    });

    const games: GameListing[] = [];

    for (const { pubkey, account } of accounts) {
      const data = account.data;
      if (data.length < 52) continue; // too small

      const status = data[STATUS_OFFSET];
      if (status > 2) continue; // invalid

      const activePlayers = data[ACTIVE_PLAYERS_OFFSET];
      const light = data[LIGHT_OFFSET];

      // Read i64 start_time and lobby_end
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const startTime = Number(view.getBigInt64(START_TIME_OFFSET, true));
      const lobbyEnd = Number(view.getBigInt64(LOBBY_END_OFFSET, true));

      games.push({
        pubkey: pubkey.toBase58(),
        status,
        activePlayers,
        light,
        startTime,
        lobbyEnd,
      });
    }

    // Sort: Waiting first, then Playing, filter out Finished
    return games
      .filter((g) => g.status <= 1)
      .sort((a, b) => a.status - b.status || b.lobbyEnd - a.lobbyEnd);
  } catch (e) {
    console.error("Failed to fetch games:", e);
    return [];
  }
}
