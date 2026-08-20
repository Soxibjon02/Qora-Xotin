export type Suit = 'H' | 'D' | 'C' | 'S'; // Hearts, Diamonds, Clubs, Spades
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  id: string; // Unique ID (e.g. "H-A", "S-Q")
  suit: Suit;
  rank: Rank;
  isQoraXotin: boolean;
}

export interface Player {
  id: string;
  name: string;
  avatar: string; // Emojis like 🦁, 🐯, 🐼, 🦊, 🐨 etc.
  hand: Card[]; // Private, only revealed to owner
  cardCount: number;
  connected: boolean;
  ready: boolean;
}

export type GameStatus = 'LOBBY' | 'PLAYING' | 'GAMEOVER' | 'PAUSED';

export interface GameSettings {
  maxPlayers: number;
  allowStartWithoutReady: boolean;
}

// Full Server-Authoritative State
export interface ServerGameState {
  roomId: string;
  hostId: string;
  status: GameStatus;
  players: Player[];
  currentTurn: string; // Player ID whose turn it is
  turnOrder: string[]; // List of player IDs in circular order
  deck: Card[];
  discardedPairs: { rank: Rank; suit1: Suit; suit2: Suit }[];
  loserId: string | null;
  reconnectTimeout: number; // in seconds
  pausedTimeLeft?: number;
}

// Sanitized Client State (Safe from cheating)
export interface ClientPlayer {
  id: string;
  name: string;
  avatar: string;
  cardCount: number;
  connected: boolean;
  ready: boolean;
}

export interface ClientGameState {
  roomId: string;
  hostId: string;
  status: GameStatus;
  players: ClientPlayer[];
  currentTurn: string;
  turnOrder: string[];
  discardedPairsCount: number;
  discardedPairs: { rank: Rank; suit1: Suit; suit2: Suit }[];
  loserId: string | null;
  // Local client info
  myHand: Card[]; // Only populated for the requesting player
  myId: string;
  isHost: boolean;
  cardsInRoundCount: number; // total active cards in play
}
