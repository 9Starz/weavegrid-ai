# WeaveGrid AI — Design System

The single reference for brand, color, type, and layout. Every value here is the **exact token the live app uses** (`app/globals.css`, `lib/utils/chartColors.ts`), so anything built from this doc — pitch deck, one-pager, poster, Figma — will match the product 1:1.

> **Using this with Claude (or any deck tool):** paste the [Quick-paste palette](#quick-paste-palette) block into your prompt, then say "use this design system." For PowerPoint/Google Slides, load the [Office theme mapping](#office--slides-theme-mapping) as your theme colors.

---

## 1. Brand personality

**WeaveGrid AI is enterprise clean-energy intelligence.** Calm, precise, trustworthy — software a utility, grid operator, or renewable developer would deploy. Reference points: Palantir, Siemens, Schneider Electric, GE Vernova, Tesla Energy.

- **Feels like:** intelligence · trust · enterprise · innovation · clean energy · AI decision-making
- **Never:** hackathon prototype · gaming dashboard · consumer app · rainbow gradients · neon

**Design principles**
1. **Blue leads, color earns its place.** Brand blue is the default; cyan/green/amber/red appear only where they carry meaning.
2. **Whitespace is purposeful.** Fill space with real micro-data (sparklines, before/after bars), never clutter.
3. **One number, one message per tile.** Big value, small context.
4. **Light, flat, soft-shadowed.** No heavy borders, no dark chrome, no skeuomorphism.

---

## 2. Logo

- Wordmark **WeaveGrid AI** + rounded-square "W" glyph.
- Glyph fill: **diagonal gradient, brand blue → AI cyan** (`#0F4C81` → `#00C2FF`, top-left to bottom-right), white "W".
- Subtitle lockup: "Virtual Power Plant" in muted slate beneath the wordmark.
- Do **not** use rainbow, multi-stop, or green gradients. Two stops only: blue → cyan.

---

## 3. Color palette

### Brand
| Token | Hex | RGB | Use |
|---|---|---|---|
| **Brand Blue** | `#0F4C81` | 15, 76, 129 | Primary identity, titles, nav, primary buttons, primary metric, chart "grid" series |
| Brand Blue — Hover | `#1565A5` | 21, 101, 165 | Button/link hover only |
| **AI Cyan** | `#00C2FF` | 0, 194, 255 | AI & intelligence, active indicators, highlights, logo gradient end, "wind" series. *Icons/fills/accents — not body text (low contrast on white).* |

### Semantic
| Token | Hex | RGB | Use |
|---|---|---|---|
| **Renewable Green** | `#27AE60` | 39, 174, 96 | Success, optimization, renewable generation, battery, savings, positive KPI |
| **Warning Amber** | `#F39C12` | 243, 156, 18 | Warnings, peak demand, forecast uncertainty |
| **Critical Red** | `#E74C3C` | 231, 76, 60 | Critical alerts, asset failures, errors, "before AI" / uncoordinated |

### Neutrals (light theme)
| Token | Hex | RGB | Use |
|---|---|---|---|
| Background | `#F8FAFC` | 248, 250, 252 | App / slide background |
| Surface (cards) | `#FFFFFF` | 255, 255, 255 | Cards, panels, tiles |
| Surface Raised | `#F1F5F9` | 241, 245, 249 | Nested surfaces, icon tiles, progress tracks |
| Border | `#E2E8F0` | 226, 232, 240 | Card borders, dividers, chart gridlines |
| Text — Primary | `#1E293B` | 30, 41, 59 | Headings, values, body |
| Text — Secondary | `#64748B` | 100, 116, 139 | Labels, captions, chart axes |

**Contrast / pairing rules**
- Text on white: use **Primary `#1E293B`** or **Brand `#0F4C81`**. Green `#27AE60` is OK for KPI numbers; amber/red for status only.
- **Cyan `#00C2FF` is not a text color** on white — use it for icons, dots, fills, borders, and the logo. For "AI" labels, use brand-blue text with a cyan icon.
- White text (`#FFFFFF`) only on brand-blue, green, or dark fills.

---

## 4. Data-visualization palette

Fixed assignments — a series is **always** the same color, in every chart, every slide. Never reassign.

| Series | Hex | Swatch role |
|---|---|---|
| Solar | `#F4B400` | amber-gold |
| Wind | `#00C2FF` | cyan |
| Hydro | `#1565C0` | mid blue |
| Battery / Generation | `#27AE60` | green |
| Grid | `#0F4C81` | brand blue |
| Demand | `#8E44AD` | violet |
| Carbon | `#66BB6A` | soft green |
| Forecast | `#34495E` | slate grey (dashed) |

**Comparison convention:** primary/after = **brand blue** or **green**; baseline/before/uncoordinated = **critical red** or **forecast grey**, dashed. On-peak windows = **amber wash** (8% opacity).

**Chart chrome (light):** axis text `#64748B` · gridlines `#E2E8F0` (horizontal only, minimal) · tooltip = white card, `#E2E8F0` border, `#1E293B` text, soft shadow. Keep charts clean and executive — few gridlines, highlight only what matters.

---

## 5. Typography

**Inter** everywhere; **JetBrains Mono** for technical/tabular readouts.

| Role | Font / weight | Notes |
|---|---|---|
| Display / big KPI numbers | Inter **ExtraBold** (800) | tabular figures, tight tracking |
| Headings (H1–H2) | Inter **Bold** (700) | tight tracking |
| Subtitles / section labels | Inter **SemiBold** (600) | often UPPERCASE, letter-spaced, in secondary text |
| Body | Inter **Regular** (400) | 1.5 line-height |
| Technical / mono values | **JetBrains Mono** | timestamps, code, dense tabular figures |

Deck scale suggestion: Slide title 40–44px Bold · Section 24–28px SemiBold · Body 16–18px Regular · Big stat 64–96px ExtraBold · Caption 13–14px Regular (secondary).

---

## 6. Spacing, radius, elevation

- **8px spacing system** — use multiples of 8 (8/16/24/32/40…); 4px only for tight inline gaps. Generous whitespace; do not overcrowd.
- **Corner radius:** 12px cards/panels · 8px inputs/small tiles · 9999px pills/badges.
- **Card elevation (soft):** `0 1px 2px rgba(15,23,42,0.04), 0 2px 8px rgba(15,23,42,0.05)`. One level only — no heavy drop shadows.
- Cards = white surface + 1px `#E2E8F0` border + soft shadow + 20–24px padding.

---

## 7. Components

**Buttons**
- Primary: brand blue `#0F4C81` fill, white text, radius 8px; hover `#1565A5`.
- Secondary: white fill, brand-blue text, brand-blue border.
- Ghost: text only, brand blue.

**KPI tile:** uppercase secondary label (top-left) + optional icon tile (top-right, accent-tinted) → ExtraBold value in accent color → small caption → optional footer micro-viz (sparkline or before/after bar).

**Badges / status pills:** rounded-full, tinted background at ~10% + solid text/border. Normal = green, Warning = amber, Critical = red, Info/AI = cyan or brand.

**Icons:** **Lucide** line icons, ~2px stroke. No emoji. Enterprise line style, sized 16–20px in UI.

---

## 8. Motion

Subtle only — fade + small slide (≈0.35s ease-out), gentle hover states. No flashy or looping effects. Charts render complete (no draw-in) for demo reliability.

---

## 9. Pitch-deck application

**Backgrounds:** white `#FFFFFF` or off-white `#F8FAFC`. Optional accent slides: solid brand-blue `#0F4C81` with white text for section dividers / the closing statement. Avoid dark slides except a single high-impact divider if desired.

**Per-slide roles**
- Title & headers → brand blue `#0F4C81` (or primary text on light).
- One accent per slide — pick from cyan/green/amber by meaning; don't rainbow a slide.
- Big metrics → Inter ExtraBold, green for savings/positive, brand blue for scale/primary.
- Charts → the fixed data-viz palette above, exactly.
- Icons → Lucide, brand blue or the slide's single accent.

**Do**
- Lots of whitespace; one idea per slide.
- Brand blue as the spine; cyan = AI, green = savings/clean, amber = risk, red = failure.
- Consistent series colors across every chart.

**Don't**
- ❌ rainbow palettes, neon, gradients other than blue→cyan.
- ❌ cyan text on white; red/amber as decoration (status only).
- ❌ more than one accent competing per slide; heavy shadows; emoji.

### Quick-paste palette
```
Brand Blue     #0F4C81   (primary: titles, nav, buttons, "grid")
Brand Hover    #1565A5
AI Cyan        #00C2FF   (AI, active, highlights, "wind" — icons/fills, not text)
Renewable Green#27AE60   (success, savings, generation, battery)
Warning Amber  #F39C12   (peak demand, uncertainty)
Critical Red   #E74C3C   (alerts, failures, "before AI")
Background      #F8FAFC
Card White      #FFFFFF
Surface Raised  #F1F5F9
Border          #E2E8F0
Text Primary    #1E293B
Text Secondary  #64748B
Data viz — Solar #F4B400 · Wind #00C2FF · Hydro #1565C0 · Battery/Gen #27AE60 ·
Grid #0F4C81 · Demand #8E44AD · Carbon #66BB6A · Forecast #34495E
Fonts: Inter (Bold/SemiBold/Regular, ExtraBold for big numbers) · JetBrains Mono (technical values)
```

### Office / Slides theme mapping
For a PowerPoint or Google Slides custom theme (Slide Master → Colors):

| Theme slot | Hex |
|---|---|
| Text 1 (dark) | `#1E293B` |
| Background 1 (light) | `#FFFFFF` |
| Text 2 | `#64748B` |
| Background 2 | `#F8FAFC` |
| Accent 1 | `#0F4C81` (brand blue) |
| Accent 2 | `#00C2FF` (cyan) |
| Accent 3 | `#27AE60` (green) |
| Accent 4 | `#F39C12` (amber) |
| Accent 5 | `#8E44AD` (demand violet) |
| Accent 6 | `#F4B400` (solar gold) |
| Hyperlink | `#0F4C81` |
| Followed hyperlink | `#1565A5` |
