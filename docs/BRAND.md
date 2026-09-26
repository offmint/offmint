# Offmint brand kit

## The mark
A coin with its top-right quarter missing, and a staircase stepping out of the gap.
- The missing quarter is the weekend: minting is off.
- The staircase is the 4-rung sell ladder: supply offered in steps above Friday's price.
- The top step breaks past the coin's outline: supply showing up exactly where the market ran out.

## Colors
| Name | Hex | Use |
|---|---|---|
| Tide (teal) | `#0E9F9A` | Primary brand color on light backgrounds, buttons, links |
| Glow (cyan) | `#3BE3EE` | Primary on dark backgrounds, highlights, the mark on dark |
| Matte | `#161819` | Secondary: dark backgrounds, text on light, the staircase on light |
| Graphite | `#2B2F31` | Borders and surfaces on dark |
| Mist | `#EEF4F3` | Light background |
| Paper | `#F4F7F7` | Text on dark |

Mark gradient (light version): `#0E9F9A` → `#3BE3EE`, bottom-left to top-right.
Keep teal/cyan for brand and interactive elements only. Use a separate, neutral treatment for gains/losses in data
so brand color is never mistaken for "profit".

## Typography
**Schibsted Grotesk** (Google Fonts, SIL Open Font License, free for commercial use).
- Wordmark: weight 680, tight tracking, lowercase `offmint`. Already outlined to paths in the SVGs, so the logo
  renders identically everywhere without the font installed.
- Headings: 600–700. Body: 400. Numbers: use `font-variant-numeric: tabular-nums` in tables and prices.
- One family for the whole product.

```html
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
```
```css
font-family: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif;
```

## Files
| File | Use |
|---|---|
| `offmint-logo-on-light.svg` | Main logo on light backgrounds |
| `offmint-logo-on-dark.svg` | Main logo on dark backgrounds |
| `offmint-logo-mono-black.svg` / `-mono-white.svg` | One-color print, stamps, watermarks |
| `offmint-mark-on-light.svg` / `-on-dark.svg` | Mark alone (avatars, small spaces) |
| `offmint-mark-mono-black.svg` / `-mono-white.svg` | One-color mark |
| `offmint-app-icon.svg` | App icon, social avatar (matte rounded square) |
| `favicon.svg` | Browser tab icon (`<link rel="icon" href="/favicon.svg" type="image/svg+xml">`) |
| `offmint-wordmark-black.svg` / `-white.svg` | Wordmark alone |

## Usage rules
- Clear space around the logo: at least the width of one stair step on every side.
- Minimum size: mark 16 px; full logo 96 px wide.
- Don't recolor the staircase and coin the same color unless using a mono version.
- Don't rotate, stretch, add shadows, or put the color logo on busy photos.
