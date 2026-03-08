# How to Play — Conti (Continental)

*This document describes the basic rules used in this app. It is intended for a future “How to play” UI; do not consider it a substitute for in-app help.*

---

## Overview

**Conti** is a multi-round rummy-style card game. Players try to form **melds** (sets and runs) that satisfy a **round contract**. Each round, you draw, play melds (or add to existing ones), then discard. After 7 rounds, the player with the **lowest total score** wins.

---

## Setup

- **Decks:** 2 or 3 standard 52-card decks (configurable in the lobby). Each deck adds 2 jokers.
- **Players:** 2–10 (seats around the table).
- **Cards per round:** Round 1 → 7 cards per player, Round 2 → 8, … Round 7 → 13.

---

## Card Values and Wilds

- **Ranks:** 2–10, J (11), Q (12), K (13), A (14). Joker has rank 0.
- **Wild cards:** All **2s** and all **Jokers** are wild (can stand for any rank/suit in melds).
- **Penalties** (counted at end of each round for cards left in hand):
  - Joker: **50**
  - Ace: **20**
  - K, Q, J, 10: **10** each
  - 9 down to 2: **5** each

---

## Melds

Two types of melds are used:

1. **Trio** — 3 or more cards of the **same rank** (e.g. 7♥ 7♦ 7♣). Wilds (2s and Jokers) may substitute, but there must be **more natural cards than wilds** in the meld.
2. **Straight** — 4 or more cards of the **same suit** in **consecutive rank** (e.g. 5♥ 6♥ 7♥ 8♥). Ace can be high (…Q-K-A) or low (A-2-3-4). Again, more natural cards than wilds; no wrap (e.g. K-A-2-3 is not valid).

---

## Round Contracts (7 Rounds)

Each round has a **contract**: you must play melds that satisfy it before you can add to other melds or swap jokers. The contracts used in this app are:

| Round | Min cards | Requirements |
|-------|-----------|--------------|
| 1 | 6 | 2 trios (each ≥ 3 cards) |
| 2 | 7 | 1 trio (≥ 3) + 1 straight (≥ 4) |
| 3 | 8 | 2 straights (each ≥ 4) |
| 4 | 9 | 3 trios (each ≥ 3) |
| 5 | 10 | 2 trios (≥ 3) + 1 straight (≥ 4) |
| 6 | 11 | 2 straights (≥ 4) + 1 trio (≥ 3) |
| 7 | 12 | 3 straights (each ≥ 4) |

You must **“go down”** by playing melds that meet the current round’s contract. After that, on later turns you may add to your own melds, add to other players’ melds, and swap jokers (see below).

---

## Turn Flow

1. **Draw** — At the start of your turn, draw **one** card either from the **stock** or from the **top of the discard pile** (if the discard option applies; see below).
2. **Play** — Optionally:
   - **Play new melds** that satisfy (or help satisfy) the round contract.
   - **Add cards** to your own melds or to any other player’s melds (only after you have already played your initial contract melds).
   - **Swap a joker:** If a meld (yours or another’s) contains a joker, you may replace that joker with a natural card from your hand that fits the meld; the joker goes into your hand. You must then **play that joker in a meld** before you can discard (you cannot discard the joker the same turn you took it).
3. **Discard** — End your turn by discarding **one** card face-up onto the discard pile.

---

## Discard Option (Take or Pass)

When a player discards, the **next player** (in turn order) gets the option to **take** that top discard instead of drawing from the stock. The game can enforce a short delay (e.g. 0–30 seconds) before “Take or pass” is available, so that the next player can decide. If they **take** it, they take the top discard (and usually draw one more card from the stock in some variants; confirm in implementation). If they **pass**, normal turn order continues and the next player may draw from stock or (when applicable) take the new top discard.

---

## Round End and Scoring

- When a player **goes out** (plays their last card in a discard, with no cards left in hand), the round ends.
- All other players sum the **penalty values** of the cards left in their hand (see “Card Values and Wilds” above).
- That sum is added to their **total score**. Lowest total score at the end of **Round 7** wins the game.

---

## Optional Rules (in this app)

- **Turn timer:** Optional seconds-per-turn limit (0 = no limit), configurable in the lobby.
- **Discard option delay:** 0–30 seconds before the next player can choose “Take” or “Pass” on the discard.

---

*End of basic rules. Implement the “How to play” UI when ready; this file is for content and reference only.*
