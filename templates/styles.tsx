// Style pack: each section renders in one of several variants picked
// independently, deterministic on the trade id (different hash seed per
// section, like voices and chimes):
//   chart  candle | bar                        (2)
//   intro  oneline | stacked | classic | bigside   (4)
//   result duo | stacked | classic | heror     (4)
//
// All card layouts are ports of concepts/stage-concepts-3.html. Variants
// change REPRESENTATION and motion only — layout, chart mark type, how
// numbers are arranged, entrance animation. Colors never change: every
// variant is light mode in the brand palette (white, ink, orange), so any
// cross-combination still reads as one coherent video.
//
// Force a specific combo at render time with env vars (read by build-props
// into props.styles): STYLE_CHART / STYLE_INTRO / STYLE_RESULT.
import React from 'react'
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion'
import type { Trade } from '../src/schema'
import {
  BrandCanvas,
  FadeIn,
  INK,
  MicroLabel,
  MONO_STACK,
  MUTED,
  ORANGE,
  RULE,
  SidePill,
  SlideIn,
  SymbolHero,
  fmtDate,
  fmtLocalTime,
  fmtPrice,
  hash32,
  holdDuration,
  mulberry32,
  reasonLabel,
  sideLabel,
} from './brand'

export const CHART_FAMILIES = ['candle', 'bar'] as const
export type ChartFamily = (typeof CHART_FAMILIES)[number]
export const INTRO_FAMILIES = ['oneline', 'stacked', 'classic', 'bigside'] as const
export type IntroFamily = (typeof INTRO_FAMILIES)[number]
export const RESULT_FAMILIES = ['duo', 'stacked', 'classic', 'heror'] as const
export type ResultFamily = (typeof RESULT_FAMILIES)[number]

// one seeded PRNG per trade; sections draw in a fixed order. (Hashing
// "id|section" left the per-section hashes correlated and collapsed the
// combo space to a fraction of the cross product.)
const rotate = (tradeId: string) => {
  const rnd = mulberry32(hash32(tradeId))
  return {
    chart: CHART_FAMILIES[Math.floor(rnd() * CHART_FAMILIES.length)],
    intro: INTRO_FAMILIES[Math.floor(rnd() * INTRO_FAMILIES.length)],
    result: RESULT_FAMILIES[Math.floor(rnd() * RESULT_FAMILIES.length)],
  }
}

// independent per-section picks; explicit props.styles entries win (env path)
export type StyleOverrides = Partial<Record<'chart' | 'intro' | 'result', string>> | null | undefined

export function resolveStyles(tradeId: string, overrides?: StyleOverrides) {
  const rotated = rotate(tradeId)
  const resolve = <T extends readonly string[]>(list: T, forced: string | undefined, fallback: T[number]): T[number] =>
    forced && (list as readonly string[]).includes(forced) ? (forced as T[number]) : fallback
  return {
    chart: resolve(CHART_FAMILIES, overrides?.chart, rotated.chart),
    intro: resolve(INTRO_FAMILIES, overrides?.intro, rotated.intro),
    result: resolve(RESULT_FAMILIES, overrides?.result, rotated.result),
  }
}

// ---------------------------------------------------------------------------
// chart skins: how the price series is drawn (colors are always the brand's)

export type ChartSkin = {
  representation: 'candle' | 'bar'
  bodyScale: number
  roundedBodies: boolean
}

const CHART_SKINS: Record<ChartFamily, ChartSkin> = {
  candle: { representation: 'candle', bodyScale: 0.62, roundedBodies: false },
  bar: { representation: 'bar', bodyScale: 0.72, roundedBodies: false },
}

export const chartSkin = (family: ChartFamily): ChartSkin => CHART_SKINS[family]

// ---------------------------------------------------------------------------
// shared card bits

