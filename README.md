# MT-Signals

Minimal Trader's public signals home and the automated renderer behind our
win-trade marketing videos.

When a strategy trade closes as a win, the MT-Dashboard backend fires a
`repository_dispatch` event into this repo with the trade data. A GitHub
Action validates the payload against the template registry, fetches Binance
candles for the trade window when the chosen template needs them (public
data mirror, `data-api.binance.vision`, so US-hosted runners work), renders
the chosen 9:16 video (Remotion), then calls back to the dashboard for a
presigned upload URL and pushes the MP4 to our social scheduler, which posts
it to TikTok and Facebook.

## Templates

`templates.json` is the single contract. Each entry declares its id (the
Remotion composition id), what inputs it requires, and what it uses if present.

| id | Title | Requires | Notes |
|---|---|---|---|
| `playout` | Candle play-out | `symbol`, `side`, `pnl_r`, `entry`, `close`, `klines` | Real Binance candles reveal one by one with entry/TP/SL levels and a live price tag, then the brand outro |

## Style rotation

Every section renders in one of several variants, all ports of the approved
designs in `concepts/stage-concepts-3.html`, defined in `templates/styles.tsx`:

- chart (2): **candle** candlesticks / **bar** OHLC bar marks
- intro (4): **oneline** entry and exit on one line / **stacked** entry over
  exit with the side word as watermark / **classic** centered card on the
  brand canvas / **bigside** giant side-word watermark with entry→exit numbers
- result (4): **duo** percent and R split by a divider / **stacked** R and
  percent stacked as heroes over a rule / **classic** giant percent /
  **heror** hero R count-up over a rule
- wave (3): the generated footer chart as **line** / **step** / **bars** — a
  random walk seeded by the trade id that always ends above its start

The header (logo, agent tag, rule) and the footer (generated wave + site URL)
are fixed chrome on every stage; the brand outro is fixed and never varies.
Variants change representation, layout and motion only — never colors: every
variant is light mode in the brand palette (white, ink, orange), so any
cross-combination still reads as one coherent video. Sections pick their
variants independently, deterministic on the trade id (2 x 4 x 4 x 3 = 96
distinct looks; consecutive wins rarely repeat one), and the same trade
always renders identically.

Force a combo for preview with env vars read by build-props:
`STYLE_CHART` (`candle` | `bar`), `STYLE_INTRO` (`oneline` | `stacked` |
`classic` | `bigside`), `STYLE_RESULT` (`duo` | `stacked` | `classic` |
`heror`), `STYLE_WAVE` (`line` | `step` | `bars`).

Selection of the template itself, at render time in `scripts/build-props.mjs`:

- `trade.template` set -> that template, validated against the registry. A
  mismatch is a hard failure (the dashboard asked for it explicitly).
- not set -> the first registry template whose `requires` are all satisfied.
  With only `playout` registered, a trade without candle data fails the
  render instead of falling back.

The dashboard can rotate templates across wins by setting `VIDEO_TEMPLATES`
(comma-separated ids); the workflow re-validates whatever it receives.

### Adding a template

1. Add the composition in `templates/`, register it in `src/Root.tsx` with the
   same id.
2. Add a row to `templates/templates.json` with its `requires` / `optional`
   inputs.
3. Optional: list the id in the dashboard's `VIDEO_TEMPLATES` to include it in
   the rotation.

## Security model

- The render workflow triggers **only** on `repository_dispatch` and manual
  `workflow_dispatch`. Both require write access to this repo, so forks and
  outside users cannot start runs.
- Fork PRs never run workflows and never see secrets.
- No platform credentials live here. The workflow only holds
  `VIDEO_CALLBACK_URL` / `VIDEO_CALLBACK_SECRET`, which let it hand a finished
  render back to our own backend.
- Trade data arriving via dispatch (symbol, side, entry/exit, R multiple) is
  the same content shown in the posted videos.

## Repo layout

```
.github/workflows/render.yml   the render + upload workflow
templates/templates.json      template registry (ids + required inputs)
templates/brand.tsx            shared brand kit (MT-Designs tokens, frame, labels)
templates/BrandOutro.tsx       shared end card (logo pop + sound + site link)
templates/TradePlayOut.tsx     template: playout (real candles)
src/schema.ts                  trade payload schema (zod)
scripts/build-props.mjs        dispatch payload -> klines -> validated props + template pick
scripts/render.mjs             local one-command renderer (-d trade.json -t template -k)
scripts/voiceover.mjs          narrative stats -> LLM copy -> Gemini TTS chain -> props + audio
public/music/*.mp3            optional licensed music beds (rotating, mixed at 0.1)
```

## Voiceover

`scripts/voiceover.mjs` runs between build-props and the render. It derives
the story numbers (dip in R, hold time, R multiple) from the trade, asks
Gemini for a budgeted script (validated: word count, no digits, no hype
language; static fallback copy if every key fails), then synthesizes it with
Gemini TTS down the free TTS models (per-model quotas add up, same prebuilt
voice set), trying each API key in order; edge-tts (keyless) is the last
resort when all keys are down. Voices, structural angles and closing
lines all rotate per trade, deterministic on `trade_id`, so consecutive wins
never sound alike. The trader is always spoken of as an agent, version
suffix on screen only. An alert chime (one file from the curated pool in
`public/sounds/`, rotating per trade) plays over the intro cards and narration
starts once the chart is on screen; the playout template stretches its fast
candle phase so the narration always finishes before the result stamp, and
closes on the brand outro card (`templates/BrandOutro.tsx`): a whoosh rises
over the white card, the MT wordmark pops in center exactly as it hits
(ripple ring expanding with the build), site link at the bottom. The sound is
a Mixkit SFX (`public/sfx/outro-whoosh-alt.mp3`, free for commercial use, no
attribution), re-timed to its peak; if you swap in a different sound, re-time
`POP_FRAME` in BrandOutro to its peak.

Env knobs: `GEMINI_API_KEY` plus any number of `GEMINI_API_KEY_2`,
`GEMINI_API_KEY_3`, ... (tried one by one for both the copy and the TTS;
when every key fails the copy falls back to static variants and the voice to
edge-tts; without any key renders are silent but never fail), `VO=skip`,
`VO_STATIC=1`, `TTS_MODELS`. The workflow maps `GEMINI_API_KEY` and
`GEMINI_API_KEY_2` secrets — add more lines in `render.yml` if you need them
in CI.

## Local development

```bash
npm install
npm run studio -- --props=props.json   # preview real props (after a render)
```

Render a video from a trade JSON file into `out/`. The trade carries either
its own `klines` or `filled_at` / `closed_at`, in which case real Binance
futures candles are fetched for the window (`trades/example.json` is a real
Sep 29 BTCUSDT trade with candles embedded):

```bash
npm run render -- trades/example.json
npm run render -- mytrade.json playout
node scripts/render.mjs mytrade.json -o out/reel.mp4
```

Flags: `-d` trade JSON file, `-t` template (`playout`),
`-o` output path (default `out/<trade_id>-<template>.mp4`). Voiceover
env knobs (`GEMINI_API_KEY`, `VO=skip`, ...) pass through; without a key the
render is silent. `node scripts/render.mjs` and `bun run render` work too.

## Signals

Live strategy signals are published here for free. The feed wiring is
documented as it lands; nothing in this repo is required to receive them.

## License

View-only, all rights reserved (see `LICENSE`). This repo is public for one
reason: GitHub Actions renders this project's own videos for free on public
repositories. It is not open source — you are welcome to read the code, but
using, copying, or building on it is not permitted without written
permission.
