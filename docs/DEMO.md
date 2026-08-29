# WeaveGrid AI — 60-Second Demo Script

The whole pitch in one sentence: **same assets, same weather, same day — AI coordination saves ~RM1,300/day (≈RM466K/yr), cuts grid imports 23–34%, and shaves the evening peak.**

## The script (narrate while clicking)

| Time | Where | What to say (roughly) |
|---|---|---|
| 0:00–0:10 | `/dashboard` | "This is WeaveGrid AI — a Virtual Power Plant coordinating six clean-energy assets: solar, wind, hydro, a battery, EV chargers, and a smart building. Everything you see is computed live." |
| 0:10–0:20 | `/demo` — Act 1 | "Every evening there's a 6pm problem: buildings and EV chargers peak together, right as solar dies and grid power hits RM0.34/kWh — three times the overnight rate." |
| 0:20–0:35 | `/demo` — Acts 2 & 3 | "The AI makes three coordinated moves: bank free midday solar in the battery, shift flexible EV charging overnight, discharge through the peak. Same day, same weather — the red line is without AI, the green line is with it." |
| 0:35–0:45 | `/demo` — result cards | "The result: peak demand down 7%, grid energy imported down 23%, about RM1,300 saved and 385 kg of CO₂ avoided — today alone. That's a ~RM466K annual run-rate from one site." |
| 0:45–0:55 | `/copilot` | Ask: **"Why did the battery discharge at 6pm?"** — "And operators don't read charts, they ask questions. Every answer is grounded in the live fleet data." |
| 0:55–1:00 | `/optimization` (scroll the timeline) | "Every decision the AI made is on this timeline with its reasoning — nothing is a black box. That's WeaveGrid AI." |

**30-second cut:** dashboard (5s) → `/demo` scroll top-to-bottom while narrating the three moves and the result (20s) → close on the Cost Saved card (5s).

## Recording checklist

Before recording:
- [ ] `npm run dev` running (or use the live Vercel URL — better: proves it's deployed)
- [ ] Record in the **evening (6–9pm local)** if possible — the dashboard shows the peak live and the story lands harder; any time still works since charts show the full day
- [ ] `ANTHROPIC_API_KEY` set if you want the green "AI-powered · Claude" badge on copilot replies
- [ ] Browser window ~1600×900, **hide bookmarks bar** (Ctrl+Shift+B), close other tabs, 100% zoom
- [ ] Do one silent practice run of the click path: `/dashboard` → `/demo` → `/copilot` → `/optimization`
- [ ] Pre-type nothing — click the suggested prompt "Why did the battery discharge at 6pm?" instead of typing live

Recording (Windows):
- [ ] **Win+G** (Game Bar) → capture, or **Clipchamp** (built-in) for screen recording at 1080p
- [ ] Keep it under 60 seconds — judges stop watching after that
- [ ] Narrate from the script above, or record silent and add captions in Clipchamp

After recording:
- [ ] Trim dead air at start/end
- [ ] Upload to YouTube as **Unlisted** (plays everywhere, no login wall)
- [ ] Put the link in README under "Judge fast path" and in the competition submission form
- [ ] Watch it once on a phone — if the numbers are readable there, they're readable anywhere
