import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import os from 'os';
// @ts-ignore
import qrcode from 'qrcode-terminal';
import {
  createDeck,
  shuffleDeck,
  distributeCards,
  removePairs,
  getNextTurn,
  getTargetPlayerForDraw,
  checkGameOver
} from '../shared/gameEngine.js';
import { Card, ServerGameState, ClientGameState, Player, GameStatus, Rank } from '../shared/types.js';

import path from 'path';

const app = express();
app.use(cors());

// Serve built React client static files
const clientDistPath = path.resolve(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.send({ status: 'ok', time: new Date() });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Storage for active rooms
const rooms = new Map<string, ServerGameState>();

// Map to associate socket IDs with room/player info for disconnection handling
const socketToPlayerMap = new Map<string, { roomId: string; playerId: string }>();

// Disconnect timers (playerId -> Timeout)
const disconnectTimeouts = new Map<string, NodeJS.Timeout>();

// Helper to generate a unique room code
function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Readable alphanumeric
  let roomId = '';
  do {
    roomId = '';
    for (let i = 0; i < 6; i++) {
      roomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(roomId));
  return roomId;
}

// Helper to sanitize server state for a specific client
export function sanitizeGameState(room: ServerGameState, playerId: string): ClientGameState {
  const myPlayer = room.players.find(p => p.id === playerId);
  const myHand = myPlayer ? myPlayer.hand : [];
  const isHost = room.hostId === playerId;

  const sanitizedPlayers = room.players.map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    cardCount: p.hand.length,
    connected: p.connected,
    ready: p.ready
  }));

  const cardsInRoundCount = room.players.reduce((sum, p) => sum + p.hand.length, 0);

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
    myHand,
    myId: playerId,
    isHost,
    cardsInRoundCount
  };
}

// Broadcast sanitized game state to all players in a room
function broadcastRoomState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const player of room.players) {
    io.to(player.id).emit('room_state', sanitizeGameState(room, player.id));
  }
}

// Avatars list
const AVATARS = ['🦁', '🐯', '🐼', '🦊', '🐨', '🐻', '🐰', '🐹', '🐸', '🐵'];

