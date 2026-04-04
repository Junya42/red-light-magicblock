import { PublicKey } from "@solana/web3.js";

// Components
export const GAME_CONFIG_COMPONENT = new PublicKey("HSmw8VMWEBaNTuTbfG5GZAPabRawKr7DWtDAtov6ev3w");
export const PLAYER_STATE_COMPONENT = new PublicKey("3pXqzoU9T4uQzVTv1gZJrPNe59qFKy2GP4353JK22Swu");
export const PLAYER_REGISTRY_COMPONENT = new PublicKey("G3RuJgA65dgqXJdPDsiZVUbiFC6LX8Grz8wBNiRxoe5H");
export const LEADERBOARD_COMPONENT = new PublicKey("93hpaDv5S1iQEGLZ86DzrR6t9wsrkpEu8vMoPshzdpU8");

// Systems
export const INIT_GAME_SYSTEM = new PublicKey("2ta7fTqSgTZ59Tr1WcdjUjgVL3uMyjtGed2jE3Eqfv6x");
export const SPAWN_PLAYER_SYSTEM = new PublicKey("5kurbimAJh3B9VB4wNC99JZan6pdo6nDGfZD6tbmw4mi");
export const START_GAME_SYSTEM = new PublicKey("2zKVpP5ovwYVfcTtEj1n4sRWdBoRcDKVk8AbzEAo8B8k");
export const MOVE_PLAYER_SYSTEM = new PublicKey("B41Kov8d1moDABp8RdSTRauZUNpwuNwvc312erhWF7w1");
export const CHECK_PRICE_SYSTEM = new PublicKey("14aiGdhHAwHjMCJb8F4agsa4NNWdyZCBQjvBcX3Fib6K");
export const END_GAME_SYSTEM = new PublicKey("9xmJrU5Z7HqT5kaK8kAmHJyQ691PnYHH4bEL9NtEDEGx");

// All components for game entity init + delegation
export const ALL_COMPONENTS = [
  GAME_CONFIG_COMPONENT,
  PLAYER_STATE_COMPONENT,
  PLAYER_REGISTRY_COMPONENT,
  LEADERBOARD_COMPONENT,
];
