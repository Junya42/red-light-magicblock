import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  InitializeNewWorld,
  AddEntity,
  InitializeComponent,
  ApplySystem,
  FindComponentPda,
  createDelegateInstruction,
  CreateSession,
  Session,
} from "@magicblock-labs/bolt-sdk";
import { BN } from "@coral-xyz/anchor";
import {
  ALL_COMPONENTS,
  GAME_CONFIG_COMPONENT,
  PLAYER_STATE_COMPONENT,
  PLAYER_REGISTRY_COMPONENT,
  LEADERBOARD_COMPONENT,
  INIT_GAME_SYSTEM,
  SPAWN_PLAYER_SYSTEM,
  START_GAME_SYSTEM,
  MOVE_PLAYER_SYSTEM,
  CHECK_PRICE_SYSTEM,
} from "./program-ids";

let ER_VALIDATOR = new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev");

export function setErValidator(pubkey: string) {
  ER_VALIDATOR = new PublicKey(pubkey);
}

export interface GameState {
  worldPda: PublicKey;
  gameEntityPda: PublicKey;
  playerEntityPda?: PublicKey;
}

type Log = (msg: string) => void;

// ─── Helpers ───

async function prepareTx(tx: Transaction, connection: Connection, payer: PublicKey): Promise<Transaction> {
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  return tx;
}

async function sendSignedTx(tx: Transaction, connection: Connection, log: Log, label: string): Promise<string> {
  log(`${label}...`);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  log(`  ${sig.slice(0, 20)}... confirmed`);
  return sig;
}

function sendSessionTx(session: Session) {
  return async (tx: Transaction, conn: Connection): Promise<string> => {
    const { blockhash } = await conn.getLatestBlockhash();
    tx.feePayer = session.signer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(session.signer);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const result = await conn.confirmTransaction(sig, "confirmed");
    if (result.value.err) throw new Error(`TX failed: ${JSON.stringify(result.value.err)}`);
    return sig;
  };
}

