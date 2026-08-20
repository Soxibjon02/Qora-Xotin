import { useState, useEffect } from 'react';
import { ClientGameState, Card, Suit } from '../../../shared/types.js';
import { soundManager } from '../utils/soundManager.js';

type DrawResult = (ClientGameState & { lastDrawnCard?: Card; pairsFound?: string[] }) | void;

interface GameTableProps {
  gameState: ClientGameState;
  onDrawCard: (targetPlayerId: string, cardIndex: number) => Promise<DrawResult>;
  onKickPlayer: (targetPlayerId: string) => void;
  onRestart: () => void;
  onLeave: () => void;
  onToggleSound: () => void;
  soundEnabled: boolean;
}

export default function GameTable({
  gameState,
  onDrawCard,
  onKickPlayer,
  onRestart,
  onLeave,
  onToggleSound,
  soundEnabled
}: GameTableProps) {
  const { roomId, players, currentTurn, myId, isHost, myHand, status, loserId, discardedPairsCount } = gameState;

  // Local state for animations and notifications
  const [revealedCard, setRevealedCard] = useState<Card | null>(null);
  const [toastMessage, setToastMessage] = useState<string>('');

  // Find target player to draw from
  const getDrawTargetId = (): string | null => {
    const myIndex = gameState.turnOrder.indexOf(myId);
    if (myIndex === -1) return null;

    // Search clockwise for next player with cards
    const N = gameState.turnOrder.length;
    for (let i = 1; i < N; i++) {
      const nextIndex = (myIndex + i) % N;
      const nextPlayerId = gameState.turnOrder[nextIndex];
      const playerObj = players.find(p => p.id === nextPlayerId);
      if (playerObj && playerObj.cardCount > 0) {
        return nextPlayerId;
      }
    }
    return null;
  };

  const drawTargetId = getDrawTargetId();
  const isMyTurn = currentTurn === myId && status === 'PLAYING';
  const targetPlayer = players.find(p => p.id === drawTargetId);

  // Monitor turn changes for turn sound effects
  useEffect(() => {
    if (status === 'PLAYING') {
      soundManager.playTurnChime();
      if (isMyTurn) {
        showToast('Sizning navbatingiz! Karta tanlang.');
      } else {
        const currentActive = players.find(p => p.id === currentTurn);
        if (currentActive) {
          showToast(`${currentActive.name}ning navbati.`);
        }
      }
    }
  }, [currentTurn, status]);

  // Prevent double-draws while a request is in flight
  const [isDrawing, setIsDrawing] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? '' : prev));
    }, 4000);
  };

  const handleCardClick = async (targetIndex: number) => {
    if (!isMyTurn || !drawTargetId || isDrawing) return;

    setIsDrawing(true);
    soundManager.playDraw();

    try {
      const result = await onDrawCard(drawTargetId, targetIndex);

      if (result?.lastDrawnCard) {
        const drawnCard = result.lastDrawnCard;
        setRevealedCard(drawnCard);
        showToast(`Siz ${getSuitSymbol(drawnCard.suit)}${drawnCard.rank} kartasini tortdingiz!`);

        // Auto clear reveal banner
        setTimeout(() => {
          setRevealedCard(null);
        }, 3000);
      }

      if (result?.pairsFound && result.pairsFound.length > 0) {
        soundManager.playPairFound();
        showToast(`Juftlik topdingiz! (${result.pairsFound.join(', ')})`);
      }
    } finally {
      setIsDrawing(false);
    }
  };

  const handleKickPlayer = (targetPlayerId: string) => {
    if (!isHost) return;
    onKickPlayer(targetPlayerId);
  };

  const handleRestart = () => {
    if (!isHost) return;
    onRestart();
  };

  // Convert suit characters to standard symbols
  const getSuitSymbol = (suit: Suit): string => {
    switch (suit) {
      case 'H': return '♥';
      case 'D': return '♦';
      case 'C': return '♣';
      case 'S': return '♠';
    }
  };

  const getSuitClass = (suit: Suit): string => {
    return (suit === 'H' || suit === 'D') ? 'red-suit' : 'black-suit';
  };

  // Calculate circular positioning for players around the table
  const renderPlayerSpots = () => {
    const N = players.length;
    const myIndex = players.findIndex(p => p.id === myId);

    return players.map((player, idx) => {
      // Rotate indices so that the local player (myId) is always index 0 (bottom of table)
      const relativeIndex = (idx - myIndex + N) % N;

      // Calculate polar coordinates (User is at 90 degrees / bottom center)
      const angle = (relativeIndex * 360) / N + 90;
      const radian = (angle * Math.PI) / 180;
      const x = 50 + 38 * Math.cos(radian); // X coordinate in percent from table center
      const y = 50 + 38 * Math.sin(radian); // Y coordinate in percent from table center

      const isCurrentPlayerTurn = currentTurn === player.id;
      const isMe = player.id === myId;

      return (
        <div
          key={player.id}
          className={`player-spot ${isCurrentPlayerTurn ? 'active-turn' : ''} ${!player.connected ? 'disconnected' : ''}`}
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${relativeIndex * 0.08}s` }}
        >
          {/* Opponent mini-hand count (cards back stacked) */}
          {!isMe && player.cardCount > 0 && (
            <div className="opponent-mini-hand">
              {Array.from({ length: Math.min(player.cardCount, 5) }).map((_, i) => (
                <div key={i} className="opponent-card-back-mini" />
              ))}
              {player.cardCount > 5 && <span style={{fontSize: '0.7rem', alignSelf: 'center', marginLeft: '4px'}}>+{player.cardCount - 5}</span>}
            </div>
          )}

          <div className="player-panel">
            {/* Host Kick Button */}
            {isHost && !isMe && (
              <button 
                className="kick-btn" 
                title={player.connected ? "O'yinchini chetlashtirish" : "O'yinchini o'chirib tashlash"}
                onClick={() => handleKickPlayer(player.id)}
              >
                ✕
              </button>
            )}

            <div className="player-avatar">
              {player.avatar}
              <span className={`connection-dot ${player.connected ? 'online' : ''}`} />
            </div>

            <div className="player-name">
              {player.name} {isMe && "(Siz)"}
              {player.id === gameState.hostId && <span className="lobby-host-tag">Host</span>}
            </div>

            <div className="player-cards-count">
              {player.cardCount} ta karta
            </div>

            {isCurrentPlayerTurn && (
              <span className="player-turn-badge">Navbat</span>
            )}
          </div>
        </div>
      );
    });
  };

  // Check if someone holds Qora Xotin at gameover
  const losingPlayer = players.find(p => p.id === loserId);

  return (
    <div className="table-screen">
      {/* HUD Bar */}
      <div className="hud-panel">
        <div className="hud-pill gold">
          <span>XONA:</span>
          <strong>{roomId}</strong>
        </div>
        <div className="hud-pill">
          <span>Faol kartalar:</span>
          <strong>{gameState.cardsInRoundCount}</strong>
        </div>
        <div className="hud-pill">
          <span>O'chirilgan juftlar:</span>
          <strong>{discardedPairsCount}</strong>
        </div>
        <button className="btn-icon" onClick={onToggleSound} title="Tovush">
          {soundEnabled ? '🔊' : '🔇'}
        </button>
        {status !== 'PLAYING' && (
          <button className="btn-icon" onClick={onLeave} title="Xonadan chiqish">
            🚪
          </button>
        )}
      </div>

      {/* Action Prompt / Toast Overlay */}
      {toastMessage && (
        <div className="action-banner">
          <div className="pulse-indicator" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Card Table Area */}
      <div className="table-container">
        <div className="card-table">
          {/* Discard Pile Center Graphics */}
          <div className="discard-pile-center">
            <span className="discard-count">{discardedPairsCount}</span>
            <span>Juftlik tashlandi</span>
          </div>

          {/* Render Players around table */}
          {renderPlayerSpots()}
        </div>
      </div>

      {/* Interaction Zone: When it's my turn, draw card from target */}
      {isMyTurn && targetPlayer && (
        <div style={{ zIndex: 12, marginBottom: '15px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '1rem', color: varColor('--gold'), marginBottom: '8px', textShadow: '0 0 6px rgba(212,175,55,0.3)' }}>
            👉 <strong>{targetPlayer.name}</strong>dan karta tortib oling:
          </h3>
          <div className="draw-zone-target">
            {Array.from({ length: targetPlayer.cardCount }).map((_, idx) => (
              <button
                key={idx}
                className="draw-card-back"
                style={{ animationDelay: `${idx * 0.03}s` }}
                onClick={() => handleCardClick(idx)}
                disabled={isDrawing}
                aria-label={`${targetPlayer.name}ning ${idx + 1}-kartasini tortish`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Local Player's Hand Display */}
      <div className="user-hand-container">
        <div className="user-hand-label">
          Sizning kartalaringiz ({myHand.length})
        </div>
        <div className="cards-flex">
          {myHand.map((card, i) => {
            const isQoraXotin = card.isQoraXotin;
            return (
              <div
                key={card.id}
                className={`playing-card card-enter ${getSuitClass(card.suit)} ${isQoraXotin ? 'qora-xotin-card' : ''}`}
                style={{ animationDelay: `${i * 0.035}s` }}
                title={isQoraXotin ? "Qora Xotin! Ehtiyot bo'ling!" : `${card.rank} of ${card.suit}`}
              >
                <div className="card-top">
                  <span className="card-rank">{card.rank}</span>
                  <span className="card-suit-mini">{getSuitSymbol(card.suit)}</span>
                </div>
                <div className="card-center-suit">
                  {isQoraXotin ? '👑' : getSuitSymbol(card.suit)}
                </div>
                <div className="card-bottom">
                  <span className="card-rank">{card.rank}</span>
                  <span className="card-suit-mini">{getSuitSymbol(card.suit)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Discard & Reveal Notification Overlays */}
      {revealedCard && (
        <div className="pause-overlay" style={{ background: 'rgba(0,0,0,0.5)', pointerEvents: 'none' }}>
          <div className="glass-panel" style={{ border: '2px solid var(--gold)', animation: 'modal-enter 0.3s ease' }}>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-muted)' }}>Tortilgan karta:</span>
            <div className="reveal-flip-stage">
              <div className={`playing-card reveal-flip-card ${getSuitClass(revealedCard.suit)}`}>
                <div className="card-top">
                  <span className="card-rank">{revealedCard.rank}</span>
                  <span className="card-suit-mini">{getSuitSymbol(revealedCard.suit)}</span>
                </div>
                <div className="card-center-suit">
                  {revealedCard.isQoraXotin ? '👑' : getSuitSymbol(revealedCard.suit)}
                </div>
                <div className="card-bottom">
                  <span className="card-rank">{revealedCard.rank}</span>
                  <span className="card-suit-mini">{getSuitSymbol(revealedCard.suit)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Paused (Connection Lost) Overlay */}
      {status === 'PAUSED' && (
        <div className="pause-overlay">
          <div className="pause-panel">
            <div className="pause-spinner" />
            <h3 style={{ color: 'var(--accent-red)', marginBottom: '10px' }}>O'yin to'xtatildi</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              O'yinchilardan biri aloqani yo'qotdi. Qaytishini kutyapmiz...
            </p>
            {players.map(p => !p.connected && (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '8px', marginBottom: '10px' }}>
                <span>🔴 {p.name} {p.id === myId && "(Siz)"}</span>
                {isHost && p.id !== myId && (
                  <button 
                    className="btn-secondary" 
                    style={{ padding: '4px 10px', fontSize: '0.8rem', width: 'auto' }}
                    onClick={() => handleKickPlayer(p.id)}
                  >
                    Chetlashtirish
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Game Over (celebration) Overlay */}
      {status === 'GAMEOVER' && (
        <div className="gameover-overlay">
          <div className="gameover-panel">
            <h1 className="title-glow" style={{ fontSize: '3rem', marginBottom: '10px' }}>QORA XOTIN!</h1>
            
            {losingPlayer ? (
              <>
                <div className="loser-avatar-big">{losingPlayer.avatar}</div>
                <div className="loser-name">{losingPlayer.name}</div>
                <span className="loser-badge">Qora Xotin bo'ldi! 💀</span>
                
                {losingPlayer.id === myId ? (
                  <div style={{ marginTop: '25px', padding: '15px', background: 'rgba(231,76,60,0.15)', borderRadius: '12px', border: '1px solid var(--accent-red)' }}>
                    <h3 style={{ color: '#ff6b6b', marginBottom: '5px' }}>Tabriklaymiz...</h3>
                    <p style={{ fontSize: '1rem', fontWeight: 600 }}>Siz QORA XOTINSIZ 😄</p>
                  </div>
                ) : (
                  <div style={{ marginTop: '25px', padding: '15px', background: 'rgba(46,204,113,0.15)', borderRadius: '12px', border: '1px solid #2ecc71' }}>
                    <h3 style={{ color: '#2ecc71', marginBottom: '5px' }}>Tabriklaymiz! 🎉</h3>
                    <p style={{ fontSize: '1rem', fontWeight: 600 }}>Siz Qora Xotindan qutulib qoldingiz!</p>
                  </div>
                )}
              </>
            ) : (
              <div>
                <span className="loser-badge" style={{ background: 'var(--accent-blue)' }}>O'yin bekor qilindi</span>
                <p style={{ margin: '15px 0', color: 'var(--text-muted)' }}>O'yin davomida yetarli o'yinchi qolmadi.</p>
              </div>
            )}

            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-val">{discardedPairsCount}</div>
                <div className="stat-label">Jami juftliklar</div>
              </div>
              <div className="stat-item">
                <div className="stat-val">👑 Q♠</div>
                <div className="stat-label">Qora Xotin kartasi</div>
              </div>
            </div>

            {isHost ? (
              <button className="btn-primary" onClick={handleRestart}>
                Qayta o'ynash 🔁
              </button>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.9rem' }}>
                Xona egasining yangi o'yin boshlashini kutyapmiz...
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline CSS variable helper
function varColor(name: string) {
  return `var(${name})`;
}