const rowLabel = { color: MUTED, fontSize: 17, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' } as const

const centered = (top: number): React.CSSProperties => ({
  position: 'absolute',
  top,
  left: 0,
  right: 0,
  textAlign: 'center',
})

const kickerRow = (top: number): React.CSSProperties => ({
  ...centered(top),
  display: 'flex',
  justifyContent: 'center',
})

const monoText = (fontSize: number, weight = 500): React.CSSProperties => ({
  fontFamily: MONO_STACK,
  fontSize,
  fontWeight: weight,
  color: MUTED,
})

// "LONG · 10X" pill copy
const sideTag = (trade: Trade): string =>
  sideLabel(trade.side) + (trade.leverage != null ? ` · ${trade.leverage}X` : '')

// "LONG · 10X · HOLD 8H 37M" trailing meta line
const metaLine = (trade: Trade): string | null => {
  const parts = [sideTag(trade), holdDuration(trade)].filter(Boolean)
  return parts.length ? parts.join(' · ').toUpperCase() : null
}

// "HOLD 8H 37M TO HIT TAKE PROFIT" note (suffix only on a TP exit)
const holdNote = (trade: Trade): string | null => {
  const hold = holdDuration(trade)
  if (!hold) return null
  return `HOLD ${hold}${trade.reason === 'TP_HIT' ? ' TO HIT TAKE PROFIT' : ''}`
}

// horizontal rule with an arrowhead that draws left to right
const ArrowRule: React.FC<{ delay: number; width: number; marginTop?: number }> = ({ delay, width, marginTop = 0 }) => {
  const frame = useCurrentFrame()
  const grow = interpolate(frame, [delay, delay + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })
  const head = interpolate(frame, [delay + 9, delay + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <div style={{ width: width * grow, height: 4, background: INK, position: 'relative', flex: 'none', marginTop }}>
      <span
        style={{
          position: 'absolute',
          right: -2,
          top: -11,
          width: 0,
          height: 0,
          borderLeft: `22px solid ${INK}`,
          borderTop: '13px solid transparent',
          borderBottom: '13px solid transparent',
          opacity: head,
        }}
      />
    </div>
  )
}

// vertical line + triangle that grows downward
const DownArrow: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame()
  const height = interpolate(frame, [delay, delay + 10], [0, 55], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })
  const tri = interpolate(frame, [delay + 8, delay + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 4, height, background: ORANGE }} />
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: '24px solid transparent',
          borderRight: '24px solid transparent',
          borderTop: `26px solid ${ORANGE}`,
          opacity: tri,
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// intro variants (INTRO_FRAMES long) — ports of the stage-concepts-3 frames

// Intro 1 — one line: symbol and pill up top, entry and exit side by side
// with an arrow between, plain background
const IntroOneline: React.FC<{ trade: Trade }> = ({ trade }) => {
  const note = holdNote(trade)
  return (
    <AbsoluteFill>
      <div style={kickerRow(500)}>
        <SlideIn delay={2} y={24}>
          <MicroLabel bullet={false}>TRADE REPLAY · {fmtDate(trade.filled_at)}</MicroLabel>
        </SlideIn>
      </div>
      <div style={centered(586)}>
        <SlideIn delay={8} y={30}>
          <SymbolHero symbol={trade.symbol} fontSize={132} uppercase={false} />
        </SlideIn>
      </div>
      <div style={{ ...centered(770), display: 'flex', justifyContent: 'center' }}>
        <SlideIn delay={14}>
          <SidePill>{sideTag(trade)}</SidePill>
        </SlideIn>
      </div>
      <div style={{ position: 'absolute', top: 880, left: 70, right: 70, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 46 }}>
        <SlideIn delay={20} y={26}>
          <div style={{ width: 360, textAlign: 'center' }}>
            <div style={{ color: MUTED, fontSize: 18, fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase' }}>ENTRY</div>
            <div style={{ fontSize: 74, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 16 }}>{fmtPrice(trade.entry)}</div>
            <div style={{ ...monoText(20), marginTop: 14 }}>{fmtLocalTime(trade.filled_at)}</div>
          </div>
        </SlideIn>
        <ArrowRule delay={24} width={120} marginTop={82} />
        <SlideIn delay={26} y={26}>
          <div style={{ width: 360, textAlign: 'center' }}>
            <div style={{ color: MUTED, fontSize: 18, fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase' }}>EXIT</div>
            <div style={{ fontSize: 74, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 16, color: ORANGE }}>{fmtPrice(trade.close)}</div>
            <div style={{ ...monoText(20), marginTop: 14 }}>{fmtLocalTime(trade.closed_at)}</div>
          </div>
        </SlideIn>
      </div>
      {note ? (
        <div style={{ ...centered(1100), color: MUTED, fontSize: 22, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          <SlideIn delay={34} y={20}>
            {note}
          </SlideIn>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

// Intro 3 — entry over exit: entry stacked over exit with the side word as a
// mid-frame watermark behind the arrow, one glow under the exit number
const IntroStacked: React.FC<{ trade: Trade }> = ({ trade }) => {
  const meta = metaLine(trade)
  const lbl = { color: MUTED, fontSize: 21, fontWeight: 600, letterSpacing: '0.3em' } as const
  const num = { fontSize: 120, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 } as const
  return (
    <AbsoluteFill>
      <FadeIn delay={16}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 930,
            width: 940,
            height: 560,
            transform: 'translateX(-50%)',
            background: 'radial-gradient(closest-side, rgba(255,90,0,0.15), rgba(255,90,0,0.05) 48%, transparent 72%)',
          }}
        />
      </FadeIn>
      <FadeIn delay={2}>
        <div
          style={{
            position: 'absolute',
            top: 860,
            left: -20,
            right: -20,
            fontSize: 200,
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            color: 'rgba(255,90,0,0.16)',
            textAlign: 'center',
          }}
        >
          {sideLabel(trade.side)}
        </div>
      </FadeIn>
      <div style={kickerRow(430)}>
        <SlideIn delay={6} y={24}>
          <MicroLabel bullet={false}>TRADE REPLAY · {fmtDate(trade.filled_at)}</MicroLabel>
        </SlideIn>
      </div>
      <div style={centered(516)}>
        <SlideIn delay={12} y={30}>
          <SymbolHero symbol={trade.symbol} fontSize={132} uppercase={false} />
        </SlideIn>
      </div>
      <div style={centered(700)}>
        <SlideIn delay={18} y={18}>
          <div style={lbl}>ENTRY</div>
        </SlideIn>
      </div>
      <div style={centered(744)}>
        <SlideIn delay={20} y={22}>
          <div style={num}>{fmtPrice(trade.entry)}</div>
        </SlideIn>
      </div>
      <div style={centered(880)}>
        <SlideIn delay={24} y={16}>
          <div style={monoText(20)}>{fmtLocalTime(trade.filled_at)}</div>
        </SlideIn>
      </div>
      <div style={{ position: 'absolute', top: 935, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <DownArrow delay={28} />
      </div>
      <div style={centered(1075)}>
        <SlideIn delay={32} y={18}>
          <div style={lbl}>EXIT</div>
        </SlideIn>
      </div>
      <div style={centered(1119)}>
        <SlideIn delay={34} y={22}>
          <div style={{ ...num, color: ORANGE }}>{fmtPrice(trade.close)}</div>
        </SlideIn>
      </div>
      <div style={centered(1250)}>
        <SlideIn delay={38} y={16}>
          <div style={monoText(20)}>{fmtLocalTime(trade.closed_at)}</div>
        </SlideIn>
      </div>
      {meta ? (
        <div style={centered(1345)}>
          <SlideIn delay={44} y={18}>
            <div style={{ ...monoText(22, 600), letterSpacing: '0.14em' }}>{meta}</div>
          </SlideIn>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

// Classic intro on the ambient brand canvas: centered symbol, entry and exit
// columns, pill and hold note under
const IntroClassic: React.FC<{ trade: Trade }> = ({ trade }) => {
  const note = holdNote(trade)
  return (
    <AbsoluteFill>
      <BrandCanvas />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', paddingBottom: 300 }}>
        <SlideIn delay={2}>
          <MicroLabel bullet={false}>TRADE REPLAY · {fmtDate(trade.filled_at)}</MicroLabel>
        </SlideIn>
        <SlideIn delay={10} y={30}>
          <div style={{ marginTop: 60 }}>
            <SymbolHero symbol={trade.symbol} fontSize={140} />
          </div>
        </SlideIn>
        <SlideIn delay={20} y={26}>
          <div style={{ marginTop: 60, display: 'flex', gap: 150 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={rowLabel}>Entry</div>
              <div style={{ fontSize: 56, fontWeight: 800, marginTop: 12 }}>{fmtPrice(trade.entry)}</div>
              <div style={{ color: MUTED, fontSize: 22, fontWeight: 600, marginTop: 10 }}>{fmtLocalTime(trade.filled_at)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={rowLabel}>Exit</div>
              <div style={{ fontSize: 56, fontWeight: 800, marginTop: 12, color: ORANGE }}>{fmtPrice(trade.close)}</div>
              <div style={{ color: MUTED, fontSize: 22, fontWeight: 600, marginTop: 10 }}>{fmtLocalTime(trade.closed_at)}</div>
            </div>
          </div>
        </SlideIn>
        <SlideIn delay={30}>
          <div style={{ marginTop: 48 }}>
            <SidePill>{sideTag(trade)}</SidePill>
          </div>
        </SlideIn>
        {note ? (
          <SlideIn delay={38} y={20}>
            <div style={{ marginTop: 100, color: MUTED, fontSize: 22, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{note}</div>
          </SlideIn>
        ) : null}
      </div>
    </AbsoluteFill>
  )
}

// Big side: giant side-word watermark behind the symbol, plain entry and exit
// numbers with an arrow between, in and out times under, on the brand canvas
const IntroBigSide: React.FC<{ trade: Trade }> = ({ trade }) => {
  const meta = metaLine(trade)
  return (
    <AbsoluteFill>
      <BrandCanvas />
      <FadeIn delay={2}>
        <div
          style={{
            position: 'absolute',
            top: 400,
            left: -20,
            right: -20,
            fontSize: 200,
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            color: 'rgba(255,90,0,0.16)',
            textAlign: 'center',
          }}
        >
          {sideLabel(trade.side)}
        </div>
      </FadeIn>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <SlideIn delay={6}>
          <div style={{ marginBottom: 60 }}>
            <MicroLabel bullet={false}>TRADE REPLAY · {fmtDate(trade.filled_at)}</MicroLabel>
          </div>
        </SlideIn>
        <SlideIn delay={14} y={30}>
          <SymbolHero symbol={trade.symbol} fontSize={150} />
        </SlideIn>
        <SlideIn delay={24} y={22}>
          <div style={{ marginTop: 44, display: 'flex', alignItems: 'center', gap: 30, fontSize: 68, fontWeight: 900, letterSpacing: '-0.02em' }}>
            <span>{fmtPrice(trade.entry)}</span>
            <ArrowRule delay={28} width={96} />
            <span style={{ color: ORANGE }}>{fmtPrice(trade.close)}</span>
          </div>
        </SlideIn>
        <SlideIn delay={34} y={18}>
          <div style={{ marginTop: 46, display: 'flex', gap: 120, color: MUTED, fontSize: 21, fontWeight: 600, letterSpacing: '0.14em' }}>
            <span>IN {fmtLocalTime(trade.filled_at)}</span>
            <span>OUT {fmtLocalTime(trade.closed_at)}</span>
          </div>
        </SlideIn>
        {meta ? (
          <SlideIn delay={42} y={18}>
            <div style={{ marginTop: 100, ...monoText(22, 600), letterSpacing: '0.14em' }}>{meta}</div>
          </SlideIn>
        ) : null}
      </div>
    </AbsoluteFill>
  )
}

const INTRO_VARIANTS: Record<IntroFamily, React.FC<{ trade: Trade }>> = {
  oneline: IntroOneline,
  stacked: IntroStacked,
  classic: IntroClassic,
  bigside: IntroBigSide,
}

export const IntroSection: React.FC<{ family: IntroFamily; trade: Trade }> = ({ family, trade }) => {
  const Variant = INTRO_VARIANTS[family] ?? IntroClassic
  return <Variant trade={trade} />
}

// ---------------------------------------------------------------------------
// result / PnL card variants (RESULT_FRAMES long)

// counter: 0 -> value with an ease-out, so big numbers land instead of popping
const useCountUp = (to: number, delay: number, duration = 28): number => {
  const frame = useCurrentFrame()
  if (to <= 0) return 0
  return interpolate(frame, [delay, delay + duration], [0, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })
}

const pctOf = (trade: Trade) => Math.abs(trade.pnl_pct ?? 0)
const rOf = (trade: Trade) => trade.pnl_r
const pctSign = (trade: Trade) => ((trade.pnl_pct ?? 0) > 0 ? '+' : '')

// Result 1 — split duo: account percent and R multiple in two halves split by
// a gray rule, leverage under, plain background
const ResultDuo: React.FC<{ trade: Trade }> = ({ trade }) => {
  const note = holdNote(trade)
  const pctCount = useCountUp(pctOf(trade), 10)
  const rCount = useCountUp(Math.abs(rOf(trade) ?? 0), 18)
  const half = (label: string, sign: string, value: string, unit: string) => (
    <div style={{ flex: 1, padding: '56px 0' }}>
      <div style={{ color: MUTED, fontSize: 19, fontWeight: 600, letterSpacing: '0.24em' }}>{label}</div>
      <div style={{ fontSize: 106, fontWeight: 900, letterSpacing: '-0.04em', marginTop: 24, lineHeight: 1 }}>
        <span style={{ color: ORANGE }}>{sign}</span>
        {value}
        <span style={{ color: ORANGE }}>{unit}</span>
      </div>
    </div>
  )
  return (
    <AbsoluteFill>
      <div style={kickerRow(574)}>
        <SlideIn delay={4} y={24}>
          <MicroLabel bullet={false}>RESULT · {reasonLabel(trade.reason)}</MicroLabel>
        </SlideIn>
      </div>
      <div style={{ position: 'absolute', top: 660, left: 90, right: 90, display: 'flex', textAlign: 'center' }}>
        <SlideIn delay={10} y={26} style={{ flex: 1 }}>
          {half('ON ACCOUNT', pctSign(trade), pctCount.toFixed(2), '%')}
        </SlideIn>
        <SlideIn delay={18} y={26} style={{ display: 'flex', flex: 1 }}>
          <div style={{ width: 8, height: 200, alignSelf: 'center', background: RULE, flex: 'none' }} />
          {half('RISK - REWARD', '+', rCount.toFixed(2), 'R')}
        </SlideIn>
      </div>
      {trade.leverage != null ? (
        <div style={centered(980)}>
          <SlideIn delay={26} y={20}>
            <div style={{ color: MUTED, fontSize: 18, fontWeight: 600, letterSpacing: '0.22em' }}>LEVERAGE</div>
            <div style={{ fontSize: 54, fontWeight: 800, marginTop: 12 }}>{trade.leverage}X</div>
          </SlideIn>
        </div>
      ) : null}
      {note ? (
        <div style={centered(1160)}>
          <SlideIn delay={34} y={18}>
            <div style={{ ...monoText(22, 600), letterSpacing: '0.12em' }}>{note}</div>
          </SlideIn>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

// Result 3 — stacked heroes: R multiple stacked over account percent as giant
// numbers with orange signs, gray rule between, plain background
const ResultStacked: React.FC<{ trade: Trade }> = ({ trade }) => {
  const frame = useCurrentFrame()
  const note = holdNote(trade)
  const r = Math.abs(rOf(trade) ?? 0)
  const rCount = useCountUp(r, 8)
  const pctCount = useCountUp(pctOf(trade), 34)
  const rule = interpolate(frame, [24, 50], [0, 640], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const lbl = { color: MUTED, fontSize: 20, fontWeight: 600, letterSpacing: '0.22em' } as const
  return (
    <AbsoluteFill>
      <div style={kickerRow(470)}>
        <SlideIn delay={2} y={24}>
          <MicroLabel bullet={false}>RESULT · {reasonLabel(trade.reason)}</MicroLabel>
        </SlideIn>
      </div>
      <div style={centered(555)}>
        <FadeIn delay={8}>
          <div style={{ fontSize: 150, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 }}>
            <span style={{ color: ORANGE }}>+</span>
            {rCount.toFixed(2)}
            <span style={{ color: ORANGE }}>R</span>
          </div>
        </FadeIn>
      </div>
      <div style={centered(735)}>
        <SlideIn delay={30} y={16}>
          <div style={lbl}>RISK - REWARD</div>
        </SlideIn>
      </div>
      <div style={{ position: 'absolute', top: 795, left: '50%', transform: 'translateX(-50%)', width: rule, height: 8, background: RULE }} />
      <div style={centered(860)}>
        <FadeIn delay={34}>
          <div style={{ fontSize: 150, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1 }}>
            <span style={{ color: ORANGE }}>{pctSign(trade)}</span>
            {pctCount.toFixed(2)}
            <span style={{ color: ORANGE }}>%</span>
          </div>
        </FadeIn>
      </div>
      <div style={centered(1040)}>
        <SlideIn delay={40} y={16}>
          <div style={lbl}>ON THE ACCOUNT</div>
        </SlideIn>
      </div>
      {trade.leverage != null ? (
        <div style={centered(1120)}>
          <SlideIn delay={46} y={18}>
            <div style={{ fontSize: 54, fontWeight: 800 }}>{trade.leverage}X</div>
            <div style={{ ...lbl, fontSize: 18, letterSpacing: '0.22em', marginTop: 10 }}>LEVERAGE</div>
          </SlideIn>
        </div>
      ) : null}
      {note ? (
        <div style={centered(1330)}>
          <SlideIn delay={52} y={18}>
            <div style={{ ...monoText(22, 600), letterSpacing: '0.14em' }}>{note}</div>
          </SlideIn>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

// Classic result on the brand canvas: giant account percent with orange
// signs, risk-reward and leverage underneath
const ResultClassic: React.FC<{ trade: Trade }> = ({ trade }) => {
  const pctCount = useCountUp(pctOf(trade), 8)
  const rCount = useCountUp(Math.abs(rOf(trade) ?? 0), 40)
  return (
    <AbsoluteFill>
      <BrandCanvas />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', paddingBottom: 140 }}>
        <SlideIn delay={4}>
          <MicroLabel bullet={false}>RESULT · {reasonLabel(trade.reason)}</MicroLabel>
        </SlideIn>
        <FadeIn delay={8}>
          {/* translateX re-centers the ink, which letter-spacing pushes right */}
          <div style={{ marginTop: 60, fontSize: 200, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, display: 'flex', justifyContent: 'center', transform: 'translateX(-0.025em)' }}>
            <span style={{ color: ORANGE }}>{pctSign(trade)}</span>
            {pctCount.toFixed(2)}
            <span style={{ color: ORANGE }}>%</span>
          </div>
        </FadeIn>
        <SlideIn delay={20} y={20}>
          <div style={{ marginTop: 22, color: MUTED, fontSize: 24, fontWeight: 500 }}>ON THE ACCOUNT</div>
        </SlideIn>
        <SlideIn delay={40}>
          <div style={{ marginTop: 52, display: 'flex', gap: 110 }}>
            {rOf(trade) != null ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 52, fontWeight: 800 }}>
                  +{rCount.toFixed(2)}
                  <span style={{ color: ORANGE }}>R</span>
                </div>
                <div style={{ ...rowLabel, marginTop: 10 }}>Risk - Reward</div>
              </div>
            ) : null}
            {trade.leverage != null ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 52, fontWeight: 800 }}>{trade.leverage}x</div>
                <div style={{ ...rowLabel, marginTop: 10 }}>Leverage</div>
              </div>
            ) : null}
          </div>
        </SlideIn>
      </div>
    </AbsoluteFill>
  )
}

// Hero R on the brand canvas: giant R multiple count-up over a gray rule,
// account percent and leverage below
const ResultHeroR: React.FC<{ trade: Trade }> = ({ trade }) => {
  const frame = useCurrentFrame()
  const r = Math.abs(rOf(trade) ?? 0)
  const rCount = useCountUp(r, 10, 30)
  const pctCount = useCountUp(pctOf(trade), r > 0 ? 44 : 8)
  const rule = interpolate(frame, [16, 44], [0, 640], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  return (
    <AbsoluteFill>
      <BrandCanvas />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', paddingBottom: 140 }}>
        <SlideIn delay={2}>
          <MicroLabel bullet={false}>RESULT · {reasonLabel(trade.reason)}</MicroLabel>
        </SlideIn>
        <FadeIn delay={8}>
          <div style={{ marginTop: 60, fontSize: 200, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1, display: 'flex', justifyContent: 'center', transform: 'translateX(-0.03em)' }}>
            <span style={{ color: ORANGE }}>+</span>
            <span>{r > 0 ? rCount.toFixed(1) : pctCount.toFixed(1)}</span>
            <span style={{ color: ORANGE }}>{r > 0 ? 'R' : '%'}</span>
          </div>
        </FadeIn>
        <div style={{ marginTop: 26, height: 8, width: rule, background: RULE }} />
        <SlideIn delay={44}>
          <div style={{ marginTop: 44, display: 'flex', gap: 110 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 54, fontWeight: 800, color: ORANGE }}>
                {pctSign(trade)}
                {pctCount.toFixed(2)}%
              </div>
              <div style={{ ...rowLabel, marginTop: 8 }}>On account</div>
            </div>
            {trade.leverage != null ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 54, fontWeight: 800 }}>{trade.leverage}x</div>
                <div style={{ ...rowLabel, marginTop: 8 }}>Leverage</div>
              </div>
            ) : null}
          </div>
        </SlideIn>
      </div>
    </AbsoluteFill>
  )
}

const RESULT_VARIANTS: Record<ResultFamily, React.FC<{ trade: Trade }>> = {
  duo: ResultDuo,
  stacked: ResultStacked,
  classic: ResultClassic,
  heror: ResultHeroR,
}

export const ResultSection: React.FC<{ family: ResultFamily; trade: Trade }> = ({ family, trade }) => {
  const Variant = RESULT_VARIANTS[family] ?? ResultClassic
  return <Variant trade={trade} />
}
