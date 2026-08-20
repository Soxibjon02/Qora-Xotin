import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  createDeck, shuffleDeck, distributeCards, removePairs,
  getNextTurn, getTargetPlayerForDraw, checkGameOver
} from '../shared/gameEngine.js';
import type { ServerGameState, Player, Card, ClientGameState, ClientPlayer, Rank } from '../shared/types.js';
import { store, usingMemoryFallback } from './store.js';

const ROOM_TTL = 86400; // 24 hours
const AVATARS = ['🦁', '🐯', '🐼', '🦊', '🐨', '🐻', '🐰', '🐹', '🐸', '🐵'];

if (usingMemoryFallback) {
  // eslint-disable-next-line no-console
  console.warn(
    '[qora-xotin] UPSTASH_REDIS_REST_URL/TOKEN topilmadi — vaqtinchalik xotira (in-memory) ' +
    "saqlash rejimidan foydalanilmoqda. Ko'p serverli/production muhitda barqaror ishlashi " +
    "uchun Vercel loyihasida Upstash Redis muhit o'zgaruvchilarini sozlang."
  );
}

// ─── Helper: generate unique room code ──────────────────────────────────────
function genRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ─── Helper: generate unique player ID ──────────────────────────────────────
function genPlayerId(): string {
  return Math.random().toString(36).slice(2, 11);
}

// ─── Helper: load room from the store ───────────────────────────────────────
async function getRoom(roomId: string): Promise<ServerGameState | null> {
  if (!roomId) return null;
  return await store.get<ServerGameState>(`room:${roomId}`);
}

// ─── Helper: save room to the store ─────────────────────────────────────────
async function saveRoom(room: ServerGameState): Promise<void> {
  await store.set(`room:${room.roomId}`, room, { ex: ROOM_TTL });
}

