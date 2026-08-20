import { describe, it, expect } from 'vitest';
import {
  createDeck,
  shuffleDeck,
  distributeCards,
  removePairs,
  getNextTurn,
  getTargetPlayerForDraw,
  checkGameOver,
  getDeckConfiguration
} from '../shared/gameEngine.js';
import { sanitizeGameState } from './server.js';
import { ServerGameState, Card, Player } from '../shared/types.js';

describe('Deck Logic', () => {
  it('should remove exactly 3 Queens, leaving only the Queen of Spades (Qora Xotin)', () => {
    // Check 10 players deck configuration (Full A-K deck)
    const deck = createDeck(10);
    
    // Total cards should be 52 - 3 = 49
    expect(deck.length).toBe(49);
    
    // Find Queens
    const queens = deck.filter(c => c.rank === 'Q');
    expect(queens.length).toBe(1);
    expect(queens[0].suit).toBe('S'); // Queen of Spades
    expect(queens[0].isQoraXotin).toBe(true);

    // Verify there are no duplicate card IDs
    const cardIds = deck.map(c => c.id);
    const uniqueIds = new Set(cardIds);
    expect(uniqueIds.size).toBe(deck.length);
  });

  it('should change deck size based on player count', () => {
    // 3 players -> 25 cards
    const deck3 = createDeck(3);
    expect(deck3.length).toBe(25);
    expect(deck3.filter(c => c.rank === 'Q').length).toBe(1);

    // 5 players -> 33 cards
    const deck5 = createDeck(5);
    expect(deck5.length).toBe(33);
    expect(deck5.filter(c => c.rank === 'Q').length).toBe(1);

    // 8 players -> 49 cards
    const deck8 = createDeck(8);
    expect(deck8.length).toBe(49);
    expect(deck8.filter(c => c.rank === 'Q').length).toBe(1);
  });
});

describe('Distribution Algorithm', () => {
  const playerCounts = [3, 4, 5, 6, 7, 8, 9, 10];

  playerCounts.forEach(count => {
    it(`should distribute cards evenly and validly for ${count} players`, () => {
      const deck = createDeck(count);
      const shuffled = shuffleDeck(deck);
      const playerIds = Array.from({ length: count }, (_, i) => `p-${i}`);
      
      const hands = distributeCards(shuffled, playerIds);

      // Verify all cards are accounted for
      const allDealtCards: Card[] = [];
      playerIds.forEach(pid => {
        allDealtCards.push(...hands[pid]);
      });
      expect(allDealtCards.length).toBe(deck.length);

      // Verify hand sizes differ by at most 1
      const handSizes = playerIds.map(pid => hands[pid].length);
      const maxHandSize = Math.max(...handSizes);
      const minHandSize = Math.min(...handSizes);
      expect(maxHandSize - minHandSize).toBeLessThanOrEqual(1);

      // Verify no duplicate cards across all hands
      const cardIds = allDealtCards.map(c => c.id);
      expect(new Set(cardIds).size).toBe(deck.length);
    });
  });
});

describe('Pair Removal Logic', () => {
  it('should discard standard matching pairs and keep odd cards', () => {
    const hand: Card[] = [
      { id: 'H-7', suit: 'H', rank: '7', isQoraXotin: false },
      { id: 'C-7', suit: 'C', rank: '7', isQoraXotin: false }, // Pair 1
      { id: 'D-K', suit: 'D', rank: 'K', isQoraXotin: false },
      { id: 'S-K', suit: 'S', rank: 'K', isQoraXotin: false }, // Pair 2
      { id: 'S-Q', suit: 'S', rank: 'Q', isQoraXotin: true },  // Queen of Spades (no pairs)
      { id: 'C-A', suit: 'C', rank: 'A', isQoraXotin: false }   // Single A
    ];

    const { newHand, discardedPairs } = removePairs(hand);

    expect(discardedPairs.length).toBe(2);
    expect(discardedPairs.some(p => p.rank === '7')).toBe(true);
    expect(discardedPairs.some(p => p.rank === 'K')).toBe(true);

    expect(newHand.length).toBe(2);
    expect(newHand.some(c => c.rank === 'Q')).toBe(true);
    expect(newHand.some(c => c.rank === 'A')).toBe(true);
  });

  it('should handle odd numbers of same-rank cards (e.g. 3 of a rank)', () => {
    const hand: Card[] = [
      { id: 'H-7', suit: 'H', rank: '7', isQoraXotin: false },
      { id: 'C-7', suit: 'C', rank: '7', isQoraXotin: false }, // forms pair
      { id: 'D-7', suit: 'D', rank: '7', isQoraXotin: false }  // remains single
    ];

    const { newHand, discardedPairs } = removePairs(hand);
    expect(discardedPairs.length).toBe(1);
    expect(newHand.length).toBe(1);
    expect(newHand[0].id).toBe('D-7');
  });

  it('should handle 4 cards of the same rank, resulting in 2 pairs', () => {
    const hand: Card[] = [
      { id: 'H-7', suit: 'H', rank: '7', isQoraXotin: false },
      { id: 'C-7', suit: 'C', rank: '7', isQoraXotin: false },
      { id: 'D-7', suit: 'D', rank: '7', isQoraXotin: false },
      { id: 'S-7', suit: 'S', rank: '7', isQoraXotin: false }
    ];

    const { newHand, discardedPairs } = removePairs(hand);
    expect(discardedPairs.length).toBe(2);
    expect(newHand.length).toBe(0);
  });
});

