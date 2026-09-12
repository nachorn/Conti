# Invitations and Continental UI — 2026-09-12

Included in the combined release with membership, payments and the optional support button. Production deployment is tracked in `MONETIZATION.md`; the checks below describe the original local review.

## Invitations

- `/room/:roomId` opens a dedicated Spanish/English invitation, showing the game, current host, room number and capacity. Guests only enter a name and join; Enter submits the form.
- `GET /api/rooms/:roomId/invite` returns minimal public metadata. Missing/expired rooms, full rooms, games already started and unavailable storage have explicit states. Metadata responses are not cached and do not prolong room retention.
- Existing invitation URLs work without changes. The account toolbar is hidden on invitation routes.
- Files: `RoomInvite.tsx`, `RoomInvite.css`, `server/src/roomInvite.ts`, `shared/roomInvite.d.ts`, `server/test/roomInvite.test.ts`, and narrow route/registration edits in `App.tsx` and `server/src/app.ts`.

## Continental

- Pocha's dark green background, pale gold controls, cream typography and softer panels now cover the room, table, hand, score dialog, meld dialog and results.
- Room setup uses a numbered seat grid with host/own-seat labels and an adjacent settings panel; small screens stack the panels. Keyboard seat changes still work.
- The round, contract and turn are clearer. Playing-table geometry, card order, compact hands and game rules are preserved.
- The playing root fills the space remaining below account/connection/ad summaries. This fixes off-screen hand controls when extra bars are present.
- Large tables now grow to fit all player rows. Small portrait screens use a shorter header and card recap to preserve action access.
- Files: `GameBoard.tsx`, `ContinentalTheme.css`, and the scoped portal class in `MeldTargetDialog.tsx`. Existing `GameBoard.css` and `TableReview.css` remain unchanged.

## Verification

- Invitation stage: server build and 139 server tests passed, including 3 real HTTP/Socket.IO invitation tests. Both Pocha and Continental joins verified in the browser.
- Continental stage: client typecheck/build and all 56 client tests passed. Final build after the responsive fixes passed. `git diff --check` passed.
- Browser checks at desktop, iPad 820×1180, phone 390×844, compact phone 360×640 and landscape 844×390.
- Real local room with 10 participants (two browser seats and eight Socket.IO guests): invite host/capacity, Enter to join, seat changes, host settings, start and dealt table checked.
- Interactive development preview: add a card to a meld, reorder a card to the end, compact hand, score dialog, round result and final result checked. This was UI validation, not ten full simulated games.
- Account toolbar plus actual `AdGate` exempt summary checked together in an ignored local fixture, with both action buttons shown. On 360×640, hand bottom = 640 and action bottom = 632; on 844×390, hand bottom = 390 and action bottom = 379. No page-width overflow. No advertising provider or payment service was activated.

## Shared workspace

The other task “Explora monetización del website” owns the membership/ad/payment changes in this checkout. Preserve those changes; they are disabled by default and have not been deployed here. Do not stage all untracked files blindly. A future invitation deployment needs the client and server updates together.
