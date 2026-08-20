# Qora Xotin — Multiplayer Card Game

[![Vercel Deployment](https://img.shields.io/badge/Vercel-Deployed-brightgreen)](https://vercel.com)
[![Deploy to Render](https://render.com/images/deploy-to-render.svg)](https://render.com/deploy?repo=https://github.com/Soxibjon02/Qora-Xotin)

A complete production-ready multiplayer web game called **"Qora Xotin"**, inspired by the classic "Old Maid" card pairing game but localized and branded specifically for Uzbek players.

Built using a server-authoritative WebSocket architecture, the game ensures security (preventing card leaking) and supports smooth cross-device playing, automatic reconnection, and dynamic deck adjustments for 3 to 10 players.

---

## 🎮 Game Concept & Rules (O'yin Qoidalari)

1.  **Objective**: Get rid of all cards in your hand by matching ranks to form pairs. Avoid being the final player holding the single unmatched Queen of Spades (**Qora Xotin**).
2.  **Card Pool**:
    *   **3–4 Players**: Ranks 7 to K (25 cards total; 3 Queens removed, leaving $Q\spadesuit$).
    *   **5–6 Players**: Ranks 5 to K (33 cards total; 3 Queens removed, leaving $Q\spadesuit$).
    *   **7–10 Players**: Ranks A to K (49 cards total; 3 Queens removed, leaving $Q\spadesuit$).
3.  **Setup**: Cards are shuffled server-side and distributed evenly. Players scan their hands and discard any initial matching pairs.
4.  **Turns**: Clockwise. On your turn, choose and draw one hidden card from the hand of the next eligible player (the person sitting to your right/next active player).
5.  **Pairing**: If the drawn card matches a rank in your hand, both are discarded instantly. If not, it is added to your hand.
6.  **Game Over**: The game continues until all cards are paired up except for the **Qora Xotin** ($Q\spadesuit$). The player holding this card loses. The screen will display:
    **"Tabriklaymiz... siz QORA XOTINSIZ 😄"**

---

## 🛠️ Technology Stack

*   **Frontend**: React, TypeScript, Vite, Vanilla CSS (Premium felt-green felt theme, glassmorphism, responsive coordinate positioning).
*   **Backend**: Node.js, Express, Socket.IO.
*   **Sound**: Web Audio API (real-time synthesizer, no assets to fetch).
*   **Vercel Deployment**: Configured out of the box for frontend static hosting.

---

## 🚀 Installation & Local Development

### 1. Install Dependencies
Run the install command from the root folder:
```bash
npm run install:all
```

### 2. Run Local Development Mode
This will launch both the Vite client (port `3000`) and the WebSocket server (port `3001`) concurrently:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in multiple tabs/browsers to test multi-client synchronization.

---

## 📶 WiFi / LAN Multiplayer Mode

To host a local game session on your home or office WiFi network:

1. Make sure your computer and mobile devices/other laptops are connected to the **same WiFi network**.
2. Run the LAN command:
   ```bash
   npm run lan
   ```
3. The server will scan your wireless network card, print your local IP (e.g. `192.168.1.15`), and print a **beautiful QR Code** in the terminal.
4. Scan the QR code with your phone camera, or manually navigate to the IP address displayed:
   ```
   http://192.168.1.15:3000
   ```
5. Other players join the same room code (e.g., `QX7K92`) from their respective devices!

---

## 🧪 Running Automated Tests

We use **Vitest** for running fast, native TypeScript unit tests.

To run the unit tests (which cover distribution algorithms, deck structures, security sanitizations, turn skipping, and pairing rules):
```bash
npm run test
```

---

## 📦 Production Deployment

### Frontend (Vercel)
The Vite frontend can be deployed directly to Vercel.
1. Connect your repository to Vercel.
2. Set the root directory of the Vercel project to `client/`.
3. Add the Environment Variable `VITE_BACKEND_URL` pointing to your deployed production WebSocket server (e.g., `https://qora-xotin-backend.onrender.com`).
4. Vercel will build and serve the static files.

### Backend (Render / Railway / Fly.io)
Because Vercel does not support persistent WebSockets, host the `server/` directory on a standard Node.js hosting platform:
1. Build script: `npm run build` (runs `tsc` in the server folder).
2. Start script: `npm start` (runs `node dist/server.js`).
3. Set the Environment Variable `PORT` to the host port.
