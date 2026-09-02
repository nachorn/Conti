# Responsive UI verification

Verified locally on 2026-09-02, on branch `codex/test-branch`.

## Automated checks

- Server suite: 11 tests passed, 0 failed (`npm test`).
- Client TypeScript and Vite production build passed (`npm run build --prefix client`).
- `git diff --check` passed.

## Browser checks

The following are browser viewport tests, not tests on physical iOS/Android devices.

| Viewport | Coverage |
| --- | --- |
| 390 × 844 | Lobby, room setup, live Continental, 14-card hand, ten-player seating, scoreboard, Pocha preview |
| 820 × 1180 | English/Spanish lobby, invitation, live Continental, 14-card hand, Pocha preview |
| 1440 × 900 | Continental table/14-card hand and Pocha preview |
| 1280 × 720 | Desktop lobby and room creation |
| 320 × 568 | Ten-player seating and horizontal overflow |
| 844 × 390 | Ten-player landscape seating, table/header separation, scrollable game layout |

Verified interactions:

- Create/join with labeled forms and Enter submission.
- Invitation pre-fills the room code and focuses the Join name field.
- Keyboard seat selection; Start disabled with one player and enabled with two.
- Live two-session take/pass, stock draw, card selection, discard, and opponent updates.
- Single-row scrolling hand at narrow widths; 14-card development fixture remains selectable.
- Native card keyboard selection and selected-state semantics.
- Full-viewport scoreboard with initial focus, Escape close, and focus return.
- Room-menu disclosure and Escape close.
- Animation cancellation during a ten-player deal leaves draw piles visible.
- Development round progression through round seven and result screens.
- No page-level horizontal overflow in the checked layouts; no seat-to-seat overlaps in the small-phone/landscape ten-player checks after fixes.
- No browser warning/error logs in the live two-player sessions or Pocha card-control test.

Temporary socket clients and test rooms were disconnected after testing.

## Known scope limits

- Pocha is explicitly labeled a **local preview**. Its existing mock does not simulate opponents or support complete multiplayer matches. Selection and one-card play were checked, not a full Pocha match.
- Full seven-round live Continental play and every meld/joker interaction were not exhaustively browser-tested in this pass; existing server tests remain the rule-regression coverage.
- Physical-device touch behavior, mobile keyboards, Safari-specific behavior, and assistive-technology output still warrant device testing.

## Repeat locally

1. Install the project dependencies and run `npm run dev`.
2. Open two browser tabs, create a room, and join through its invitation link.
3. Set take/pass delay to zero for the smoke test, start, then pass/take, draw, select, and discard in both sessions.
4. Check the viewport sizes above, including hand scrolling and the scoreboard.
5. Run `npm test` and `npm run build --prefix client` before merging.

The development-only Continental shortcut can be used to inspect later-round hand sizes; it is hidden in production builds.
