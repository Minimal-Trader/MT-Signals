import React, { useMemo } from 'react'
import { AbsoluteFill, spring, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadFont as loadInter } from '@remotion/google-fonts/Inter'
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono'
import type { Trade } from '../src/schema'

const inter = loadInter('normal', {
  weights: ['400', '500', '600', '800', '900'],
  subsets: ['latin'],
})
const jetBrainsMono = loadJetBrainsMono('normal', {
  weights: ['500', '700'],
  subsets: ['latin'],
})

// Brand tokens from MT-Designs (social post + story templates)
export const BG = '#ffffff'
export const INK = '#111827'
export const MUTED = '#6b7280'
export const ORANGE = '#ff5a00'
export const HAIRLINE = 'rgba(17,24,39,0.14)'
export const RULE = '#d1d5db'
export const FONT_STACK = `${inter.fontFamily}, "Segoe UI", "Helvetica Neue", Arial, sans-serif`
export const MONO_STACK = `${jetBrainsMono.fontFamily}, "JetBrains Mono", monospace`

export function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// djb2, matching the per-trade rotation in scripts/voiceover.mjs
export const hash32 = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// "BTCUSDT" -> "BTC/USDT" for display (known quote assets)
export function displaySymbol(symbol: string): string {
  const m = symbol.replace('/', '').toUpperCase().match(/^(.+?)(USDT|USDC|FDUSD|TUSD|BUSD|BTC|ETH|BNB)$/)
  return m ? `${m[1]}/${m[2]}` : symbol.toUpperCase()
}

// Same split as displaySymbol, but as [base, "/quote"]: the base renders in
// orange and the quote in ink on the big hero symbols (stage-concepts-3)
export function splitSymbol(symbol: string): [string, string] {
  const m = symbol.replace('/', '').toUpperCase().match(/^(.+?)(USDT|USDC|FDUSD|TUSD|BUSD|BTC|ETH|BNB)$/)
  return m ? [m[1], `/${m[2]}`] : [symbol.toUpperCase(), '']
}

// "Sep 29, 2026" from a dashboard-local timestamp (kicker date)
export function fmtDate(value?: string | null): string {
  if (!value) return '-'
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(value)
  const d = new Date(hasTz ? value : `${value}Z`)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
}

