import { Card, Rank, Suit } from './types.js';

// Ranks and Suits
export const SUITS: Suit[] = ['H', 'D', 'C', 'S'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/**
 * Gets the deck rank configuration based on player count.
 * - 3-4 players: 7 to K (25 cards total: 6 ranks * 4 suits + 1 Queen of Spades)
 * - 5-6 players: 5 to K (33 cards total: 8 ranks * 4 suits + 1 Queen of Spades)
 * - 7-10 players: A to K (49 cards total: 12 ranks * 4 suits + 1 Queen of Spades)
 */
export function getDeckConfiguration(playerCount: number): Rank[] {
  if (playerCount <= 4) {
    return ['7', '8', '9', '10', 'J', 'Q', 'K'];
  } else if (playerCount <= 6) {
    return ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  } else {
    return ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  }
}

/**
 * Creates a playable deck. Removes 3 Queens, leaving only the Queen of Spades (Qora Xotin).
 */
export function createDeck(playerCount: number): Card[] {
  const allowedRanks = getDeckConfiguration(playerCount);
  const deck: Card[] = [];

  for (const rank of allowedRanks) {
    for (const suit of SUITS) {
      if (rank === 'Q' && suit !== 'S') {
        // Exclude other Queens to leave exactly Q♠ as Qora Xotin
        continue;
      }
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        isQoraXotin: rank === 'Q' && suit === 'S'
      });
    }
  }
  return deck;
}

/**
 * Fisher-Yates Shuffle
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Distributes cards as evenly as possible using a pair-minimization algorithm.
 */
export function distributeCards(deck: Card[], playerIds: string[]): Record<string, Card[]> {
  const hands: Record<string, Card[]> = {};
  for (const pid of playerIds) {
    hands[pid] = [];
  }

  const n = playerIds.length;
  const totalCards = deck.length;
  
  // Calculate target hand size for each player
  const baseSize = Math.floor(totalCards / n);
  const remainder = totalCards % n;
  const targetSizes: Record<string, number> = {};
  
  for (let i = 0; i < n; i++) {
    targetSizes[playerIds[i]] = baseSize + (i < remainder ? 1 : 0);
  }

  // Work with a mutable copy of the shuffled deck
  const pool = [...deck];

  // Round-robin distribution with duplicate avoidance
  let hasMoreToDeal = true;
  while (hasMoreToDeal) {
    hasMoreToDeal = false;
    for (const pid of playerIds) {
      if (hands[pid].length < targetSizes[pid] && pool.length > 0) {
        hasMoreToDeal = true;
        // Search the remaining pool for a card whose rank is not in the player's current hand
        let targetIndex = pool.findIndex(card => !hands[pid].some(c => c.rank === card.rank));
        
        // Fallback to the first available card if all remaining cards create a duplicate
        if (targetIndex === -1) {
          targetIndex = 0;
        }

        // Add card to hand and remove from pool
        const [card] = pool.splice(targetIndex, 1);
        hands[pid].push(card);
      }
    }
  }

  return hands;
}

/**
 * Scans player's hand and discards pairs by rank.
 * Returns the new hand and the list of discarded pairs.
 */
export function removePairs(hand: Card[]): { newHand: Card[]; discardedPairs: { rank: Rank; suit1: Suit; suit2: Suit }[] } {
  const rankGroups: Record<Rank, Card[]> = {} as Record<Rank, Card[]>;
  for (const card of hand) {
    if (!rankGroups[card.rank]) {
      rankGroups[card.rank] = [];
    }
    rankGroups[card.rank].push(card);
  }

  const newHand: Card[] = [];
  const discardedPairs: { rank: Rank; suit1: Suit; suit2: Suit }[] = [];

  for (const rank of Object.keys(rankGroups) as Rank[]) {
    const cards = rankGroups[rank];
    
    // If cards is undefined or empty, skip
    if (!cards || cards.length === 0) continue;

    // A rank can have 1, 2, 3, or 4 cards.
    // 1 card -> Keep
    // 2 cards -> 1 pair, Keep 0
    // 3 cards -> 1 pair, Keep 1
    // 4 cards -> 2 pairs, Keep 0
    let i = 0;
    while (i < cards.length) {
      if (i + 1 < cards.length) {
        // Form a pair
        discardedPairs.push({
          rank,
          suit1: cards[i].suit,
          suit2: cards[i + 1].suit
        });
        i += 2;
      } else {
        // Odd card remains
        newHand.push(cards[i]);
        i += 1;
      }
    }
  }

  return { newHand, discardedPairs };
}

/**
 * Selects the next player whose turn it is.
 * Skips players who have 0 cards in hand.
 */
export function getNextTurn(currentTurn: string, turnOrder: string[], hands: Record<string, Card[]>): string {
  const currentIndex = turnOrder.indexOf(currentTurn);
  if (currentIndex === -1) return currentTurn;

  for (let i = 1; i <= turnOrder.length; i++) {
    const nextIndex = (currentIndex + i) % turnOrder.length;
    const nextPlayerId = turnOrder[nextIndex];
    if (hands[nextPlayerId] && hands[nextPlayerId].length > 0) {
      return nextPlayerId;
    }
  }
  return currentTurn;
}

/**
 * Finds the next eligible player to draw cards from.
 * In a clockwise/circular flow, this is the player sitting after the current turn player who has >0 cards.
 */
export function getTargetPlayerForDraw(currentTurn: string, turnOrder: string[], hands: Record<string, Card[]>): string | null {
  const currentIndex = turnOrder.indexOf(currentTurn);
  if (currentIndex === -1) return null;

  for (let i = 1; i < turnOrder.length; i++) {
    const nextIndex = (currentIndex + i) % turnOrder.length;
    const nextPlayerId = turnOrder[nextIndex];
    if (hands[nextPlayerId] && hands[nextPlayerId].length > 0) {
      return nextPlayerId;
    }
  }
  return null;
}

/**
 * Evaluates whether the game is over.
 * Game is over when only 1 card remains in total (which is Qora Xotin).
 */
export function checkGameOver(hands: Record<string, Card[]>): { isOver: boolean; loserId: string | null } {
  let totalCards = 0;
  let loserId: string | null = null;

  for (const [playerId, hand] of Object.entries(hands)) {
    if (hand.length > 0) {
      totalCards += hand.length;
      loserId = playerId; // Candidate loser (if it's the last one)
    }
  }

  if (totalCards === 1) {
    return { isOver: true, loserId };
  }

  // Fallback: If for some reason all cards are gone (not possible in regular play since Queen can't be paired)
  if (totalCards === 0) {
    return { isOver: true, loserId: null };
  }

  return { isOver: false, loserId: null };
}