describe('Turn Management', () => {
  it('should advance to the next player with cards, skipping empty hands', () => {
    const turnOrder = ['p1', 'p2', 'p3', 'p4'];
    const hands: Record<string, Card[]> = {
      p1: [{ id: 'H-A', suit: 'H', rank: 'A', isQoraXotin: false }],
      p2: [], // Empty hand, should be skipped
      p3: [{ id: 'S-Q', suit: 'S', rank: 'Q', isQoraXotin: true }],
      p4: [{ id: 'C-K', suit: 'C', rank: 'K', isQoraXotin: false }]
    };

    const nextTurn = getNextTurn('p1', turnOrder, hands);
    expect(nextTurn).toBe('p3'); // Skips p2

    const nextNextTurn = getNextTurn('p3', turnOrder, hands);
    expect(nextNextTurn).toBe('p4');

    const loopTurn = getNextTurn('p4', turnOrder, hands);
    expect(loopTurn).toBe('p1');
  });

  it('should find correct target player for drawing card', () => {
    const turnOrder = ['p1', 'p2', 'p3', 'p4'];
    const hands: Record<string, Card[]> = {
      p1: [{ id: 'H-A', suit: 'H', rank: 'A', isQoraXotin: false }],
      p2: [],
      p3: [{ id: 'S-Q', suit: 'S', rank: 'Q', isQoraXotin: true }],
      p4: [{ id: 'C-K', suit: 'C', rank: 'K', isQoraXotin: false }]
    };

    const target = getTargetPlayerForDraw('p1', turnOrder, hands);
    expect(target).toBe('p3'); // Skips p2
  });
});

describe('Game Over State', () => {
  it('should trigger game over only when 1 card remains in total', () => {
    const hands: Record<string, Card[]> = {
      p1: [],
      p2: [{ id: 'S-Q', suit: 'S', rank: 'Q', isQoraXotin: true }],
      p3: []
    };

    const overState = checkGameOver(hands);
    expect(overState.isOver).toBe(true);
    expect(overState.loserId).toBe('p2'); // Player holding the Qora Xotin
  });

  it('should not trigger game over when multiple cards remain', () => {
    const hands: Record<string, Card[]> = {
      p1: [{ id: 'H-7', suit: 'H', rank: '7', isQoraXotin: false }],
      p2: [{ id: 'S-Q', suit: 'S', rank: 'Q', isQoraXotin: true }],
      p3: []
    };

    const overState = checkGameOver(hands);
    expect(overState.isOver).toBe(false);
  });
});

describe('Security & Sanitization', () => {
  it('should sanitize the game state so players cannot see other hands', () => {
    const serverState: ServerGameState = {
      roomId: 'QX1234',
      hostId: 'p1',
      status: 'PLAYING',
      players: [
        {
          id: 'p1',
          name: 'Sardor',
          avatar: '🦁',
          hand: [{ id: 'H-7', suit: 'H', rank: '7', isQoraXotin: false }],
          cardCount: 1,
          connected: true,
          ready: true
        },
        {
          id: 'p2',
          name: 'Ali',
          avatar: '🐯',
          hand: [{ id: 'S-Q', suit: 'S', rank: 'Q', isQoraXotin: true }], // Qora Xotin!
          cardCount: 1,
          connected: true,
          ready: true
        }
      ],
      currentTurn: 'p1',
      turnOrder: ['p1', 'p2'],
      deck: [],
      discardedPairs: [],
      loserId: null,
      reconnectTimeout: 60
    };

    // Sanitize for p1
    const p1State = sanitizeGameState(serverState, 'p1');

    // p1 should see their own hand details
    expect(p1State.myHand.length).toBe(1);
    expect(p1State.myHand[0].id).toBe('H-7');

    // p1 should NOT see p2's hand details
    expect((p1State.players.find(p => p.id === 'p2') as any).hand).toBeUndefined();
    
    // but p1 should see that p2 has 1 card
    expect(p1State.players.find(p => p.id === 'p2')?.cardCount).toBe(1);
  });
});