// ─── Helper: sanitize server state for a specific client ────────────────────
function sanitize(room: ServerGameState, playerId: string): ClientGameState {
  const me = room.players.find(p => p.id === playerId);
  const totalCards = room.players.reduce((n, p) => n + p.hand.length, 0);

  const sanitizedPlayers: ClientPlayer[] = room.players.map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    cardCount: p.hand.length,
    connected: p.connected,
    ready: p.ready,
  }));

  return {
    roomId: room.roomId,
    hostId: room.hostId,
    status: room.status,
    players: sanitizedPlayers,
    currentTurn: room.currentTurn,
    turnOrder: room.turnOrder,
    discardedPairsCount: room.discardedPairs.length,
    discardedPairs: room.discardedPairs,
    loserId: room.loserId,
    myHand: me ? me.hand : [],
    myId: playerId,
    isHost: room.hostId === playerId,
    cardsInRoundCount: totalCards,
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query.action as string) || (req.body?.action as string);

  try {
    // ── GET /api/game?action=state ─────────────────────────────────────────
    if (action === 'state') {
      const roomId = (req.query.roomId || req.body?.roomId) as string;
      const playerId = (req.query.playerId || req.body?.playerId) as string;
      if (!roomId || !playerId) return res.status(400).json({ error: 'roomId va playerId talab qilinadi.' });

      const room = await getRoom(roomId);
      if (!room) return res.status(404).json({ error: 'Xona topilmadi.' });

      // ── Heartbeat: mark this player as alive (5-minute TTL) ───────────────
      await store.set(`seen:${roomId}:${playerId}`, Date.now(), { ex: 300 });

      // ── Presence: mark players disconnected only after 90s of no polling ──
      // 90 s gives plenty of buffer for slow devices and brief network hiccups.
      // We only update the room in Redis when at least one status actually changes.
      const DISCONNECT_TIMEOUT_MS = 90_000;
      let changed = false;
      for (const p of room.players) {
        const lastSeen = await store.get<number>(`seen:${roomId}:${p.id}`);
        const isConnected = lastSeen
          ? (Date.now() - lastSeen) < DISCONNECT_TIMEOUT_MS
          : p.id === playerId; // treat the requesting player as connected
        if (p.connected !== isConnected) {
          p.connected = isConnected;
          changed = true;
        }
      }

      // Only pause if ALL non-requesting players are disconnected (not just one),
      // and only resume automatically once everyone is back.
      if (changed) {
        if (room.status === 'PLAYING') {
          const disconnectedCount = room.players.filter(p => !p.connected).length;
          // Pause only when more than half are gone (graceful for brief drops)
          if (disconnectedCount >= Math.ceil(room.players.length / 2)) {
            room.status = 'PAUSED';
          }
        } else if (room.status === 'PAUSED') {
          const allConnected = room.players.every(p => p.connected);
          if (allConnected) room.status = 'PLAYING';
        }
        await saveRoom(room);
      }

      return res.json(sanitize(room, playerId));
    }

    // All other actions are POST
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};

    // ── create-room ────────────────────────────────────────────────────────
    if (action === 'create-room') {
      const { playerName, avatar } = body;
      if (!playerName?.trim()) return res.status(400).json({ error: 'Ism kiriting.' });

      let roomId = genRoomId();
      // Ensure unique room
      while (await getRoom(roomId)) roomId = genRoomId();

      const playerId = genPlayerId();
      const host: Player = {
        id: playerId,
        name: playerName.trim().slice(0, 14),
        avatar: avatar || AVATARS[0],
        hand: [],
        cardCount: 0,
        connected: true,
        ready: true,
      };

      const room: ServerGameState = {
        roomId,
        hostId: playerId,
        status: 'LOBBY',
        players: [host],
        currentTurn: '',
        turnOrder: [],
        deck: [],
        discardedPairs: [],
        loserId: null,
        reconnectTimeout: 30,
      };

      await saveRoom(room);
      await store.set(`seen:${roomId}:${playerId}`, Date.now(), { ex: 300 });

      return res.json({ ...sanitize(room, playerId) });
    }

    // ── join-room ──────────────────────────────────────────────────────────
    if (action === 'join-room') {
      const { playerName, avatar } = body;
      const roomId = typeof body.roomId === 'string' ? body.roomId.toUpperCase() : '';
      if (!roomId) return res.status(400).json({ error: 'Xona kodini kiriting.' });
      if (!playerName?.trim()) return res.status(400).json({ error: 'Ism kiriting.' });
      const room = await getRoom(roomId);
      if (!room) return res.status(404).json({ error: 'Xona topilmadi.' });
      if (room.status !== 'LOBBY') return res.status(400).json({ error: "O'yin allaqachon boshlangan." });
      if (room.players.length >= 10) return res.status(400).json({ error: "Xona to'ldi (max 10)." });
      if (room.players.some(p => p.name.toLowerCase() === playerName?.trim().toLowerCase()))
        return res.status(400).json({ error: 'Bu ism allaqachon ishlatilmoqda.' });

      const playerId = genPlayerId();
      const newPlayer: Player = {
        id: playerId,
        name: (playerName || 'Mehmon').trim().slice(0, 14),
        avatar: avatar || AVATARS[room.players.length % AVATARS.length],
        hand: [],
        cardCount: 0,
        connected: true,
        ready: false,
      };

      room.players.push(newPlayer);
      await saveRoom(room);
      await store.set(`seen:${room.roomId}:${playerId}`, Date.now(), { ex: 300 });

      return res.json(sanitize(room, playerId));
    }

    // ── toggle-ready ───────────────────────────────────────────────────────
    if (action === 'toggle-ready') {
      const { roomId, playerId } = body;
      const room = await getRoom(roomId);
      if (!room) return res.status(404).json({ error: 'Xona topilmadi.' });

      const player = room.players.find(p => p.id === playerId);
      if (!player) return res.status(404).json({ error: "O'yinchi topilmadi." });

      player.ready = !player.ready;
      await saveRoom(room);
      return res.json(sanitize(room, playerId));
    }

    // ── start-game ─────────────────────────────────────────────────────────
    if (action === 'start-game') {
      const { roomId, playerId } = body;
      const room = await getRoom(roomId);
      if (!room) return res.status(404).json({ error: 'Xona topilmadi.' });
      if (room.hostId !== playerId) return res.status(403).json({ error: 'Faqat host boshlaydi.' });
      if (room.players.length < 3) return res.status(400).json({ error: 'Kamida 3 ta o\'yinchi kerak.' });

      const deck = createDeck(room.players.length);
      const shuffled = shuffleDeck(deck);
      const playerIds = room.players.map(p => p.id);
      const hands = distributeCards(shuffled, playerIds);

      room.discardedPairs = [];
      for (const player of room.players) {
        const { newHand, discardedPairs } = removePairs(hands[player.id]);
        player.hand = newHand;
        player.cardCount = newHand.length;
        room.discardedPairs.push(...discardedPairs);
      }

      room.turnOrder = [...playerIds];
      room.status = 'PLAYING';

      // Pick a random eligible first player
      const eligible = room.turnOrder.filter(id => {
        const p = room.players.find(pl => pl.id === id);
        return p && p.hand.length > 0;
      });
      room.currentTurn = eligible[Math.floor(Math.random() * eligible.length)] || playerIds[0];
      room.loserId = null;

      await saveRoom(room);
      return res.json(sanitize(room, playerId));
    }

    // ── draw-card ──────────────────────────────────────────────────────────
    if (action === 'draw-card') {
      const { roomId, playerId, targetPlayerId, cardIndex } = body;
      const room = await getRoom(roomId);
      if (!room) return res.status(404).json({ error: 'Xona topilmadi.' });
      if (room.status !== 'PLAYING') return res.status(400).json({ error: "O'yin davom etmayapti." });
      if (room.currentTurn !== playerId) return res.status(400).json({ error: 'Navbatingiz emas.' });

      const playerHands = room.players.reduce((acc, p) => {
        acc[p.id] = p.hand;
        return acc;
      }, {} as Record<string, Card[]>);

      const expectedTarget = getTargetPlayerForDraw(playerId, room.turnOrder, playerHands);
      if (expectedTarget !== targetPlayerId) return res.status(400).json({ error: "Noto'g'ri o'yinchi." });

      const drawer = room.players.find(p => p.id === playerId)!;
      const target = room.players.find(p => p.id === targetPlayerId)!;

      if (!target || cardIndex < 0 || cardIndex >= target.hand.length)
        return res.status(400).json({ error: "Noto'g'ri karta indeksi." });

      // Perform draw
      const [drawnCard] = target.hand.splice(cardIndex, 1);
      drawer.hand.push(drawnCard);

      // Check pairs
      const { newHand, discardedPairs } = removePairs(drawer.hand);
      if (discardedPairs.length > 0) {
        drawer.hand = newHand;
        room.discardedPairs.push(...discardedPairs);
      }

      // Update card counts
      for (const p of room.players) p.cardCount = p.hand.length;

      // Check game over
      const updatedHands = room.players.reduce((acc, p) => {
        acc[p.id] = p.hand;
        return acc;
      }, {} as Record<string, Card[]>);

      const { isOver, loserId } = checkGameOver(updatedHands);
      if (isOver) {
        room.status = 'GAMEOVER';
        room.loserId = loserId;
      } else {
        room.currentTurn = getNextTurn(playerId, room.turnOrder, updatedHands);
      }

      await saveRoom(room);

      // Return state for drawer (includes the drawn card)
      const clientState = sanitize(room, playerId);
      return res.json({ ...clientState, lastDrawnCard: drawnCard, pairsFound: discardedPairs.map((p: { rank: Rank }) => p.rank) });
    }

    // ── kick-player ────────────────────────────────────────────────────────
    if (action === 'kick-player') {
      const { roomId, playerId, targetPlayerId } = body;
      const room = await getRoom(roomId);
      if (!room) return res.status(404).json({ error: 'Xona topilmadi.' });
      if (room.hostId !== playerId) return res.status(403).json({ error: 'Faqat host chetlashtiradi.' });

      const targetIdx = room.players.findIndex(p => p.id === targetPlayerId);
      if (targetIdx === -1) return res.status(404).json({ error: "O'yinchi topilmadi." });

      const [kicked] = room.players.splice(targetIdx, 1);
      room.turnOrder = room.turnOrder.filter(id => id !== targetPlayerId);

      if (room.status === 'PLAYING' || room.status === 'PAUSED') {
        // Redistribute kicked player's cards
        for (let i = 0; i < kicked.hand.length; i++) {
          const recipient = room.players[i % room.players.length];
          recipient.hand.push(kicked.hand[i]);
        }
        // Remove new pairs
        for (const p of room.players) {
          const { newHand, discardedPairs } = removePairs(p.hand);
          p.hand = newHand;
          p.cardCount = newHand.length;
          room.discardedPairs.push(...discardedPairs);
        }

        if (room.currentTurn === targetPlayerId) {
          const updatedHands = room.players.reduce((acc, p) => { acc[p.id] = p.hand; return acc; }, {} as Record<string, Card[]>);
          room.currentTurn = getNextTurn(targetPlayerId, room.turnOrder, updatedHands);
        }

        const updatedHands = room.players.reduce((acc, p) => { acc[p.id] = p.hand; return acc; }, {} as Record<string, Card[]>);
        const { isOver, loserId } = checkGameOver(updatedHands);
        if (isOver) { room.status = 'GAMEOVER'; room.loserId = loserId; }
        else if (room.players.length < 3) { room.status = 'GAMEOVER'; room.loserId = null; }
        else room.status = 'PLAYING';
      }

      for (const p of room.players) p.cardCount = p.hand.length;
      await saveRoom(room);
      return res.json(sanitize(room, playerId));
    }

    // ── restart ────────────────────────────────────────────────────────────
    if (action === 'restart') {
      const { roomId, playerId } = body;
      const room = await getRoom(roomId);
      if (!room) return res.status(404).json({ error: 'Xona topilmadi.' });
      if (room.hostId !== playerId) return res.status(403).json({ error: 'Faqat host qayta boshlaydi.' });

      room.status = 'LOBBY';
      room.currentTurn = '';
      room.turnOrder = [];
      room.deck = [];
      room.discardedPairs = [];
      room.loserId = null;
      for (const p of room.players) {
        p.hand = [];
        p.cardCount = 0;
        p.ready = p.id === room.hostId;
      }

      await saveRoom(room);
      return res.json(sanitize(room, playerId));
    }

    return res.status(400).json({ error: "Noma'lum buyruq." });
  } catch (err: any) {
    console.error('Game API error:', err);
    return res.status(500).json({ error: 'Server xatoligi.' });
  }
}
