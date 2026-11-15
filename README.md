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

## Private player dashboard

Use **Owner dashboard** in the lobby, or open `/dashboard`, to see who is online across Continental and Pocha. It refreshes automatically and requires a private server access key. See [dashboard setup](DASHBOARD.md) to enable access.

## Tech

- **Client**: Vite, React, TypeScript, Socket.io-client.
- **Server**: Node, Express, Socket.io, TypeScript.
- **Game logic**: Deck, rounds, meld validation, scoring, turn order and room state on the server.

Pocha multiplayer supports 32-, 36-, 40- and 48-card Spanish decks: 36 removes the fours from the standard 40-card deck, and 32 also removes the twos. Creating a Pocha room asks only for a name; the host chooses the deck, pyramid rounds and normal/auction mode inside the waiting lobby; everyone sees the saved settings. Limits adjust to the deck and player count, and the setup survives reconnection and rematches. The opening lead is chosen randomly each game, with subsequent rounds retaining the seat rotation. After an auction, predictions start from the original opening player and follow the original seat order, skipping the auction winner whose bid is already fixed. The auction winner still chooses trump and leads the first trick. Exact predictions score 5 + 2 per trick; misses lose 2 per trick of difference. Server-validated moves enforce following suit and beating when possible. Without the led suit, a winning trump is mandatory when available; otherwise any card may be discarded. Rooms share the authenticated recovery and durable save system. The responsive table includes private hands, legal-card guidance, round results, score history, and a shareable room link. Closing a tab preserves the seat; explicitly leaving returns the remaining players to the lobby.

## Accounts and personal results

Players can keep playing as guests or open **My account** to register a name, email and password. Registration verifies the email address; password recovery also uses an email code. Sessions are remembered in the browser for up to 30 days. Existing email-code accounts remain compatible and can set a password from their profile.

The private statistics page shows completed games, individual wins, win percentage, draws and the latest 50 results, with separate Pocha and Conti filters. A result belongs to the account signed in before the game starts; signing in later does not claim an earlier game. Games against guests count, while abandoned games, test-bot games and duplicate accounts at the same table do not. Draws are separate from individual wins. Old games are not imported retrospectively.

Enable accounts with `MEMBERSHIP_ENABLED=true`, a strong `MEMBERSHIP_AUTH_SECRET`, durable storage and a configured email sender; see [the environment example](server/membership.env.example). Accounts and statistics do not require enabling payments or advertising. Account records use the membership store; permanent results are saved atomically with game state and survive room cleanup. Back up both stores together. Game snapshots use format v2 once account tracking is present and v3 once leagues exist; older servers refuse these formats, so a rollback must retain support for the stored version.

## Private leagues

Open **My account → Leagues** to create a Pocha or Conti league or join one with its invitation code. Each league has its own members, standings and result history. Before dealing, the room host selects a league or a friendly game; the host can also change this choice after a game finishes. Every seat in a league game must use a different signed-in account that has already joined that league. Participants and the chosen league are fixed at the start. Friendly games still allow guests and do not change league rankings.

Standings use the complete final positions, including draws, with one TrueSkill update per completed match. Different subsets of members can play at each table. The displayed score is the conservative estimate `mu - 3 * sigma`; raw Pocha/Conti points are not added across matches. Players remain provisional until they reach the league's minimum participation (default 5 games, configurable from 1 to 50 when creating the league). Wins and win percentage remain visible. The owner can close a league without deleting its history; games already running may finish and count, but new league games cannot start.

Leagues and results share the same durable game transaction. Rankings replay the immutable result history in completion order and are cached without persisting a second, potentially inconsistent total. The stored rating version is fixed at 1. Accounts, email addresses and credentials are not exposed in the league API; only members can view its standings and invitation code.

The rating implementation uses `ts-trueskill` 5.1.0 (MIT/BSD), following [Microsoft's TrueSkill model](https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/). The dependency's [LICENSE](https://github.com/scttcper/ts-trueskill/blob/master/LICENSE) includes a separate caution about Microsoft's TrueSkill trademark and commercial use. Review that notice before public or monetized activation.

## Ad-free access

The first monetization step is optional support through the owner's existing [Buy Me a Coffee page](https://buymeacoffee.com/footballchampion), linked from the English and Spanish lobby. Contributions do not automatically unlock ad-free access.

Optional one-time ad-free purchases, owner-granted access and multiplayer ad readiness remain behind their separate provider configuration. Any authenticated ad-free player covers their whole table. See [monetization setup and activation limits](MONETIZATION.md).

## Custom rules

The round contracts and deck sizes are in `server/src/types.ts` and `server/src/room.ts`. You can change number of cards per round, contracts, or scoring there to match your house rules.
