# SOL Survivors (Red Light) — Architecture

## Overview
Full on-chain multiplayer game built on MagicBlock's BOLT ECS + Ephemeral Rollups.
SOL price drops trigger "red light" — move during red light = eliminated.
First to reach Y=300 wins.

Code: `/Users/emile/Documents/TNTX/red-light`
GitHub: `8-1000-e/red-light-magicblock`

## Stack
- **On-chain**: BOLT ECS (Anchor-based), Ephemeral Rollups
- **Frontend**: Next.js 16 + React 19 + Tailwind 4
- **Oracle**: Pyth Lazer (SOL/USD, feed ID "6", offset 73, u64 LE, 8 decimals)
- **Session keys**: Ephemeral keypair signs gameplay TX (no wallet popup per move)
- **Anchor**: 0.31.1 (MUST match bolt-sdk's version — dual copies cause "Provider local not available" error)

## On-Chain Components (4 on game entity)

### GameConfig (`HSmw8VMWEBaNTuTbfG5GZAPabRawKr7DWtDAtov6ev3w`)
```
status: u8        (0=Waiting, 1=Playing, 2=Finished)
active_players: u8
light: u8         (0=Green, 1=Red)
last_price: u64   (Pyth raw, 8 decimals)
last_check_time: i64
red_until: i64
start_time: i64
lobby_end: i64    (start_time + 40s)
```
Binary layout (after 8-byte discriminator):
- offset 8: status, 9: active_players, 10: light
- offset 11: last_price (u64), 19: last_check_time (i64), 27: red_until (i64)
- offset 35: start_time (i64), 43: lobby_end (i64)

### PlayerState (`3pXqzoU9T4uQzVTv1gZJrPNe59qFKy2GP4353JK22Swu`)
```
authority: Pubkey
alive: bool
finished: bool
finish_time: i64
y: u16            (0=start, 300=finish)
name: [u8; 16]
name_len: u8
last_move_slot: u64
skin: u8
```
Binary layout (after 8-byte discriminator):
- offset 8: authority (32 bytes)
- offset 40: alive, 41: finished
- offset 42: finish_time (i64)
- offset 50: y (u16)
- offset 52: name (16 bytes), 68: name_len
- offset 69: last_move_slot (u64)
- offset 77: skin (u8)

### PlayerRegistry (`G3RuJgA65dgqXJdPDsiZVUbiFC6LX8Grz8wBNiRxoe5H`)
```
players: [[u8;32]; 10]        (Position PDAs — unused in red-light)
player_states: [[u8;32]; 10]  (PlayerState PDAs)
count: u8
```
Binary layout: disc(8) + players(320) + player_states(320) + count(1) = 649 bytes
- offset 328: player_states start
- offset 648: count

### Leaderboard (`93hpaDv5S1iQEGLZ86DzrR6t9wsrkpEu8vMoPshzdpU8`)
```
entries: [[u8;32]; 10]  (finisher pubkeys in order)
count: u8
```
Extracted from GameConfig to avoid "Return data too large (>1024)" error when spawn-player returns 3 components.

## On-Chain Systems (5)

### init-game (`2ta7fTqSgTZ59Tr1WcdjUjgVL3uMyjtGed2jE3Eqfv6x`)
- Sets status=0, lobby_end=now+40s
- system_input: GameConfig
- Run on L1 first, then re-run on ER after delegation

### spawn-player (`5kurbimAJh3B9VB4wNC99JZan6pdo6nDGfZD6tbmw4mi`)
- Parses JSON args: `{"name":"xxx","skin":2}`
- Sets alive=true, y=0, registers in PlayerRegistry
- system_input: PlayerState, GameConfig, PlayerRegistry
- Uses stack-only JSON parsers (no serde/heap on BPF)

### start-game (`2zKVpP5ovwYVfcTtEj1n4sRWdBoRcDKVk8AbzEAo8B8k`)
- Requires status==0 && now>=lobby_end
- Reads Pyth price from remaining_accounts[0]
- Sets status=1, light=0, last_price
- system_input: GameConfig

### move-player (`B41Kov8d1moDABp8RdSTRauZUNpwuNwvc312erhWF7w1`)
- Rate limited by slot (MIN_SLOT_GAP=1)
- Red light + move = alive=false
- Green light = y+=1
- y>=300 = finished + leaderboard entry
- system_input: PlayerState, GameConfig, Leaderboard

### check-price (`14aiGdhHAwHjMCJb8F4agsa4NNWdyZCBQjvBcX3Fib6K`)
- Cooldown 3s between checks
- Reads Pyth from remaining_accounts[0]
- Price drop = light=1, red_until=now+2s
- system_input: GameConfig

## Shared lib (`programs-ecs/libs/shared/`)
- `parse_json_u64`, `parse_json_i64`, `parse_json_str` — stack-only JSON parsers
- `read_pyth_price` — reads Pyth Lazer at offset 73 (u64 LE, 8 decimals)
- `GameError` enum

## Frontend Architecture

### Key Files
- `app/page.tsx` — Main page, wallet handling, create/join/spectate routing
- `app/components/Game.tsx` — Game field, lobby, player sprites, on-chain subscriptions
- `app/components/MainMenu.tsx` — Game list, skin selector, name input, create/join/spectate
- `app/lib/bolt-actions.ts` — All BOLT SDK calls (createAndJoinGame, joinExistingGame, movePlayer, checkPrice, startGame, resolveGameEntity)
- `app/lib/program-ids.ts` — All PublicKeys for components + systems
- `app/lib/fetch-games.ts` — getProgramAccounts to list games (L1 + ER refresh)
- `app/hooks/useSolPrice.ts` — Pyth Lazer WebSocket (wss://devnet.magicblock.app, feed "6")
- `app/providers.tsx` — Wallet provider (Phantom/Solflare)

### Create Game Flow (3 wallet popups)
1. **Popup 1**: Create world (need worldPda for everything else)
2. **Popup 2**: Game entity + init 4 components + init-game + delegate game (split 2 batches) + init-game on ER
3. **Popup 3**: Session key + player entity + init player component + delegate player
4. **No popup**: Spawn player on ER via session key

### Join Game Flow (1 wallet popup)
1. `resolveGameEntity(gameConfigPda, connection)` — reads world count from Registry, brute-forces last 100 worldIds with entityId=0 to find matching PDA
2. **Popup 1**: Session key + player entity + init + delegate
3. **No popup**: Spawn on ER via session key

### Spectate Mode
- Click "SPECTATE" on any in-game game
- Enters Game component with `gameConfigPda` only (no session, no player)
- Subscribes to GameConfig PDA directly on ER
- No PlayerRegistry subscription (no entity PDA available)
- "GO BACK" button always visible

### Game Component Subscriptions (on ER)
1. **GameConfig** → status, light, lobbyEnd, lastPrice
2. **Own PlayerState** → y, alive, finished (NO initial fetch — race condition)
3. **PlayerRegistry** → discover other players, subscribe to their PlayerState for live Y

### Key Patterns
- `useAnchorWallet()` + `useMemo` for global Anchor provider (same pattern as CUBE3D)
- `signAllTransactions` for batching multiple TXs in one popup
- `sendSessionTx` helper signs + sends via session key
- `sendSignedTx` helper sends + confirms with skipPreflight
- On-chain Y (0-300) mapped to screen Y: `screenY = START_Y - (y/300) * (START_Y - FINISH_LINE)`

### Game List (fetch-games.ts)
- Fetches GameConfig accounts from L1 via getProgramAccounts
- Refreshes live data (status, activePlayers, light) from ER via getMultipleAccountsInfo
- Filters: status<=1, has lobbyEnd, not older than 30min relative to newest game
- L1 status stays 0 after delegation — ER status is the real one

### World ID Resolution
- World IDs are sequential counters (e.g., 3106, 3119...) — NOT small numbers
- World Registry PDA has world count at offset 8 (u64 LE)
- Game entity is always entityId=0 in each world
- `resolveGameEntity` searches last 100 worlds for matching GameConfig PDA
- Surfpool/devnet timestamps drift from local time (~hours) — use relative comparisons, not Date.now()

## Assets (public/)
- `BACKGROUND.png` — game field background
- `LOBBY.jpg` — menu background
- `CARD.png` — HUD card
- `lobby_player.png` — lobby player list card
- `WALLET_SELECTOR.png`, `WALLET_SELECTED.png` — custom wallet buttons
- `girls front.png`, `girls back.png` — doll (red/green facing)
- `green lights.png`, `red lights.png` — traffic lights
- `props_1_front.png`, `props_1_back.png`, `props_1_dead.png` — skin 1 (only skin with assets currently)

## Local Dev Setup
```bash
# Terminal 1: Surfpool (L1 proxy to devnet)
surfpool start --rpc-url 'https://devnet.helius-rpc.com/?api-key=8d38a207-13ec-4e21-ac70-071e952834d2'

# Terminal 2: Ephemeral Rollup validator
rm -rf magicblock-test-storage/  # clean ER cache before restart!
ephemeral-validator --remotes "http://localhost:8899" --remotes "ws://localhost:8900" -l "7799" --lifecycle ephemeral

# Terminal 3: Deploy programs
cd /Users/emile/Documents/TNTX/red-light
bolt build
anchor deploy --provider.cluster http://localhost:8899

# Terminal 4: Frontend
cd /Users/emile/Documents/TNTX/red-light
npm run dev
```

## Critical Gotchas

### ER Stale Binaries
After every `anchor deploy`, you MUST restart the ER with clean storage:
```bash
rm -rf magicblock-test-storage/
# then restart ephemeral-validator
```

### Anchor Dual Package
`@coral-xyz/anchor` MUST be 0.31.1 to match bolt-sdk. If versions differ, npm installs two copies and `setProvider` affects the wrong one → "Provider local not available on browser".

### Return Data Limit
BOLT systems return all `system_input` components serialized. If total > 1024 bytes, TX fails with "Return data too large". This is why Leaderboard was extracted from GameConfig.

### system_input Order
The order of components in `#[system_input]` MUST match the order of entities/components in the `ApplySystem({ entities: [...] })` call on the frontend.

### Surfpool Timestamps
Surfpool uses devnet chain time, not local time. There can be hours of drift. Never compare on-chain timestamps with `Date.now()` directly — use relative comparisons.

### Session Key
- `partialSign(sessionSigner)` MUST be called on the session TX before `signAllTransactions`
- Session TX must be prepared (blockhash + feePayer) BEFORE partialSign
- Spawn TX uses `session.signer.publicKey` as authority and feePayer
