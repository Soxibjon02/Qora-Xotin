/**
 * gameService.ts
 * Replaces Socket.IO with HTTP polling against Vercel Serverless Functions.
 * All state lives in Upstash Redis (server-side).
 */

import type { ClientGameState, Card } from '../../../shared/types.js';

const BASE = '/api/game';

async function post(action: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Server xatoligi.');
  return json as ClientGameState & { lastDrawnCard?: Card; pairsFound?: string[] };
}

export const gameService = {
  /** Create a new room. Returns full sanitized state for the host. */
  createRoom: (playerName: string, avatar: string) =>
    post('create-room', { playerName, avatar }),

  /** Join an existing room by code. */
  joinRoom: (roomId: string, playerName: string, avatar: string) =>
    post('join-room', { roomId: roomId.toUpperCase(), playerName, avatar }),

  /** Toggle this player's ready status. */
  toggleReady: (roomId: string, playerId: string) =>
    post('toggle-ready', { roomId, playerId }),

  /** Host starts the game. */
  startGame: (roomId: string, playerId: string) =>
    post('start-game', { roomId, playerId }),

  /** Current player draws a card from targetPlayer at cardIndex. */
  drawCard: (roomId: string, playerId: string, targetPlayerId: string, cardIndex: number) =>
    post('draw-card', { roomId, playerId, targetPlayerId, cardIndex }),

  /** Host kicks a player. */
  kickPlayer: (roomId: string, playerId: string, targetPlayerId: string) =>
    post('kick-player', { roomId, playerId, targetPlayerId }),

  /** Host restarts game back to lobby. */
  restart: (roomId: string, playerId: string) =>
    post('restart', { roomId, playerId }),

  /** Poll for latest game state. Called every 800ms by the polling hook. */
  getState: async (roomId: string, playerId: string): Promise<ClientGameState> => {
    const res = await fetch(`${BASE}?action=state&roomId=${roomId}&playerId=${playerId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Holat yuklanmadi.');
    return json as ClientGameState;
  },
};