io.on('connection', (socket: Socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create Room
  socket.on('create_room', ({ playerName, avatar }: { playerName: string; avatar: string }) => {
    const roomId = generateRoomId();
    const playerId = socket.id; // Socket ID serves as temporary socket mapping, but we can override it on reconnect.

    // Force join socket room
    socket.join(roomId);
    socket.join(playerId); // also join private channel

    const hostPlayer: Player = {
      id: playerId,
      name: playerName.trim() || 'Host',
      avatar: avatar || AVATARS[0],
      hand: [],
      cardCount: 0,
      connected: true,
      ready: true // Host is ready by default
    };

    const newRoom: ServerGameState = {
      roomId,
      hostId: playerId,
      status: 'LOBBY',
      players: [hostPlayer],
      currentTurn: '',
      turnOrder: [],
      deck: [],
      discardedPairs: [],
      loserId: null,
      reconnectTimeout: 60
    };

    rooms.set(roomId, newRoom);
    socketToPlayerMap.set(socket.id, { roomId, playerId });

    console.log(`Room created: ${roomId} by ${playerName}`);
    socket.emit('room_state', sanitizeGameState(newRoom, playerId));
  });

  // Join Room
  socket.on('join_room', ({ roomId, playerName, avatar }: { roomId: string; playerName: string; avatar: string }) => {
    const upperRoomId = roomId.trim().toUpperCase();
    const room = rooms.get(upperRoomId);

    if (!room) {
      socket.emit('error_message', 'Xona topilmadi.');
      return;
    }

    if (room.status !== 'LOBBY') {
      socket.emit('error_message', 'O\'yin allaqachon boshlangan.');
      return;
    }

    if (room.players.length >= 10) {
      socket.emit('error_message', 'Xona to\'lib bo\'lgan (maksimal 10 o\'yinchi).');
      return;
    }

    const nameExists = room.players.some(p => p.name.toLowerCase() === playerName.trim().toLowerCase());
    if (nameExists) {
      socket.emit('error_message', 'Ushbu ism allaqachon ishlatilmoqda.');
      return;
    }

    const playerId = socket.id;
    socket.join(upperRoomId);
    socket.join(playerId);

    const newPlayer: Player = {
      id: playerId,
      name: playerName.trim() || `Player ${room.players.length + 1}`,
      avatar: avatar || AVATARS[room.players.length % AVATARS.length],
      hand: [],
      cardCount: 0,
      connected: true,
      ready: false
    };

    room.players.push(newPlayer);
    socketToPlayerMap.set(socket.id, { roomId: upperRoomId, playerId });

    console.log(`Player ${playerName} joined Room ${upperRoomId}`);
    broadcastRoomState(upperRoomId);
  });

  // Toggle Ready
  socket.on('toggle_ready', ({ roomId, playerId }: { roomId: string; playerId: string }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.ready = !player.ready;
      broadcastRoomState(roomId);
    }
  });

  // Start Game
  socket.on('start_game', ({ roomId, playerId }: { roomId: string; playerId: string }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.hostId !== playerId) {
      socket.emit('error_message', 'Faqat xona egasi o\'yinni boshlashi mumkin.');
      return;
    }

    if (room.players.length < 3) {
      socket.emit('error_message', 'O\'yinni boshlash uchun kamida 3 ta o\'yinchi bo\'lishi kerak.');
      return;
    }

    const allReady = room.players.every(p => p.ready || p.id === room.hostId);
    if (!allReady) {
      socket.emit('error_message', 'Barcha o\'yinchilar tayyor bo\'lishi kutilmoqda.');
      return;
    }

    // 1. Setup the deck based on player count
    const deck = createDeck(room.players.length);
    const shuffledDeck = shuffleDeck(deck);

    // 2. Distribute cards
    const playerIds = room.players.map(p => p.id);
    const hands = distributeCards(shuffledDeck, playerIds);

    // 3. Remove initial pairs for each player
    room.discardedPairs = [];
    for (const player of room.players) {
      const { newHand, discardedPairs } = removePairs(hands[player.id]);
      player.hand = newHand;
      player.cardCount = newHand.length;
      room.discardedPairs.push(...discardedPairs);
    }

    // 4. Set turn flow
    room.deck = shuffledDeck; // Keep copy on server
    room.status = 'PLAYING';
    room.turnOrder = [...playerIds];
    
    // Choose a random player to start who actually has cards
    const eligiblePlayers = room.turnOrder.filter(pid => {
      const p = room.players.find(pl => pl.id === pid);
      return p && p.hand.length > 0;
    });

    if (eligiblePlayers.length > 0) {
      room.currentTurn = eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)];
    } else {
      room.currentTurn = room.turnOrder[0];
    }

    room.loserId = null;

    console.log(`Game started in room ${roomId}. First turn: ${room.currentTurn}`);
    broadcastRoomState(roomId);
    io.to(roomId).emit('game_started_announcement', 'O\'yin boshlandi! Juftliklar avtomatik olib tashlandi.');
  });

  // Draw Card
  socket.on('draw_card', ({ roomId, playerId, targetPlayerId, cardIndex }: { roomId: string; playerId: string; targetPlayerId: string; cardIndex: number }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.status !== 'PLAYING') {
      socket.emit('error_message', 'O\'yin hozir davom etmayapti.');
      return;
    }

    if (room.currentTurn !== playerId) {
      socket.emit('error_message', 'Hozir sizning navbatingiz emas.');
      return;
    }

    // Verify correct target
    const expectedTarget = getTargetPlayerForDraw(playerId, room.turnOrder, room.players.reduce((acc, p) => {
      acc[p.id] = p.hand;
      return acc;
    }, {} as Record<string, Card[]>));

    if (expectedTarget !== targetPlayerId) {
      socket.emit('error_message', 'Noto\'g\'ri o\'yinchidan karta olmoqchisiz.');
      return;
    }

    const drawer = room.players.find(p => p.id === playerId);
    const target = room.players.find(p => p.id === targetPlayerId);

    if (!drawer || !target) return;

    if (cardIndex < 0 || cardIndex >= target.hand.length) {
      socket.emit('error_message', 'Noto\'g\'ri karta tanlandi.');
      return;
    }

    // Perform draw
    const drawnCard = target.hand[cardIndex];
    target.hand.splice(cardIndex, 1);
    target.cardCount = target.hand.length;

    // Send animation event. Drawer sees card details, others do not.
    io.to(roomId).emit('animate_card_draw', {
      drawerId: playerId,
      targetId: targetPlayerId,
      cardIndex,
      drawnCardFace: null // default for spectators
    });

    // Send drawn card info directly to the drawer socket
    io.to(playerId).emit('drawn_card_reveal', {
      drawnCard
    });

    // Wait for the animation to complete in the client (e.g. 1.2 seconds) before updating state
    setTimeout(() => {
      // Add card to drawer hand
      drawer.hand.push(drawnCard);
      drawer.cardCount = drawer.hand.length;

      // Check for pairs
      const { newHand, discardedPairs } = removePairs(drawer.hand);
      
      const pairFound = discardedPairs.length > 0;
      if (pairFound) {
        drawer.hand = newHand;
        drawer.cardCount = newHand.length;
        room.discardedPairs.push(...discardedPairs);

        // Tell clients a pair was found to animate it
        io.to(roomId).emit('animate_pair_removal', {
          playerId: drawer.id,
          removedRanks: discardedPairs.map(p => p.rank)
        });
      }

      // Check game over
      const playerHands = room.players.reduce((acc, p) => {
        acc[p.id] = p.hand;
        return acc;
      }, {} as Record<string, Card[]>);

      const gameOverCheck = checkGameOver(playerHands);
      if (gameOverCheck.isOver) {
        room.status = 'GAMEOVER';
        room.loserId = gameOverCheck.loserId;
        console.log(`Game over in room ${roomId}. Loser: ${room.loserId}`);
      } else {
        // Advance turn
        room.currentTurn = getNextTurn(playerId, room.turnOrder, playerHands);
      }

      broadcastRoomState(roomId);
    }, 1200);
  });

  // Reconnect Player
  socket.on('reconnect_player', ({ roomId, playerId }: { roomId: string; playerId: string }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('reconnect_failed', 'Xona topilmadi.');
      return;
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      socket.emit('reconnect_failed', 'O\'yinchi topilmadi.');
      return;
    }

    // Cancel existing timeout if any
    const existingTimeout = disconnectTimeouts.get(playerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      disconnectTimeouts.delete(playerId);
    }

    // Update socket mapping
    socketToPlayerMap.delete(socket.id); // remove old socket association
    socket.join(roomId);
    socket.join(playerId);

    player.connected = true;
    socketToPlayerMap.set(socket.id, { roomId, playerId });

    // If game was paused and all active players are reconnected, we could unpause.
    // In our model, we show a pause dialog if anyone is disconnected.
    const runCheck = room.players.every(p => p.connected);
    if (runCheck && room.status === 'PAUSED') {
      room.status = 'PLAYING';
    }

    console.log(`Player ${player.name} reconnected in Room ${roomId}`);
    broadcastRoomState(roomId);
    socket.emit('reconnect_success');
  });

  // Kick / Remove Player (Host action)
  socket.on('kick_player', ({ roomId, playerId, targetPlayerId }: { roomId: string; playerId: string; targetPlayerId: string }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.hostId !== playerId) {
      socket.emit('error_message', 'Faqat xona egasi o\'yinchilarni chetlashtirishi mumkin.');
      return;
    }

    const targetPlayerIndex = room.players.findIndex(p => p.id === targetPlayerId);
    if (targetPlayerIndex === -1) return;

    const targetPlayer = room.players[targetPlayerIndex];
    console.log(`Host kicked player ${targetPlayer.name} from room ${roomId}`);

    // If playing, redistribute their cards
    if (room.status === 'PLAYING' || room.status === 'PAUSED') {
      const cardsToRedistribute = [...targetPlayer.hand];
      room.players.splice(targetPlayerIndex, 1);
      
      // Filter out from turn order
      room.turnOrder = room.turnOrder.filter(pid => pid !== targetPlayerId);

      // Redistribute their cards round-robin to remaining players
      if (room.players.length > 0 && cardsToRedistribute.length > 0) {
        let dealIndex = 0;
        for (const card of cardsToRedistribute) {
          const recipient = room.players[dealIndex % room.players.length];
          recipient.hand.push(card);
          dealIndex++;
        }

        // Re-scan and remove pairs for all remaining players
        for (const player of room.players) {
          const { newHand, discardedPairs } = removePairs(player.hand);
          player.hand = newHand;
          player.cardCount = newHand.length;
          room.discardedPairs.push(...discardedPairs);
        }
      }

      // Check if turn was on target, advance it
      if (room.currentTurn === targetPlayerId) {
        const playerHands = room.players.reduce((acc, p) => {
          acc[p.id] = p.hand;
          return acc;
        }, {} as Record<string, Card[]>);
        room.currentTurn = getNextTurn(room.currentTurn, room.turnOrder, playerHands);
      }

      // Check game over
      const playerHands = room.players.reduce((acc, p) => {
        acc[p.id] = p.hand;
        return acc;
      }, {} as Record<string, Card[]>);

      const gameOverCheck = checkGameOver(playerHands);
      if (gameOverCheck.isOver) {
        room.status = 'GAMEOVER';
        room.loserId = gameOverCheck.loserId;
      } else if (room.players.length < 3) {
        // Not enough players left to play
        room.status = 'GAMEOVER';
        room.loserId = null; // No clear loser, game aborted
      } else {
        // Resume play if it was paused
        const allConnected = room.players.every(p => p.connected);
        room.status = allConnected ? 'PLAYING' : 'PAUSED';
      }
    } else {
      // In lobby, just remove
      room.players.splice(targetPlayerIndex, 1);
      // If kicked player was host (not possible here since host initiated kick), otherwise standard
    }

    broadcastRoomState(roomId);
  });

  // Restart Game
  socket.on('restart_game', ({ roomId, playerId }: { roomId: string; playerId: string }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.hostId !== playerId) {
      socket.emit('error_message', 'Faqat xona egasi yangi o\'yin boshlashi mumkin.');
      return;
    }

    room.status = 'LOBBY';
    room.currentTurn = '';
    room.turnOrder = [];
    room.deck = [];
    room.discardedPairs = [];
    room.loserId = null;
    
    // Reset players ready status (except host)
    for (const p of room.players) {
      p.hand = [];
      p.cardCount = 0;
      p.ready = p.id === room.hostId;
    }

    console.log(`Room ${roomId} reset to lobby.`);
    broadcastRoomState(roomId);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const mapping = socketToPlayerMap.get(socket.id);
    if (!mapping) return;

    const { roomId, playerId } = mapping;
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    // Mark player as disconnected
    player.connected = false;

    // Pause the game if it is currently playing
    if (room.status === 'PLAYING') {
      room.status = 'PAUSED';
    }

    broadcastRoomState(roomId);

    // Start reconnection window timer (60 seconds)
    const timeout = setTimeout(() => {
      console.log(`Player ${player.name} in Room ${roomId} reconnection window expired.`);
      
      const activeRoom = rooms.get(roomId);
      if (!activeRoom) return;

      // Remove player permanently
      const pIndex = activeRoom.players.findIndex(p => p.id === playerId);
      if (pIndex !== -1) {
        // If they were host, assign a new host
        const wasHost = activeRoom.hostId === playerId;
        
        // Remove player
        activeRoom.players.splice(pIndex, 1);
        activeRoom.turnOrder = activeRoom.turnOrder.filter(pid => pid !== playerId);

        if (activeRoom.players.length === 0) {
          // Room empty, delete room
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted because all players left.`);
          return;
        }

        if (wasHost) {
          activeRoom.hostId = activeRoom.players[0].id;
          console.log(`New host for Room ${roomId} is ${activeRoom.players[0].name}`);
        }

        // Redistribute cards if game is active
        if (activeRoom.status === 'PLAYING' || activeRoom.status === 'PAUSED') {
          const cardsToRedistribute = [...player.hand];
          if (cardsToRedistribute.length > 0) {
            let dealIndex = 0;
            for (const card of cardsToRedistribute) {
              const recipient = activeRoom.players[dealIndex % activeRoom.players.length];
              recipient.hand.push(card);
              dealIndex++;
            }

            // Remove pairs
            for (const pl of activeRoom.players) {
              const { newHand, discardedPairs } = removePairs(pl.hand);
              pl.hand = newHand;
              pl.cardCount = newHand.length;
              activeRoom.discardedPairs.push(...discardedPairs);
            }
          }

          // Advance turn if it was theirs
          if (activeRoom.currentTurn === playerId) {
            const playerHands = activeRoom.players.reduce((acc, p) => {
              acc[p.id] = p.hand;
              return acc;
            }, {} as Record<string, Card[]>);
            activeRoom.currentTurn = getNextTurn(activeRoom.currentTurn, activeRoom.turnOrder, playerHands);
          }

          // Check game over
          const playerHands = activeRoom.players.reduce((acc, p) => {
            acc[p.id] = p.hand;
            return acc;
          }, {} as Record<string, Card[]>);

          const gameOverCheck = checkGameOver(playerHands);
          if (gameOverCheck.isOver) {
            activeRoom.status = 'GAMEOVER';
            activeRoom.loserId = gameOverCheck.loserId;
          } else if (activeRoom.players.length < 3) {
            activeRoom.status = 'GAMEOVER';
            activeRoom.loserId = null;
          } else {
            // Unpause if everyone left is connected
            const allConnected = activeRoom.players.every(p => p.connected);
            activeRoom.status = allConnected ? 'PLAYING' : 'PAUSED';
          }
        }
      }

      broadcastRoomState(roomId);
      disconnectTimeouts.delete(playerId);
    }, 60000); // 60 seconds

    disconnectTimeouts.set(playerId, timeout);
    socketToPlayerMap.delete(socket.id);
  });
});

// Port settings
const PORT = process.env.PORT || 3001;

// LAN Mode checking
const args = process.argv.slice(2);
const isLanMode = args.includes('--lan');

// SPA Fallback: serve index.html for any unknown routes
app.get('*', (_req, res) => {
  res.sendFile(path.resolve(clientDistPath, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  if (isLanMode) {
    console.log('\n=============================================');
    console.log('         QORA XOTIN: WI-FI / LAN MODE        ');
    console.log('=============================================');
    
    // Find local IP
    const networkInterfaces = os.networkInterfaces();
    let localIp = 'localhost';
    
    for (const name of Object.keys(networkInterfaces)) {
      const netInterface = networkInterfaces[name];
      if (!netInterface) continue;
      
      for (const net of netInterface) {
        if (net.family === 'IPv4' && !net.internal) {
          // Capture first non-internal wireless/ethernet interface IP
          if (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.')) {
            localIp = net.address;
            break;
          }
        }
      }
      if (localIp !== 'localhost') break;
    }
    
    const clientUrl = `http://${localIp}:3000`;
    console.log(`Host IP address: ${localIp}`);
    console.log(`Server API Endpoint: http://${localIp}:${PORT}`);
    console.log(`Client Access URL: ${clientUrl}`);
    console.log('\nSkanerlang va o\'yinga qo\'shiling:');
    
    // Generate QR code for mobile devices
    qrcode.generate(clientUrl, { small: true });
    console.log('=============================================\n');
  }
});
