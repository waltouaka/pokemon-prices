# outlaw · Pokémon Card Prices

Stream overlay + control room for showing Pokémon card prices on stream.

- **Control room:** open the site, pick a set → click a card → **Show on overlay**
- **Overlay (OBS Browser Source, 1920×1080):** click **Copy overlay URL** in the control room and paste it into OBS

## Features
- Browse by set (sort by number, price, or rarity) or search by name
- Raw price (TCGplayer market) + PSA 10 price (type in / Look up / optional PokemonPriceTracker key)
- **Overlay Editor** tab with live preview: layout, background, position, font, sizes, outline, spacing, colors, title text
- White text with smooth black outline, Arial Black or Pokémon font
- Private **key** links your control room to your overlay (works across devices)

## Pokémon font (optional)
Add `pokemon-solid.ttf` to this repo next to `index.html`, then pick it under **Font**.

Card data & prices: [TCGdex](https://tcgdex.dev) (TCGplayer / Cardmarket).