// "8H 37M" between fill and close ("2D 5H" once days matter); null when the
// trade has no usable timestamps
export function holdDuration(trade: Trade): string | null {
  if (!trade.filled_at || !trade.closed_at) return null
  const parse = (v: string) => {
    const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(v)
    const t = Date.parse(hasTz ? v : `${v}Z`)
    return Number.isFinite(t) ? t : null
  }
  const start = parse(String(trade.filled_at))
  const end = parse(String(trade.closed_at))
  if (start == null || end == null || end <= start) return null
  const minutes = Math.round((end - start) / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}D ${hours}H`
  if (hours > 0) return `${hours}H ${mins}M`
  return `${mins}M`
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '-'
  // 6 significant digits: 64000 -> 64,000, 0.1634567 -> 0.163457
  return n.toLocaleString('en-US', { maximumSignificantDigits: 6 })
}

// Dashboard-local wall-clock time ("Sep 30, 12:00 PM"). Naive strings are
// already local; tz-aware ones print in UTC.
export function fmtLocalTime(value?: string | null): string {
  if (!value) return '-'
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(value)
  const d = new Date(hasTz ? value : `${value}Z`)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// MT wordmark: ink mark + orange square (from the MT-Designs templates)
export const BrandMark: React.FC<{ width: number }> = ({ width }) => (
  <svg viewBox="0 0 976 432.54" style={{ width, height: 'auto', display: 'block' }}>
    <path
      fill={INK}
      d="M0,432.54V0h158.6l115.34,288.36L389.29,0h158.6v432.54h-115.34V144.18l-115.34,288.36h-86.51L115.34,144.18v288.36H0Z"
    />
    <path
      fill={INK}
      d="M557.88,0h360.45v115.34h-122.55v317.2h-115.34V115.34h-122.55V0Z"
    />
    <rect fill={ORANGE} x="860.66" y="317.2" width="115.34" height="115.34" />
  </svg>
)

// Letterspaced micro label with the square bullet (template .agent / .period)
export const MicroLabel: React.FC<{
  children: React.ReactNode
  color?: string
  bullet?: boolean
}> = ({ children, color = ORANGE, bullet = true }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      color,
      fontSize: 21,
      fontWeight: 600,
      letterSpacing: '0.22em',
      textTransform: 'uppercase',
    }}
  >
    {bullet ? <span style={{ width: 12, height: 12, background: ORANGE }} /> : null}
    {children}
  </div>
)

// Hero pair symbol: orange base, ink "/quote" at the same size (stage-concepts-3)
export const SymbolHero: React.FC<{ symbol: string; fontSize: number; uppercase?: boolean }> = ({
  symbol,
  fontSize,
  uppercase = true,
}) => {
  const [base, quote] = splitSymbol(symbol)
  return (
    <div
      style={{
        fontSize,
        fontWeight: 900,
        letterSpacing: '-0.04em',
        lineHeight: 1,
        color: ORANGE,
        whiteSpace: 'nowrap',
        ...(uppercase ? { textTransform: 'uppercase' } : {}),
      }}
    >
      {base}
      {quote ? <span style={{ color: INK }}>{quote}</span> : null}
    </div>
  )
}

export const SlideIn: React.FC<{
  delay: number
  children: React.ReactNode
  y?: number
  style?: React.CSSProperties
}> = ({ delay, children, y = 36, style }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.8 } })
  return (
    <div
      style={{
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [y, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// Plain opacity fade, no movement (hero numbers)
export const FadeIn: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0,
  children,
  style,
}) => {
  const frame = useCurrentFrame()
  return (
    <div
      style={{
        opacity: interpolate(frame, [delay, delay + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// Deterministic star specks (template .stars): mostly ink, a few orange
const Stars: React.FC = () => {
  const stars = useMemo(() => {
    const rnd = mulberry32(11)
    return Array.from({ length: 70 }, () => {
      const orange = rnd() < 0.14
      return {
        orange,
        size: 1 + rnd() * 1.5,
        left: rnd() * 1080,
        top: rnd() * 1920,
        opacity: orange ? 0.3 + rnd() * 0.32 : 0.08 + rnd() * 0.24,
      }
    })
  }, [])
  return (
    <AbsoluteFill>
      {stars.map((s, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            borderRadius: '50%',
            background: s.orange ? ORANGE : INK,
            width: s.size,
            height: s.size,
            left: s.left,
            top: s.top,
            opacity: s.opacity,
          }}
        />
      ))}
    </AbsoluteFill>
  )
}

// Ambient brand background: gridlines, glow, stars, shooting lines, base curve
export const BrandCanvas: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(rgba(255,90,0,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(255,90,0,.09) 1px, transparent 1px)`,
        backgroundSize: '108px 108px',
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '46%',
        width: 1080,
        height: 1080,
        transform: 'translate(-50%,-50%)',
        background: `radial-gradient(closest-side, rgba(255,90,0,.13), rgba(255,90,0,.04) 46%, transparent 72%)`,
      }}
    />
    <Stars />
    <div
      style={{
        position: 'absolute',
        height: 1,
        width: 170,
        transform: 'rotate(-32deg)',
        left: 130,
        top: 420,
        background: `linear-gradient(90deg, transparent, rgba(255,90,0,.55))`,
      }}
    />
    <div
      style={{
        position: 'absolute',
        height: 1,
        width: 170,
        transform: 'rotate(-32deg)',
        right: 140,
        top: 700,
        background: `linear-gradient(90deg, transparent, rgba(17,24,39,.45))`,
      }}
    />
  </AbsoluteFill>
)

// ---------------------------------------------------------------------------
// Generated footer wave (stage-concepts-3): one random walk per trade, always
// ending above where it started, rendered as a smooth line. Ported 1:1 from
// the concept's canvas script.

type Pt = [number, number]

// random walk in the band y 38-212, last point forced above the first
function wavePoints(seed: number): Pt[] {
  const rnd = mulberry32(((seed * 2654435761) >>> 0) || 1)
  const n = 11 + Math.floor(rnd() * 7)
  const ys: number[] = []
  let y = 168 + rnd() * 26
  for (let i = 0; i < n; i++) {
    ys.push(y)
    y += rnd() * 58 - 27
    y = Math.min(212, Math.max(38, y))
  }
  ys[n - 1] = Math.max(30, ys[0]! - 28 - rnd() * 46)
  return ys.map((v, i) => [-10 + (1100 / (n - 1)) * i, v])
}

