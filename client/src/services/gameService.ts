/**
 * gameService.ts
 * HTTP REST API client with automatic silent retry mechanism.
 */

import type { ClientGameState, Card } from '../../../shared/types.js';

const BASE = '/api/game';

// Helper for sleeping between retries
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function postWithRetry(action: string, body: Record<string, unknown>, retries = 3) {
  let lastError: Error = new Error('Server bilan bog\'lanishda xatolik.');

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${BASE}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      // If successful response
      if (res.ok) {
        return json as ClientGameState & { lastDrawnCard?: Card; pairsFound?: string[] };
      }

      // If business logic error (e.g. "Not your turn", "Name taken"), don't retry, throw immediately
      if (res.status === 400 || res.status === 403) {
        throw new Error(json.error || 'Noto\'g me\'yori.');
      }

      // If 404 (cold start / room transient state) or 5xx, retry after brief delay
      lastError = new Error(json.error || 'Server javob bermadi.');
    } catch (err: any) {
      if (err.message && (err.message.includes('turn') || err.message.includes('Ism') || err.message.includes('Host'))) {
        throw err;
      }
      lastError = err;
    }

    // Wait before retrying (150ms, 350ms...)
    if (attempt < retries - 1) {
      await sleep(150 * (attempt + 1));
    }
  }

  throw lastError;
}

export const gameService = {
  createRoom: (playerName: string, avatar: string) =>
    postWithRetry('create-room', { playerName, avatar }),

  joinRoom: (roomId: string, playerName: string, avatar: string) =>
    postWithRetry('join-room', { roomId: roomId.toUpperCase(), playerName, avatar }),

  toggleReady: (roomId: string, playerId: string) =>
    postWithRetry('toggle-ready', { roomId, playerId }),

  startGame: (roomId: string, playerId: string) =>
    postWithRetry('start-game', { roomId, playerId }),

  drawCard: (roomId: string, playerId: string, targetPlayerId: string, cardIndex: number) =>
    postWithRetry('draw-card', { roomId, playerId, targetPlayerId, cardIndex }),

  kickPlayer: (roomId: string, playerId: string, targetPlayerId: string) =>
    postWithRetry('kick-player', { roomId, playerId, targetPlayerId }),

  restart: (roomId: string, playerId: string) =>
    postWithRetry('restart', { roomId, playerId }),

  getState: async (roomId: string, playerId: string): Promise<ClientGameState | null> => {
    try {
      const res = await fetch(`${BASE}?action=state&roomId=${roomId}&playerId=${playerId}`);
      if (!res.ok) return null; // silently return null on transient 404/500
      const json = await res.json();
      return json as ClientGameState;
    } catch {
      return null; // keep polling silently on network drop
    }
  },
};
