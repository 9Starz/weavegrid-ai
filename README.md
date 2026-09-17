# WeaveGrid AI — AI-Powered Virtual Power Plant

**One dashboard that turns disconnected clean-energy assets into a coordinated Virtual Power Plant — and proves, with numbers, that AI coordination cuts cost, carbon, and peak grid stress.**

**Competition tracks — all five AI for Clean Energy focus areas covered:** Project Development Intelligence (`/development`) · Smart Grid Integration (`/optimization`) · Clean Energy Asset Monitoring (`/assets`, `/dashboard`) · Long-Term Yield Forecasting (`/forecast`, `/validation`, `/development`) · Clean Energy Solutions (`/demo`, `/copilot`)

## ⚡ Judging in a hurry? 60 seconds:

1. 🔗 **Live demo:** **https://weavegrid-ai.vercel.app** *(deployed on Vercel, zero config)*
2. ▶ Open **`/demo`** — a 3-act story: the 6pm problem → three coordinated AI moves → the measurable result. Across the simulated days we sampled, coordination cut **grid imports 24.6–43.4%** and avoided **416–806 kg CO₂/day** on identical assets and weather — *illustrative simulation outcomes; `/demo` recomputes them live for the current day.*
3. ✦ Ask the **`/copilot`**: *"Why did the battery discharge at 6pm?"* — every answer is grounded in the current simulated fleet state
4. 🎬 **Video walkthrough:** [WeaveGrid AI demo video](https://www.youtube.com/watch?v=7xC6zdrb-8s) · 📸 [Screenshots below](#-visual-tour) · 📜 [Full demo script](docs/DEMO.md)

---

## Built for Malaysia 🇲🇾

WeaveGrid AI is a **Malaysia-first clean-energy platform**, modelled on Malaysia's own renewable ecosystem and the national push toward 70% renewable capacity by 2050. The demo fleet models six real Malaysian locations using simulated operational data — a **Large Scale Solar (LSS)** park in Kedah, the **Bakun** hydro plant in Sarawak, a **Cyberjaya** battery energy storage system, **Putrajaya** EV fast charging, the **TRX** smart commercial district, and a **Kudat** small-wind pilot — with development screening across Kedah, Selangor, Sarawak and beyond, referencing local frameworks (TNB interconnection, DOE environmental screening, NEM 3.0).

- **Primary mix:** Solar PV · Hydro · Battery Energy Storage · EV infrastructure · Smart buildings
- **Secondary / emerging:** Small wind pilots (Kudat) · Biomass — the platform scales to these as the fleet grows

## The problem

Industrial parks, campuses, and smart cities across Malaysia own solar farms, hydro, batteries, EV chargers, and smart buildings — but operate them as disconnected silos. Every asset behaves sensibly on its own, yet the system as a whole fails every evening: demand peaks exactly when solar collapses and grid power costs 3x. The result is avoidable on-peak imports, avoidable carbon, and avoidable cost — every single day.

## The solution

WeaveGrid AI unifies the whole fleet into one Virtual Power Plant with four AI layers on top:

| Layer | What it does | Where |
|---|---|---|
| **Development** | Screens candidate sites for the next asset (resource, interconnection, permitting, land), models yield & economics, and shows what today's simulated fleet would look like with the new asset online | `/development` |
| **Forecasting** | Predicts the next 24h of generation & demand with confidence bands, peak timing, surplus/shortage windows, weather impact, and a grid-risk rating | `/forecast` |
| **Validation** | Scores yesterday's forecast against what actually happened — accuracy, confidence calibration, a named cause for the largest miss, and a 7-day reliability trend. Answers *"why trust the AI?"* | `/validation` |
| **Recommendations** | Time-aware, grounded advice — each with a reason, expected impact, confidence score, and suggested action | `/dashboard` |
| **Optimization** | A five-rule decision engine that coordinates battery, EV, and grid flows — and proves its value with a before/after comparison on identical inputs | `/optimization` |
| **Copilot** | Plain-English operator Q&A grounded in the current simulated fleet, forecast, and optimization state | `/copilot` |

## The 60-second demo (`/demo`)

1. **The 6pm problem** — buildings and EV chargers peak together as solar dies and power hits RM0.34/kWh.
2. **Three coordinated moves** — bank free midday renewables in the battery, shift flexible EV charging overnight, discharge the battery through the peak.
3. **The measurable result** — *illustrative simulation outcomes, not measured results from a real deployed fleet.* Figures shift with each day's simulated weather, demand, generation, and fleet conditions. Across the simulated days we sampled, AI coordination cut **grid imports 24.6–43.4%**, avoided **416–806 kg CO₂/day**, produced **simulated cost savings of RM1,247–1,408/day**, and lowered **peak demand 7.0–7.9%** — on identical assets and weather. The live `/demo` page recomputes the exact figures for the current day.

Every number on every page derives from one simulation source, so the story is internally consistent and auditable. Full presenter script + recording checklist: [docs/DEMO.md](docs/DEMO.md).

## 📸 Visual tour

| | |
|---|---|
| **Dashboard** — live KPIs, AI insights, optimization impact ![Dashboard](docs/screenshots/dashboard.png) | **Demo Story** — the 3-act judge walkthrough ![Demo Story](docs/screenshots/demo.png) |
| **Optimization** — before/after on identical inputs, decision timeline ![Optimization](docs/screenshots/optimization.png) | **Forecast** — 24h generation & demand with confidence bands ![Forecast](docs/screenshots/forecast.png) |
| **AI Copilot** — grounded operator Q&A (Claude + rule-engine fallback) ![Copilot](docs/screenshots/copilot.png) | **Assets** — fleet inventory with utilization & health ![Assets](docs/screenshots/assets.png) |
| **Development** — site screening, feasibility, VPP integration impact ![Development](docs/screenshots/development.png) | **Validation** — forecast accuracy vs actuals, confidence & error explanation ![Validation](docs/screenshots/validation.png) |

**Design system:** the full enterprise brand/color/type reference — pitch-deck-ready, matching the app 1:1 — is in [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md).

## How the AI works (honestly)

- **Simulation engine** (`lib/simulation/`) generates a realistic 24h day — solar/wind/hydro curves, building & EV demand, time-of-use prices, weather — in two variants: *raw* (assets uncoordinated) and *AI-optimized* (VPP-coordinated). Deterministic per calendar day, so demos are stable.
- **Forecasting** (`lib/forecasting/`) is a rule-based persistence+physics model with horizon-widening confidence bands. It sits behind a single `forecastNext24h()` seam — swapping in a trained ML model touches one file, zero callers.
- **Optimization** (`lib/optimization/`) expresses the five VPP rules (charge on surplus, discharge on peak, delay EVs under stress, export when full, import only when necessary) as a readable rules table, then derives an explainable decision timeline — every action has a time window, magnitude, and a WHY with real numbers.
- **Copilot** (`lib/ai/copilot.ts` + `lib/ai/claudeProvider.ts`) answers operator questions grounded in the same simulated fleet data the dashboard shows. With `ANTHROPIC_API_KEY` set (server-side env var, never exposed to the browser) it calls **Anthropic Claude** with the full fleet snapshot as grounding context; without a key — or if the API call fails or times out — a deterministic intent-routing rule engine answers from the same data, so the demo can never break mid-pitch. The UI labels every reply with the engine that produced it.

We deliberately labeled what is rule-based as rule-based. The value the judges see — forecasts, decisions, savings — is real computation over the simulated fleet, not canned strings.

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Recharts · deployed on Vercel. No database or API keys required — the whole demo runs from the in-process simulation, which makes it trivially deployable and impossible to break mid-demo.

## Pages

`/dashboard` — live KPIs, AI insights, optimization impact, energy mix & demand charts, alerts
`/development` — site screening, feasibility economics, VPP integration impact, development roadmap
`/assets` — fleet inventory: capacity, live output, utilization, health scores, per-asset alerts
`/forecast` — 24h generation/demand forecast with confidence bands, surplus/shortage, weather impact, grid risk
`/validation` — forecast accuracy vs actuals, confidence calibration, error explanation, 7-day reliability trend
`/optimization` — before/after KPI grid, grid-import comparison, battery & EV schedules, AI decision timeline
`/copilot` — grounded operator Q&A with suggested prompts
`/demo` — the scripted 60-second judge walkthrough

## Run it

```bash
npm install
npm run dev     # http://localhost:3000 → redirects to /dashboard
npm run build   # production build (used by Vercel)
```

Optional — Claude-powered Copilot: copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` (on Vercel: Project Settings → Environment Variables). Without a key the copilot runs on its deterministic rule engine; nothing else changes.

Deploy: import the repo at [vercel.com/new](https://vercel.com/new) — zero configuration needed.

## Roadmap to production

1. **Real data ingestion** — replace the simulation seam with SCADA/meter/inverter feeds (the `raw` variant becomes telemetry).
2. **ML forecasting** — swap `forecastNext24h()` for a trained model on weather + calendar features.
3. **Copilot memory & actions** — the Claude provider is live (see above); next: persistent conversation history and closing the loop from answer to dispatch action.
4. **Persistence & multi-tenant** — Supabase/Postgres schema (designed) for fleets, time series, and decision audit logs.
5. **Dispatch integration** — close the loop from recommendation to actual battery/EVSE control via OpenADR/OCPP.
