import React, { useMemo } from 'react'
import { AbsoluteFill, Audio, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'
import type { Alert, Music, Trade, Voiceover } from '../src/schema'
import { BrandCanvas, Frame, HAIRLINE, INK, MicroLabel, MUTED, ORANGE, displaySymbol, fmtLocalTime, fmtPrice, sideLabel, tzLabel } from './brand'
import { BrandOutro, OUTRO_FRAMES } from './BrandOutro'
import { IntroSection, ResultSection, chartSkin, resolveStyles } from './styles'
import type { ChartSkin, StyleOverrides } from './styles'

// Scrolling candle replay of a closed trade: CONTEXT_CANDLES of pre-entry
// market stream by muted, the entry candle is marked in passing as the signal
// moment, and the trade plays out (slow -> fast -> slow) against fixed
// entry/TP/SL levels with shaded zones. Runs on real klines; without them
// build-props fails the render (the only template is candle-only).
// fixed section lengths: intro card and result card each hold 4s
const INTRO_FRAMES = 120
const RESULT_FRAMES = 120
const CONTEXT_FRAMES = 7 // per context candle
const SLOW_FRAMES = 10 // per trade candle at the two ends (~3 candles/sec)
const HOLD_FRAMES = 24 // full-chart hold under the result stamp

// fast-phase frames per candle: speeds up as trades get longer so a fully
// paginated (unmerged) replay of a long trade stays watchable
function fastFramesFor(middle: number): number {
  if (middle > 1200) return 1
  if (middle > 500) return 2
  return 3
}

// index of the candle that contains the fill time (naive dashboard-local
// timestamps reach UTC via tz_offset_minutes — mirrors toUtcMs in
// scripts/build-props.mjs)
function entryCandleIndex(trade: Trade): number {
  const klines = trade.klines ?? []
  if (!trade.filled_at || klines.length < 2) return 0
  const v = String(trade.filled_at)
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(v)
  const t = hasTz ? Date.parse(v) : Date.parse(`${v}Z`) - (trade.tz_offset_minutes ?? 0) * 60_000
  if (!Number.isFinite(t)) return 0
  const spacing = klines[1]![0] - klines[0]![0]
  const idx = klines.findIndex(k => k[0] <= t && t < k[0] + spacing)
  return idx === -1 ? 0 : idx
}

// narration timing: the alert chime fires 1s in, the voice starts with the
// chart section and runs to the end of the composition so its payoff + CTA
// land ON the result card (fixed 4s, then the brand outro). candles flex into
// whatever room is left: the fast phase slows up to FAST_CAP or compresses to
// FAST_FLOOR, and the post-chart hold absorbs the remainder.
const FAST_CAP = 6
const FAST_FLOOR = 1
const VO_START_FRAMES = INTRO_FRAMES
const VO_TAIL_FRAMES = 12

// piecewise pacing: muted context -> entry marked in passing -> trade (slow/fast/slow)
export function playoutPacing(trade: Trade, voSeconds?: number | null) {
  const n = trade.klines?.length ?? 0
  const entryIndex = entryCandleIndex(trade)
  const ctxFrames = entryIndex * CONTEXT_FRAMES
  const tradeCount = Math.max(0, n - entryIndex)
  const head = Math.min(10, Math.floor(tradeCount * 0.2))
  const tail = Math.min(10, Math.floor(tradeCount * 0.2))
  const middle = Math.max(0, tradeCount - head - tail)
  let fast = fastFramesFor(middle)
  let hold = HOLD_FRAMES

  if (voSeconds != null && Number.isFinite(voSeconds) && voSeconds > 0) {
    // the chart flexes so the voice (starting with the chart, small tail at
    // the very end) ends on the fixed 4s result card
    const voFrames = Math.ceil(voSeconds * 30)
    const targetChart = VO_START_FRAMES + voFrames + VO_TAIL_FRAMES - INTRO_FRAMES - RESULT_FRAMES
    const natural = ctxFrames + (head + tail) * SLOW_FRAMES + middle * fast + hold
    const delta = targetChart - natural
    if (delta > 0) {
      const stretch = Math.min(delta, (FAST_CAP - fast) * middle)
      fast += middle > 0 ? stretch / middle : 0
      hold += delta - stretch
    } else if (delta < 0) {
      const shrink = Math.min(-delta, hold)
      hold -= shrink
      const remaining = -delta - shrink
      if (remaining > 0 && middle > 0) fast = Math.max(FAST_FLOOR, fast - remaining / middle)
    }
  }

  const f1 = ctxFrames + head * SLOW_FRAMES
  const f2 = f1 + middle * fast
  const f3 = f2 + tail * SLOW_FRAMES
  const total = f3 + hold
  return { n, entryIndex, ctxFrames, head, middle, tail, fast, f1, f2, f3, total, resultFrames: RESULT_FRAMES }
}

export function playoutDuration(trade: Trade, voSeconds?: number | null): number {
  const pacing = playoutPacing(trade, voSeconds)
  return INTRO_FRAMES + pacing.total + pacing.resultFrames + OUTRO_FRAMES
}

// chart-local frame at which candle i becomes visible (inverse of the pacing);
// shared by the renderer and the print ticks
export function candleAppearFrame(i: number, pacing: ReturnType<typeof playoutPacing>): number {
  if (i <= pacing.entryIndex) return i * CONTEXT_FRAMES
  if (i <= pacing.entryIndex + pacing.head) return pacing.ctxFrames + (i - pacing.entryIndex) * SLOW_FRAMES
  if (i <= pacing.entryIndex + pacing.head + pacing.middle) return pacing.f1 + (i - pacing.entryIndex - pacing.head) * pacing.fast
  return pacing.f2 + (i - pacing.entryIndex - pacing.head - pacing.middle) * SLOW_FRAMES
}

// candle-print ticks: a blip per revealed candle, high pitch on up candles and
// low on down ones, thinned so ticks never land closer than MIN_TICK_GAP
const TICK_UP = 'sfx/candle-tick-up.wav'
const TICK_DOWN = 'sfx/candle-tick-down.wav'
const MIN_TICK_GAP = 5
const TICK_VOLUME = 0.35

export function candleTicks(trade: Trade, pacing: ReturnType<typeof playoutPacing>): { frame: number; up: boolean }[] {
  const klines = trade.klines ?? []
  const ticks: { frame: number; up: boolean }[] = []
  let last = -Infinity
  for (let i = 0; i < klines.length; i++) {
    const frame = Math.round(candleAppearFrame(i, pacing))
    if (frame - last >= MIN_TICK_GAP) {
      ticks.push({ frame, up: klines[i]![4] >= klines[i]![1] })
      last = frame
    }
  }
  return ticks
}

export const TradePlayOut: React.FC<{
  trade: Trade
  voiceover?: Voiceover | null
  music?: Music | null
  alert?: Alert | null
  styles?: StyleOverrides
}> = ({ trade, voiceover, music, alert, styles }) => {
  const pacing = playoutPacing(trade, voiceover?.durationSeconds)
  const chime = alert ?? { src: 'sounds/universfield-new-notification-010-352755.mp3', volume: 0.6 }
  const ticks = candleTicks(trade, pacing)
  const style = resolveStyles(trade.trade_id ?? trade.symbol ?? 'x', styles)

  return (
    <>
      <Frame trade={trade}>
        {/* alert chime 1s in, narration opens the chart section */}
        <Sequence from={30}>
          <Audio src={staticFile(chime.src)} volume={chime.volume} />
        </Sequence>
        {/* one tick per printed candle (chart-local frames offset by the intro) */}
        {ticks.map((t, i) => (
          <Sequence key={i} from={INTRO_FRAMES + t.frame}>
            <Audio src={staticFile(t.up ? TICK_UP : TICK_DOWN)} volume={TICK_VOLUME} />
          </Sequence>
        ))}
        {voiceover ? (
          <Sequence from={VO_START_FRAMES}>
            <Audio src={staticFile(voiceover.src)} />
          </Sequence>
        ) : null}
        {music ? <Audio src={staticFile(music.src)} volume={music.volume} loop /> : null}
        <Sequence from={0} durationInFrames={INTRO_FRAMES}>
          <IntroSection family={style.intro} trade={trade} />
        </Sequence>

        <Sequence from={INTRO_FRAMES} durationInFrames={pacing.total}>
          <BrandCanvas />
          <ReplayChart trade={trade} pacing={pacing} skin={chartSkin(style.chart)} />
        </Sequence>

        <Sequence from={INTRO_FRAMES + pacing.total} durationInFrames={pacing.resultFrames}>
          <ResultSection family={style.result} trade={trade} />
        </Sequence>
      </Frame>

      {/* opaque end card: covers the frame chrome entirely (zIndex above the
          header/url chrome, which sits at 5) */}
      <Sequence from={INTRO_FRAMES + pacing.total + pacing.resultFrames} style={{ zIndex: 10 }}>
        <BrandOutro />
      </Sequence>
    </>
  )
}

const CHART = { left: 90, width: 830, top: 430, height: 1060 }
const AXIS_X = 955
// candles fully visible before the viewport starts panning
const VISIBLE = 48
// once panning, the newest candle rides at this fraction of the chart width
const NEW_AT = 0.8
// unrendered slots reserved past the exit candle so it lands left of the
// chart's right edge instead of touching it
const GHOST_SLOTS = 5

type Candle = [number, number, number, number, number]

// kline spacing -> timeframe label for the chart header
const INTERVAL_LABELS: Record<number, string> = {
  60000: '1M',
  300000: '5M',
  900000: '15M',
  3600000: '1H',
  14400000: '4H',
  86400000: '1D',
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

// decimals that keep the whole axis readable for any price magnitude
function decimalsFor(range: number): number {
  if (range >= 1000) return 0
  if (range >= 100) return 1
  if (range >= 10) return 2
  if (range >= 1) return 3
  if (range >= 0.001) return 5
  return 7
}
const fmtAxis = (p: number, range: number) =>
  p.toLocaleString('en-US', { minimumFractionDigits: decimalsFor(range), maximumFractionDigits: decimalsFor(range) })

const ReplayChart: React.FC<{ trade: Trade; pacing: ReturnType<typeof playoutPacing>; skin: ChartSkin }> = ({ trade, pacing, skin }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const klines: Candle[] = trade.klines ?? []
  const n = klines.length
  const spacing = n > 1 ? klines[1]![0] - klines[0]![0] : 0
  const timeframe = INTERVAL_LABELS[spacing] ?? (spacing ? `${Math.round(spacing / 60_000)}M` : '')
  const { entryIndex, ctxFrames, f1, f2, f3 } = pacing

  const geo = useMemo(() => {
    if (!n) return null
    let minP = Math.min(...klines.map(k => k[3]))
    let maxP = Math.max(...klines.map(k => k[2]))
    for (const p of [trade.entry, trade.close]) {
      if (p != null) {
        minP = Math.min(minP, p)
        maxP = Math.max(maxP, p)
      }
    }
    const rawRange = maxP - minP || 1
    // TP/SL only stretch the scale when the candles actually ranged near them
    for (const p of [trade.take_profit, trade.initial_stop]) {
      if (p != null && p >= minP - rawRange * 0.6 && p <= maxP + rawRange * 0.6) {
        minP = Math.min(minP, p)
        maxP = Math.max(maxP, p)
      }
    }
    const pad = (maxP - minP) * 0.08 || 1
    minP -= pad
    maxP += pad
    // when there are more candles than fit, the slot is fixed by the viewport
    // and the extra candles scroll; fewer candles just spread across the width.
    // GHOST_SLOTS reserves empty room past the exit candle.
    const totalSlots = n + GHOST_SLOTS
    const slot = totalSlots > VISIBLE ? CHART.width / VISIBLE : CHART.width / totalSlots
    return {
      minP,
      maxP,
      range: maxP - minP,
      slot,
      xFor: (i: number) => CHART.left + (i + 0.5) * slot,
      yFor: (p: number) => CHART.top + ((maxP - p) / (maxP - minP)) * CHART.height,
    }
  }, [klines, n, trade.entry, trade.close, trade.take_profit, trade.initial_stop])

  const chartIn = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' })

  if (!geo) {
    return (
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <MicroLabel bullet={false} color={MUTED}>
          NO CHART DATA
        </MicroLabel>
      </AbsoluteFill>
    )
  }

  const { minP, maxP, range, slot, xFor, yFor } = geo
  // continuous reveal through the pacing; the viewport pans so the newest
  // candle keeps riding at NEW_AT of the chart width
  let revealedFloat: number
  const tradeStartFrame = ctxFrames
  if (frame < ctxFrames) revealedFloat = frame / CONTEXT_FRAMES
  else if (frame < tradeStartFrame) revealedFloat = entryIndex
  else if (frame <= f1) revealedFloat = entryIndex + (frame - tradeStartFrame) / SLOW_FRAMES
  else if (frame <= f2) revealedFloat = entryIndex + pacing.head + (frame - f1) / pacing.fast
  else revealedFloat = Math.min(n, entryIndex + pacing.head + pacing.middle + (frame - f2) / SLOW_FRAMES)
  revealedFloat = clamp(revealedFloat, 0, n)

  // the frame at which candle i appears (inverse of the pacing), so candles
  // render fully formed with a constant fade no matter the phase speed
  const appearFrameOf = (i: number): number => candleAppearFrame(i, pacing)
  let revealed = 0
  while (revealed < n && appearFrameOf(revealed) <= frame) revealed++
  const maxPan = Math.max(0, (n + GHOST_SLOTS) * slot - CHART.width)
  const pan = clamp((revealedFloat + 0.5) * slot - NEW_AT * CHART.width, 0, maxPan)

  const last = klines[revealed - 1]
  const entryY = trade.entry != null ? yFor(trade.entry) : null
  const bodyW = slot * skin.bodyScale
  const entryX = xFor(entryIndex) - CHART.left

  const ticks = Array.from({ length: 5 }, (_, i) => maxP - (range / 4) * i)

  const levels: { label: string; price: number; color: string }[] = []
  if (trade.take_profit != null && trade.take_profit >= minP && trade.take_profit <= maxP) {
    levels.push({ label: `TP ${fmtPrice(trade.take_profit)}`, price: trade.take_profit, color: ORANGE })
  }
  if (trade.initial_stop != null && trade.initial_stop >= minP && trade.initial_stop <= maxP) {
    levels.push({ label: `SL ${fmtPrice(trade.initial_stop)}`, price: trade.initial_stop, color: MUTED })
  }

  return (
    <AbsoluteFill style={{ opacity: chartIn }}>
      {/* chart header: pair + side chip, timeframe and entry time (bot zone) under */}
      <div style={{ position: 'absolute', left: CHART.left, top: CHART.top - 104, display: 'flex', alignItems: 'center', gap: 18 }}>
        <span style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'uppercase', color: INK, lineHeight: 1 }}>
          {displaySymbol(trade.symbol)}
        </span>
        <span style={{ border: `2px solid ${ORANGE}`, color: ORANGE, fontSize: 18, fontWeight: 800, letterSpacing: '0.14em', padding: '7px 14px' }}>
          {sideLabel(trade.side)}
        </span>
      </div>
      <div style={{ position: 'absolute', left: CHART.left, top: CHART.top - 52, color: MUTED, fontSize: 18, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        {timeframe} · ENTERED {fmtLocalTime(trade.filled_at)} {tzLabel(trade.tz_offset_minutes)}
      </div>

      {/* profit / risk zones between entry and TP / SL (either direction) */}
      {entryY != null ? (
        <>
          {trade.take_profit != null && trade.take_profit >= minP && trade.take_profit <= maxP ? (
            <div
              style={{
                position: 'absolute',
                left: CHART.left,
                width: CHART.width,
                top: Math.min(entryY, yFor(trade.take_profit)),
                height: Math.abs(entryY - yFor(trade.take_profit)),
                background: 'rgba(255,90,0,0.07)',
              }}
            />
          ) : null}
          {trade.initial_stop != null && trade.initial_stop >= minP && trade.initial_stop <= maxP ? (
            <div
              style={{
                position: 'absolute',
                left: CHART.left,
                width: CHART.width,
                top: Math.min(entryY, yFor(trade.initial_stop)),
                height: Math.abs(yFor(trade.initial_stop) - entryY),
                background: 'rgba(17,24,39,0.05)',
              }}
            />
          ) : null}
        </>
      ) : null}

      {/* scale ticks */}
      {ticks.map((p, i) => (
        <div key={i}>
          <div
            style={{
              position: 'absolute',
              left: CHART.left,
              width: CHART.width,
              top: yFor(p),
              borderTop: '1px solid rgba(17,24,39,0.06)',
            }}
          />
          <div style={{ position: 'absolute', left: AXIS_X, top: yFor(p) - 12, color: MUTED, fontSize: 17, fontWeight: 600 }}>
            {fmtAxis(p, range)}
          </div>
        </div>
      ))}

      {/* price series (panning viewport, clipped to the chart); svg
          coordinates are chart-local so they share the exact scale of the
          html overlays. pre-entry context renders muted, the trade in full
          color; the mark type (candle / OHLC bar) comes from the skin. */}
      <svg width={CHART.width} height={CHART.height} viewBox={`0 0 ${CHART.width} ${CHART.height}`} style={{ position: 'absolute', left: CHART.left, top: CHART.top, overflow: 'hidden' }}>
        <g transform={`translate(${-pan} 0)`}>
          {klines.slice(0, revealed).map((k, i) => {
            const fade = clamp((frame - appearFrameOf(i)) / 2, 0, 1)
            const up = k[4] >= k[1]
            const color = up ? ORANGE : INK
            const x = xFor(i) - CHART.left
            const yO = yFor(k[1]) - CHART.top
            const yC = yFor(k[4]) - CHART.top
            const wickTop = yFor(k[2]) - CHART.top
            const wickBot = yFor(k[3]) - CHART.top
            return (
              <g key={k[0]} opacity={(i < entryIndex ? 0.35 : 1) * fade}>
                {skin.representation === 'bar' ? (
                  <>
                    {/* OHLC bar: high-low stem, open tick left, close tick right */}
                    <line x1={x} x2={x} y1={wickTop} y2={wickBot} stroke={color} strokeWidth={3} />
                    <line x1={x - bodyW / 2} x2={x} y1={yO} y2={yO} stroke={color} strokeWidth={4} />
                    <line x1={x} x2={x + bodyW / 2} y1={yC} y2={yC} stroke={color} strokeWidth={4} />
                  </>
                ) : (
                  <>
                    <line x1={x} x2={x} y1={wickTop} y2={wickBot} stroke={color} strokeWidth={2} />
                    <rect x={x - bodyW / 2} y={Math.min(yO, yC)} width={bodyW} height={Math.max(2, Math.abs(yC - yO))} fill={color} rx={skin.roundedBodies ? 4 : 0} />
                  </>
                )}
              </g>
            )
          })}
          {/* entry moment: vertical marker at the signal candle + fill dot */}
          {frame >= ctxFrames ? (
            <g>
              <line x1={entryX} x2={entryX} y1={0} y2={CHART.height} stroke={ORANGE} strokeWidth={2} strokeDasharray="8 8" opacity={0.5 * clamp((frame - ctxFrames) / 6, 0, 1)} />
              <circle
                cx={entryX}
                cy={(trade.entry != null ? yFor(trade.entry) : yFor(klines[entryIndex]?.[1] ?? minP)) - CHART.top}
                r={spring({ frame: frame - ctxFrames, fps, config: { damping: 12, mass: 0.5 } }) * 11}
                fill={ORANGE}
                stroke="#ffffff"
                strokeWidth={4}
              />
            </g>
          ) : null}
        </g>
      </svg>

      {/* entry / TP / SL lines */}
      {entryY != null ? (
        <>
          <div style={{ position: 'absolute', left: CHART.left, width: CHART.width, top: entryY, borderTop: `3px dashed ${ORANGE}` }} />
          <div
            style={{
              position: 'absolute',
              left: CHART.left + 4,
              top: entryY - 54,
              background: '#ffffff',
              border: `2px solid ${ORANGE}`,
              color: ORANGE,
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: '0.12em',
              padding: '8px 18px',
              opacity: clamp((frame - ctxFrames) / 6, 0, 1),
            }}
          >
            ENTRY {fmtPrice(trade.entry)}
          </div>
        </>
      ) : null}
      {levels.map(l => (
        <div key={l.label}>
          <div
            style={{
              position: 'absolute',
              left: CHART.left,
              width: CHART.width,
              top: yFor(l.price),
              borderTop: `2px dashed ${l.color}`,
              opacity: 0.75,
            }}
          />
          <div
            style={{
              position: 'absolute',
              right: 1080 - CHART.left - CHART.width + 10,
              top: yFor(l.price) - 36,
              color: l.color,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.12em',
            }}
          >
            {l.label}
          </div>
        </div>
      ))}

      {/* live price line + axis tag */}
      {last ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: CHART.left,
              width: CHART.width,
              top: yFor(last[4]),
              borderTop: `2px dashed ${ORANGE}`,
              opacity: 0.45,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: AXIS_X,
              top: yFor(last[4]) - 22,
              background: '#ffffff',
              border: `2px solid ${ORANGE}`,
              color: ORANGE,
              fontSize: 19,
              fontWeight: 800,
              padding: '6px 12px',
              whiteSpace: 'nowrap',
            }}
          >
            {fmtAxis(last[4], range)}
          </div>
        </>
      ) : null}

      {/* vertical hairline between chart and axis column */}
      <div style={{ position: 'absolute', left: AXIS_X - 14, top: CHART.top, height: CHART.height, borderLeft: `1px solid ${HAIRLINE}` }} />
    </AbsoluteFill>
  )
}