// ─── Create game + join (3 wallet popups) ───
//   Popup 1: create world
//   Popup 2: game entity + init + init-game + delegate + ER init-game
//   Popup 3: session + player entity + init + delegate
//   No popup: spawn via session key
export async function createAndJoinGame(
  connection: Connection,
  erConnection: Connection,
  payer: PublicKey,
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>,
  playerName: string,
  skin: number,
  log: Log,
): Promise<{ gameState: GameState; session: Session }> {

  // ═══════════════════════════════════════════
  // POPUP 1 — Create world
  // ═══════════════════════════════════════════
  log("--- CREATE GAME ---");
  const initWorld = await InitializeNewWorld({ payer, connection });
  const worldPda = initWorld.worldPda;
  await prepareTx(initWorld.transaction, connection, payer);
  const [signedWorld] = await signAllTransactions([initWorld.transaction]);
  await sendSignedTx(signedWorld, connection, log, "Create world");
  log(`World: ${worldPda.toBase58().slice(0, 16)}...`);

  // ═══════════════════════════════════════════
  // POPUP 2 — Game setup + delegate + ER init
  // ═══════════════════════════════════════════
  const addGameEntity = await AddEntity({ payer, world: worldPda, connection });
  const gameEntityPda = addGameEntity.entityPda;

  const batchInitGameTx = new Transaction();
  for (const componentId of ALL_COMPONENTS) {
    const initComp = await InitializeComponent({ payer, entity: gameEntityPda, componentId });
    batchInitGameTx.add(...initComp.transaction.instructions);
  }

  const applyInitGame = await ApplySystem({
    authority: payer,
    systemId: INIT_GAME_SYSTEM,
    world: worldPda,
    entities: [
      { entity: gameEntityPda, components: [{ componentId: GAME_CONFIG_COMPONENT }] },
    ],
  });

  // Delegate all game components to ER (split if > 3)
  const delegateGameIxs = ALL_COMPONENTS.map((componentId) => {
    const componentPda = FindComponentPda({ componentId, entity: gameEntityPda });
    return createDelegateInstruction(
      { payer, entity: gameEntityPda, account: componentPda, ownerProgram: componentId },
      0, ER_VALIDATOR,
    );
  });
  const delegateGameTx1 = new Transaction().add(...delegateGameIxs.slice(0, 3));
  const delegateGameTx2 = delegateGameIxs.length > 3
    ? new Transaction().add(...delegateGameIxs.slice(3))
    : null;

  // Re-apply init-game on ER
  const applyInitGameER = await ApplySystem({
    authority: payer,
    systemId: INIT_GAME_SYSTEM,
    world: worldPda,
    entities: [
      { entity: gameEntityPda, components: [{ componentId: GAME_CONFIG_COMPONENT }] },
    ],
  });

  const gameTxs: Transaction[] = [
    addGameEntity.transaction,
    batchInitGameTx,
    applyInitGame.transaction,
    delegateGameTx1,
  ];
  if (delegateGameTx2) gameTxs.push(delegateGameTx2);
  const erIdx = gameTxs.length;
  gameTxs.push(applyInitGameER.transaction);

  for (let i = 0; i < gameTxs.length; i++) {
    const conn = i === erIdx ? erConnection : connection;
    await prepareTx(gameTxs[i], conn, payer);
  }

  log("Signing game setup...");
  const signedGame = await signAllTransactions(gameTxs);

  await sendSignedTx(signedGame[0], connection, log, "Add game entity");
  log(`Game entity: ${gameEntityPda.toBase58().slice(0, 16)}...`);
  await sendSignedTx(signedGame[1], connection, log, "Init components");
  await sendSignedTx(signedGame[2], connection, log, "Init-game");
  await sendSignedTx(signedGame[3], connection, log, "Delegate game 1/2");
  let nextIdx = 4;
  if (delegateGameTx2) {
    await sendSignedTx(signedGame[nextIdx], connection, log, "Delegate game 2/2");
    nextIdx++;
  }
  await sendSignedTx(signedGame[erIdx], erConnection, log, "Init-game on ER");
  log("Game created + delegated!");

  // ═══════════════════════════════════════════
  // POPUP 3 — Session + player setup
  // ═══════════════════════════════════════════
  log("--- JOIN GAME ---");
  const sessionSigner = Keypair.generate();
  const topUp = new BN(0.002 * 1e9);
  const validity = new BN(Math.floor(Date.now() / 1000) + 60 * 60);
  const { transaction: sessionTx, session } = await CreateSession({
    sessionSigner, authority: payer, topUp, validity,
  });
  await prepareTx(sessionTx, connection, payer);
  sessionTx.partialSign(sessionSigner);

  const addPlayerEntity = await AddEntity({ payer, world: worldPda, connection });
  const playerEntityPda = addPlayerEntity.entityPda;

  const initPlayerTx = new Transaction();
  const initPlayerComp = await InitializeComponent({ payer, entity: playerEntityPda, componentId: PLAYER_STATE_COMPONENT });
  initPlayerTx.add(...initPlayerComp.transaction.instructions);

  const playerComponentPda = FindComponentPda({ componentId: PLAYER_STATE_COMPONENT, entity: playerEntityPda });
  const delegatePlayerTx = new Transaction().add(
    createDelegateInstruction(
      { payer, entity: playerEntityPda, account: playerComponentPda, ownerProgram: PLAYER_STATE_COMPONENT },
      0, ER_VALIDATOR,
    ),
  );

  const joinTxs = [sessionTx, addPlayerEntity.transaction, initPlayerTx, delegatePlayerTx];
  for (const tx of joinTxs.slice(1)) await prepareTx(tx, connection, payer);

  log("Signing join...");
  const signedJoin = await signAllTransactions(joinTxs);

  await sendSignedTx(signedJoin[0], connection, log, "Create session");
  await sendSignedTx(signedJoin[1], connection, log, "Add player entity");
  log(`Player entity: ${playerEntityPda.toBase58().slice(0, 16)}...`);
  await sendSignedTx(signedJoin[2], connection, log, "Init player component");
  await sendSignedTx(signedJoin[3], connection, log, "Delegate player to ER");

  // ═══════════════════════════════════════════
  // Spawn on ER via session key (0 popup)
  // ═══════════════════════════════════════════
  log("--- SPAWN ---");
  const applySpawn = await ApplySystem({
    authority: session.signer.publicKey,
    systemId: SPAWN_PLAYER_SYSTEM,
    world: worldPda,
    entities: [
      { entity: playerEntityPda, components: [{ componentId: PLAYER_STATE_COMPONENT }] },
      { entity: gameEntityPda, components: [{ componentId: GAME_CONFIG_COMPONENT }, { componentId: PLAYER_REGISTRY_COMPONENT }] },
    ],
    args: { name: playerName, skin },
    session,
  });
  const send = sendSessionTx(session);
  await send(applySpawn.transaction, erConnection);
  log("Player spawned!");

  return {
    gameState: { worldPda, gameEntityPda, playerEntityPda },
    session,
  };
}

