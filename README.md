# Continental Rummy

A real-time multiplayer web app for **Continental Rummy** (2–10 players). One card game, tabletop-style: shared table, hands, melds, stock, and discard.

## Rules

- **7 rounds**, each with a contract (e.g. Round 1: two trios; Round 2: one trio + one straight; …).
- Play with **2 or 3 decks**, with **3 Jokers per deck**. The lobby warns that 2 decks may be insufficient with more than 5 players.
- **Trios**: 3+ cards of the same rank (Jokers are wild; 2s always play naturally as 2s).
- **Straights**: 4+ cards of the same suit in sequence (Ace high or low, no wrap).
- A player lays the complete round contract once, using exactly its required number and types of standalone melds. Required melds may be longer than their minimum, but extra melds are not allowed in the initial play or later. After going down, the player may only extend table melds.
- Jokers may be replaced only in straights. Before going down, the reclaimed Joker must be used in the player's complete contract that turn; after going down, it stays in the same straight and moves to a legal end.
- Each round you **draw** (stock or top discard), optionally play your contract or add to existing melds, then **discard**.
- Going out on the same turn as the contract scores **−10 × the round number**, including when a final leftover card is discarded or added. Going out on a later turn scores **−10**.
- Cards left in other players' hands score as penalties: Joker 50, Ace 20, J/Q/K 10, and numbered cards at face value. The final scoreboard appears after Round 7; lowest total score wins.

## Run locally

```bash
# Install dependencies (root + server + client)
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Start both (server :3001, client :5173)
npm run dev

# Run the server game-engine tests
npm test
```

Open **http://localhost:5173**. Create a room, share the room code, have others join, then Start game (host only). Play with 2–10 players.

## Tech

- **Client**: Vite, React, TypeScript, Socket.io-client.
- **Server**: Node, Express, Socket.io, TypeScript.
- **Game logic**: Deck, rounds, meld validation, scoring, turn order and room state on the server.

The repository also contains a local Pocha UI/rules prototype. Pocha multiplayer is not connected to the Socket.IO server yet.

## Custom rules

The round contracts and deck sizes are in `server/src/types.ts` and `server/src/room.ts`. You can change number of cards per round, contracts, or scoring there to match your house rules.
