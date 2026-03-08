# Continental Rummy – Card graphics

Card graphics are **built-in** SVG components (no external assets required):

- **`CardGraphic`** – Renders a single card from game `Card` (face or back).
- **`CardFace`** – Renders a face card given `suit` and `rank` (hearts, diamonds, clubs, spades, joker; rank 2–14, 0 for joker).
- **`CardBack`** – Renders the card back (optional `accentColor`).
- **`SuitIcon`** – Suit symbols only (for melds, labels, etc.).

## Usage

```tsx
import { CardGraphic, CardBack } from '@/components/cards'
import type { Card } from '@shared/types'

<CardGraphic card={card} faceDown={false} width={70} height={98} />
<CardBack width={70} height={98} accentColor="#8b2517" />
```

## Optional: classic deck (svg-cards)

For a traditional illustrated deck (French-style faces, same dimensions), you can use the open-source **svg-cards** package:

1. Install: `npm install svg-cards` (in `client/`).
2. Copy the sprite: e.g. put `node_modules/svg-cards/svg-cards.svg` in `public/` and reference `#heart_1`, `#spade_king`, `#joker_red`, etc. in `<use href="...">`.
3. Map game cards to fragment IDs: suit → `heart`|`diamond`|`club`|`spade`, rank 14→`1`, 11→`jack`, 12→`queen`, 13→`king`, 2–10→`2`–`10`, joker→`joker_red`/`joker_black`.

Card size in that set: **169.075 × 244.64** (scale to match your UI).

License: [LGPL-2.1](https://github.com/htdebeer/SVG-cards).