// ─── Join existing game (1 wallet popup) ───
export async function joinExistingGame(
  l1Connection: Connection,
  erConnection: Connection,
  payer: PublicKey,
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>,
  worldPda: PublicKey,
  gameEntityPda: PublicKey,
  playerName: string,
  skin: number,
  log: Log,
): Promise<{ session: Session; playerEntityPda: PublicKey }> {
  log("--- JOIN EXISTING GAME ---");

  const sessionSigner = Keypair.generate();
  const topUp = new BN(0.002 * 1e9);
  const validity = new BN(Math.floor(Date.now() / 1000) + 60 * 60);
  const { transaction: sessionTx, session } = await CreateSession({
    sessionSigner, authority: payer, topUp, validity,
  });
  await prepareTx(sessionTx, l1Connection, payer);
  sessionTx.partialSign(sessionSigner);

  const addPlayerEntity = await AddEntity({ payer, world: worldPda, connection: l1Connection });
  const playerEntityPda = addPlayerEntity.entityPda;

  const initPlayerTx = new Transaction();
  const initPlayerComp = await InitializeComponent({ payer, entity: playerEntityPda, componentId: PLAYER_STATE_COMPONENT });
  initPlayerTx.add(...initPlayerComp.transaction.instructions);

  const playerComponentPda = FindComponentPda({ componentId: PLAYER_STATE_COMPONENT, entity: playerEntityPda });
  const delegatePlayerTx = new Transaction().add(
    createDelegateInstruction(
      { payer, entity: playerEntityPda, account: playerComponentPda, ownerProgram: PLAYER_STATE_COMPONENT },
      0, ER_VALIDATOR,
    ),
  );

  const l1Txs = [sessionTx, addPlayerEntity.transaction, initPlayerTx, delegatePlayerTx];
  for (const tx of l1Txs.slice(1)) await prepareTx(tx, l1Connection, payer);

  log("Signing...");
  const signed = await signAllTransactions(l1Txs);

  await sendSignedTx(signed[0], l1Connection, log, "Create session");
  await sendSignedTx(signed[1], l1Connection, log, "Add player entity");
  await sendSignedTx(signed[2], l1Connection, log, "Init player component");
  await sendSignedTx(signed[3], l1Connection, log, "Delegate player to ER");

  const applySpawn = await ApplySystem({
    authority: session.signer.publicKey,
    systemId: SPAWN_PLAYER_SYSTEM,
    world: worldPda,
    entities: [
      { entity: playerEntityPda, components: [{ componentId: PLAYER_STATE_COMPONENT }] },
      { entity: gameEntityPda, components: [{ componentId: GAME_CONFIG_COMPONENT }, { componentId: PLAYER_REGISTRY_COMPONENT }] },
    ],
    args: { name: playerName, skin },
    session,
  });
  const send = sendSessionTx(session);
  await send(applySpawn.transaction, erConnection);
  log("Player spawned!");

  return { session, playerEntityPda };
}

// ─── Move player (session key, no popup) ───
export async function movePlayer(
  connection: Connection,
  session: Session,
  worldPda: PublicKey,
  playerEntityPda: PublicKey,
  gameEntityPda: PublicKey,
): Promise<string> {
  const applyMove = await ApplySystem({
    authority: session.signer.publicKey,
    systemId: MOVE_PLAYER_SYSTEM,
    world: worldPda,
    entities: [
      { entity: playerEntityPda, components: [{ componentId: PLAYER_STATE_COMPONENT }] },
      { entity: gameEntityPda, components: [{ componentId: GAME_CONFIG_COMPONENT }, { componentId: LEADERBOARD_COMPONENT }] },
    ],
    session,
  });
  const send = sendSessionTx(session);
  return send(applyMove.transaction, connection);
}

// ─── Check price (session key or anyone) ───
export async function checkPrice(
  connection: Connection,
  session: Session,
  worldPda: PublicKey,
  gameEntityPda: PublicKey,
  pythPricePda: PublicKey,
): Promise<string> {
  const applyCheck = await ApplySystem({
    authority: session.signer.publicKey,
    systemId: CHECK_PRICE_SYSTEM,
    world: worldPda,
    entities: [
      { entity: gameEntityPda, components: [{ componentId: GAME_CONFIG_COMPONENT }] },
    ],
    extraAccounts: [{ pubkey: pythPricePda, isWritable: false, isSigner: false }],
    session,
  });
  const send = sendSessionTx(session);
  return send(applyCheck.transaction, connection);
}

// ─── Start game (after lobby) ───
export async function startGame(
  connection: Connection,
  session: Session,
  worldPda: PublicKey,
  gameEntityPda: PublicKey,
  pythPricePda: PublicKey,
): Promise<string> {
  const applyStart = await ApplySystem({
    authority: session.signer.publicKey,
    systemId: START_GAME_SYSTEM,
    world: worldPda,
    entities: [
      { entity: gameEntityPda, components: [{ componentId: GAME_CONFIG_COMPONENT }] },
    ],
    extraAccounts: [{ pubkey: pythPricePda, isWritable: false, isSigner: false }],
    session,
  });
  const send = sendSessionTx(session);
  return send(applyStart.transaction, connection);
}