// Catmull-Rom style smoothing through the points
function smoothPath(p: Pt[]): string {
  let d = `M ${p[0]![0]},${p[0]![1]}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!
    const p1 = p[i]!
    const p2 = p[i + 1]!
    const p3 = p[i + 2] ?? p2
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }
  return d
}

export const WaveFooter: React.FC<{ seed: string }> = ({ seed }) => {
  const numeric = useMemo(() => hash32(seed), [seed])
  const d = useMemo(() => smoothPath(wavePoints(numeric)), [numeric])
  return (
    <svg
      viewBox="0 0 1080 260"
      style={{ position: 'absolute', left: 0, bottom: 0, width: 1080, height: 260, display: 'block' }}
    >
      <defs>
        <linearGradient id="waveStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={ORANGE} stopOpacity="0" />
          <stop offset=".14" stopColor={ORANGE} stopOpacity=".55" />
          <stop offset=".85" stopColor={ORANGE} stopOpacity=".9" />
          <stop offset="1" stopColor={ORANGE} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="waveArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ORANGE} stopOpacity=".16" />
          <stop offset="1" stopColor={ORANGE} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L 1090,260 L -10,260 Z`} fill="url(#waveArea)" />
      <path d={d} fill="none" stroke="url(#waveStroke)" strokeWidth={4} />
    </svg>
  )
}

// Persistent frame: content first, then the generated wave footer and the
// header chrome painted above it (nothing but the site link ever sits in the
// wave band; the brand outro renders as a sibling ABOVE this whole frame)
export const Frame: React.FC<{ trade: Trade; children: React.ReactNode }> = ({ trade, children }) => (
  <AbsoluteFill style={{ fontFamily: FONT_STACK, color: INK, background: BG }}>
    {children}
    <WaveFooter seed={trade.trade_id || trade.symbol || 'x'} />
    <div style={{ position: 'absolute', top: 96, left: 90, right: 90, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 }}>
      <BrandMark width={110} />
      <MicroLabel>{(trade.bot_name || 'MT').toUpperCase()} · AGENT</MicroLabel>
    </div>
    <div style={{ position: 'absolute', top: 235, left: 90, right: 90, borderTop: `1px solid ${HAIRLINE}` }} />
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 200,
        textAlign: 'center',
        color: MUTED,
        fontSize: 19,
        fontWeight: 600,
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        zIndex: 5,
      }}
    >
      minimaltrader.live
    </div>
  </AbsoluteFill>
)

// Hairline stat row (template .rows): label above bold value
export const StatCell: React.FC<{
  label: string
  value: string
  accent?: boolean
  border?: boolean
}> = ({ label, value, accent, border }) => (
  <div
    style={{
      flex: 1,
      paddingTop: 34,
      ...(border ? { borderLeft: `1px solid ${HAIRLINE}`, paddingLeft: 40 } : {}),
    }}
  >
    <div style={{ color: MUTED, fontSize: 18, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
      {label}
    </div>
    <div style={{ color: accent ? ORANGE : INK, fontSize: 54, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 12 }}>
      {value}
    </div>
  </div>
)

// Orange sharp pill (template .dir .pill)
export const SidePill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      background: ORANGE,
      color: '#fff',
      fontSize: 30,
      fontWeight: 800,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      padding: '14px 36px 15px',
    }}
  >
    {children}
  </span>
)

// "BUY"/"SELL" -> position terms; long/short inputs pass through
export function sideLabel(side?: string | null): string {
  const s = (side || '').toUpperCase()
  if (s.includes('SELL') || s.includes('SHORT')) return 'SHORT'
  if (s.includes('BUY') || s.includes('LONG')) return 'LONG'
  return s || 'LONG'
}

// "GMT+5:30" from minutes east of UTC (props tz_offset_minutes)
export function tzLabel(minutes?: number | null): string {
  if (minutes == null || minutes === 0) return 'UTC'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `GMT${minutes > 0 ? '+' : '-'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

export function reasonLabel(reason?: string | null): string {
  return reason === 'TP_HIT' ? 'TAKE PROFIT' : reason || 'WIN'
}
