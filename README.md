# Continental Rummy

A real-time multiplayer web app for **Continental Rummy** (2–10 players). One card game, tabletop-style: shared table, hands, melds, stock, and discard.

## Rules (standard variant)

- **7 rounds**, each with a contract (e.g. Round 1: two trios; Round 2: one trio + one straight; …).
- **Trios**: 3+ cards of the same rank (2s and Jokers are wild).
- **Straights**: 3+ cards of the same suit in sequence (Ace high or low, no wrap).
- Each round you **draw** (stock or top discard), optionally **play melds** or add to existing melds, then **discard**.
- When someone’s melds satisfy the round contract, the round ends. **Penalty scoring**: cards left in hand count against you (Joker 50, Ace 20, face 10, 9–2 → 5). Lowest total score after 7 rounds wins.

## Run locally

```bash
# Install dependencies (root + server + client)
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Start both (server :3001, client :5173)
npm run dev
```

Open **http://localhost:5173**. Create a room, share the room code, have others join, then Start game (host only). Play with 2–10 players.

## Tech

- **Client**: Vite, React, TypeScript, Socket.io-client.
- **Server**: Node, Express, Socket.io, TypeScript.
- **Game logic**: Deck, rounds, meld validation, scoring, turn order and room state on the server.

## Custom rules

The round contracts and deck sizes are in `server/src/types.ts` and `server/src/room.ts`. You can change number of cards per round, contracts, or scoring there to match your house rules.
