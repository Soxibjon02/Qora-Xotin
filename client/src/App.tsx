import { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import type { ClientGameState } from '../../shared/types.js';
import GameTable from './components/GameTable.tsx';
import { soundManager } from './utils/soundManager.js';
import { gameService } from './services/gameService.js';

const AVATARS = ['🦁', '🐯', '🐼', '🦊', '🐨', '🐻', '🐰', '🐹', '🐸', '🐵'];
const POLL_INTERVAL = 1200; // ms — generous to avoid hammering the API

export default function App() {
  const [screen, setScreen] = useState<'MAIN' | 'LOBBY' | 'RULES' | 'SETTINGS' | 'GAME'>('MAIN');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('qx_player_name') || '');
  const [avatar, setAvatar] = useState(() => localStorage.getItem('qx_player_avatar') || AVATARS[0]);
  const [roomIdInput, setRoomIdInput] = useState('');
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(() => soundManager.isEnabled());

  // Use state (not refs) for session so effects react to changes
  const [session, setSession] = useState<{ roomId: string; playerId: string } | null>(() => {
    const r = sessionStorage.getItem('qx_room_id');
    const p = sessionStorage.getItem('qx_player_id');
    return r && p ? { roomId: r, playerId: p } : null;
  });


  // ── Persist session to sessionStorage whenever it changes ──────────────────
  useEffect(() => {
    if (session) {
      sessionStorage.setItem('qx_room_id', session.roomId);
      sessionStorage.setItem('qx_player_id', session.playerId);
    } else {
      sessionStorage.removeItem('qx_room_id');
      sessionStorage.removeItem('qx_player_id');
    }
  }, [session]);

  // ── Polling engine ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const state = await gameService.getState(session.roomId, session.playerId);
        if (!active) return;

        setGameState(prev => {
          // Sound/confetti on status transitions
          if (prev?.status !== state.status && state.status === 'GAMEOVER') {
            if (state.loserId === state.myId) {
              soundManager.playDefeat();
            } else {
              soundManager.playVictory();
              confetti({ particleCount: 150, spread: 85, origin: { y: 0.6 } });
            }
          }
          return state;
        });

        setScreen(state.status === 'LOBBY' ? 'LOBBY' : 'GAME');
      } catch {
        // Transient errors — keep polling silently
      }
    };

    // Immediate first poll
    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [session]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function persistSession(roomId: string, playerId: string) {
    setSession({ roomId, playerId });
  }

  function clearSession() {
    setSession(null);
    setGameState(null);
    setScreen('MAIN');
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleCreateRoom = async () => {
    if (!playerName.trim()) { setErrorMessage('Iltimos, ismingizni kiriting.'); return; }
    localStorage.setItem('qx_player_name', playerName);
    localStorage.setItem('qx_player_avatar', avatar);
    setLoading(true);
    try {
      const state = await gameService.createRoom(playerName.trim(), avatar);
      persistSession(state.roomId, state.myId);
      setGameState(state);
      setScreen('LOBBY');
    } catch (e: any) {
      setErrorMessage(e.message || 'Xona yaratishda xatolik.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!playerName.trim()) { setErrorMessage('Iltimos, ismingizni kiriting.'); return; }
    if (!roomIdInput.trim()) { setErrorMessage('Iltimos, xona kodini kiriting.'); return; }
    localStorage.setItem('qx_player_name', playerName);
    localStorage.setItem('qx_player_avatar', avatar);
    setLoading(true);
    try {
      const state = await gameService.joinRoom(roomIdInput.trim().toUpperCase(), playerName.trim(), avatar);
      persistSession(state.roomId, state.myId);
      setGameState(state);
      setScreen('LOBBY');
    } catch (e: any) {
      setErrorMessage(e.message || "Xonaga qo'shilishda xatolik.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleReady = async () => {
    if (!gameState || !session) return;
    try {
      const state = await gameService.toggleReady(gameState.roomId, session.playerId);
      setGameState(state);
    } catch (e: any) { setErrorMessage(e.message); }
  };

  const handleStartGame = async () => {
    if (!gameState || !session) return;
    try {
      const state = await gameService.startGame(gameState.roomId, session.playerId);
      setGameState(state);
      setScreen('GAME');
    } catch (e: any) { setErrorMessage(e.message); }
  };

  const handleDrawCard = async (targetPlayerId: string, cardIndex: number) => {
    if (!gameState || !session) return;
    try {
      const result = await gameService.drawCard(gameState.roomId, session.playerId, targetPlayerId, cardIndex);
      setGameState(result);
      if (result.pairsFound && result.pairsFound.length > 0) {
        soundManager.playPairFound();
      } else {
        soundManager.playDraw();
      }
      return result;
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const handleKickPlayer = async (targetPlayerId: string) => {
    if (!gameState || !session) return;
    try {
      const state = await gameService.kickPlayer(gameState.roomId, session.playerId, targetPlayerId);
      setGameState(state);
    } catch (e: any) { setErrorMessage(e.message); }
  };

  const handleRestart = async () => {
    if (!gameState || !session) return;
    try {
      const state = await gameService.restart(gameState.roomId, session.playerId);
      setGameState(state);
      setScreen('LOBBY');
    } catch (e: any) { setErrorMessage(e.message); }
  };

  const handleToggleSound = () => {
    const val = !soundEnabled;
    setSoundEnabled(val);
    soundManager.toggleSound(val);
  };

  const isLocal = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.startsWith('172.');

  const lanClientUrl = `http://${window.location.hostname}:3000`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(lanClientUrl)}`;

  return (
    <div className="screen-container">
      {screen !== 'GAME' && (
        <div className="sound-hud">
          <button className="btn-icon" onClick={handleToggleSound} title="Tovush">
            {soundEnabled ? '🔊' : '🔇'}
          </button>
        </div>
      )}

      {/* ── MAIN ─────────────────────────────────────────────────────────── */}
      {screen === 'MAIN' && (
        <div className="glass-panel" style={{ animation: 'modal-enter 0.5s ease' }}>
          <h1 className="title-glow" style={{ marginBottom: '15px' }}>QORA XOTIN 👑</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '25px' }}>
            O'zbekcha milliy multiplayer karta o'yini
          </p>

          <input
            type="text"
            className="custom-input"
            placeholder="Ismingizni kiriting..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={14}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateRoom()}
          />

          <div style={{ textAlign: 'left', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Avatar tanlang:</span>
          </div>
          <div className="avatar-grid">
            {AVATARS.map((av) => (
              <button
                key={av}
                className={`avatar-option ${avatar === av ? 'selected' : ''}`}
                onClick={() => setAvatar(av)}
              >
                {av}
              </button>
            ))}
          </div>

          <button className="btn-primary" onClick={handleCreateRoom} disabled={loading}>
            {loading ? '⏳ Yuklanmoqda...' : "Yangi o'yin yaratish 🃏"}
          </button>

          <div style={{ margin: '15px 0', borderTop: '1px solid var(--glass-border)' }} />

          <input
            type="text"
            className="custom-input"
            placeholder="Xona kodi (masalan: QX7K92)"
            value={roomIdInput}
            onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
            style={{ textTransform: 'uppercase', textAlign: 'center', letterSpacing: '2px', fontWeight: 'bold' }}
            onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
            maxLength={6}
          />
          <button className="btn-secondary" style={{ marginBottom: '15px' }} onClick={handleJoinRoom} disabled={loading}>
            {loading ? '⏳ Yuklanmoqda...' : "O'yinga qo'shilish 🤝"}
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn-secondary" style={{ flex: 1, fontSize: '0.9rem' }} onClick={() => setScreen('RULES')}>
              📖 Qoidalar
            </button>
            <button className="btn-secondary" style={{ flex: 1, fontSize: '0.9rem' }} onClick={() => setScreen('SETTINGS')}>
              ⚙️ Sozlamalar
            </button>
          </div>
        </div>
      )}

      {/* ── RULES ────────────────────────────────────────────────────────── */}
      {screen === 'RULES' && (
        <div className="glass-panel" style={{ maxWidth: '600px', animation: 'modal-enter 0.4s ease' }}>
          <h2 className="title-glow" style={{ fontSize: '2rem', marginBottom: '15px' }}>O'YIN QOIDALARI</h2>
          <ul className="rules-list">
            <li>1. O'yin <strong>3 tadan 10 tagacha</strong> o'yinchi bilan o'ynaladi.</li>
            <li>2. Standart kartalar dastasidan <strong>3 ta Qirolicha (Queen)</strong> olib tashlanadi.</li>
            <li>3. Dastada qolgan yagona Qirolicha (Qora xonim / Q♠) — <strong>QORA XOTIN</strong> deb ataladi.</li>
            <li>4. Barcha kartalar o'yinchilarga teng taqsimlanadi.</li>
            <li>5. O'yin boshida bir xil darajadagi <strong>juftliklar</strong> avtomatik olib tashlanadi.</li>
            <li>6. O'yin soat yo'nalishi bo'yicha davom etadi. Navbati kelgan o'yinchi o'ng tomonidagi o'yinchidan <strong>bitta yashirin kartani</strong> tortib oladi.</li>
            <li>7. Agar tortilgan karta juftlik hosil qilsa, ular darhol o'chiriladi.</li>
            <li>8. Qo'lidagi barcha kartalarni juftlab tugatgan o'yinchi g'olib sifatida tark etadi.</li>
            <li>9. Eng oxirida qo'lida <strong>Qora Xotin (Q♠)</strong> qolib ketgan o'yinchi — <strong>mag'lub</strong>!</li>
          </ul>
          <button className="btn-primary" onClick={() => setScreen('MAIN')}>Tushunarli 👍</button>
        </div>
      )}

      {/* ── SETTINGS ─────────────────────────────────────────────────────── */}
      {screen === 'SETTINGS' && (
        <div className="glass-panel" style={{ animation: 'modal-enter 0.4s ease' }}>
          <h2 className="title-glow" style={{ fontSize: '2rem', marginBottom: '20px' }}>SOZLAMALAR</h2>
          <div className="settings-row">
            <div>
              <div className="settings-label">Tovush effektlari</div>
              <div className="settings-desc">Karta tortish va juftlik ovozlari</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={soundEnabled} onChange={handleToggleSound} />
              <span className="slider" />
            </label>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">Rejim / Tarmoq</div>
              <div className="settings-desc">
                {isLocal ? 'Lokal Wi-Fi / LAN rejimida ishlamoqda' : 'Internet / Global rejimda ishlamoqda'}
              </div>
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--gold)', fontWeight: 'bold' }}>
              {isLocal ? 'LAN 🌐' : 'ONLINE 🌍'}
            </span>
          </div>
          <button className="btn-primary" style={{ marginTop: '20px' }} onClick={() => setScreen('MAIN')}>Saqlash 💾</button>
        </div>
      )}

      {/* ── LOBBY ────────────────────────────────────────────────────────── */}
      {screen === 'LOBBY' && gameState && (
        <div className="glass-panel" style={{ animation: 'modal-enter 0.5s ease' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>UYUN XONASI KODI</span>
          <div className="room-sharing-box">
            <div className="room-code-display">{gameState.roomId}</div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Do'stlaringizga ushbu kodni yuboring.
            </p>
          </div>

          <div style={{ textAlign: 'left' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
              O'yinchilar ({gameState.players.length}/10):
            </span>
          </div>

          <div className="players-lobby-list">
            {gameState.players.map((player) => {
              const isPlayerHost = gameState.hostId === player.id;
              const isPlayerMe = player.id === gameState.myId;
              return (
                <div key={player.id} className="lobby-player-row">
                  <div className="player-info-flex">
                    <span className="lobby-avatar">{player.avatar}</span>
                    <span className="lobby-name">
                      {player.name}{isPlayerMe && ' (Siz)'}
                      {isPlayerHost && <span className="lobby-host-tag">Host</span>}
                    </span>
                  </div>
                  {isPlayerHost ? (
                    <span className="ready-pill ready">Boshlovchi</span>
                  ) : (
                    <span className={`ready-pill ${player.ready ? 'ready' : ''}`}>
                      {player.ready ? '✓ Tayyor' : 'Kutilmoqda'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {isLocal && (
            <div className="lobby-qr-container" style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gold)' }}>WIFI ORQALI QO'SHILISH:</span>
              <img src={qrCodeUrl} alt="QR Code" style={{ width: '110px', height: '110px', marginTop: '5px', borderRadius: '4px', border: '2px solid white' }} />
              <span className="qr-caption">Kamerani yaqinlashtiring yoki oching:</span>
              <code style={{ fontSize: '0.7rem', color: 'var(--text-light)', marginTop: '2px' }}>{lanClientUrl}</code>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={clearSession}>
              Chiqish 🚪
            </button>
            {gameState.isHost ? (
              <button
                className="btn-primary"
                style={{ flex: 2, marginBottom: 0 }}
                onClick={handleStartGame}
                disabled={gameState.players.length < 3}
              >
                Boshlash 🚀
              </button>
            ) : (
              <button
                className="btn-primary"
                style={{ flex: 2, marginBottom: 0 }}
                onClick={handleToggleReady}
              >
                {gameState.players.find(p => p.id === gameState.myId)?.ready ? 'Kutish...' : 'Tayyorman ✓'}
              </button>
            )}
          </div>
          {gameState.isHost && gameState.players.length < 3 && (
            <p style={{ color: 'var(--accent-red)', fontSize: '0.75rem', marginTop: '8px' }}>
              Kamida 3 ta o'yinchi bo'lishi shart.
            </p>
          )}
        </div>
      )}

      {/* ── GAME ─────────────────────────────────────────────────────────── */}
      {screen === 'GAME' && gameState && (
        <GameTable
          gameState={gameState}
          onDrawCard={handleDrawCard}
          onKickPlayer={handleKickPlayer}
          onRestart={handleRestart}
          onLeave={clearSession}
          onToggleSound={handleToggleSound}
          soundEnabled={soundEnabled}
        />
      )}

      {/* ── ERROR MODAL ───────────────────────────────────────────────────── */}
      {errorMessage && (
        <div className="pause-overlay" style={{ zIndex: 9999 }}>
          <div className="pause-panel" style={{ borderColor: 'var(--accent-red)' }}>
            <h3 style={{ color: 'var(--accent-red)', marginBottom: '15px' }}>Xatolik</h3>
            <p style={{ color: 'var(--text-light)', fontSize: '0.95rem', marginBottom: '20px' }}>
              {errorMessage}
            </p>
            <button
              className="btn-primary"
              style={{ background: 'var(--accent-red)', color: '#fff', boxShadow: 'none' }}
              onClick={() => setErrorMessage('')}
            >
              Yopish
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
