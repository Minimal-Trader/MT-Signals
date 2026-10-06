// Render-time boundary: reads the TRADE_JSON env var (the repository_dispatch
// payload written by the workflow), fetches Binance FUTURES candles, picks and
// validates the template against the registry in templates.json, and writes
// props.json for `remotion render`.
//
// Candle data: MT is a futures-only tool, so klines come from the Binance
// futures API (fapi.binance.com). US-hosted GitHub runners are geo-blocked
// (451), so KLINES_PROXY_URL points at the relay on the bot VPS
// (../binance-relay, see its README); direct fapi is tried when unset, and
// the public spot mirror is the last resort. Override the interval with
// INTERVAL (e.g. INTERVAL=15m) to force one.
//
// Template selection:
//   trade.template set  -> that template; if its inputs are missing (e.g. the
//                          kline fetch failed) we warn and fall back to
//                          the first satisfied registry template
//   not set             -> first registry template whose "requires" are all
//                          satisfied (registry order = preference)
import { readFileSync, writeFileSync } from 'node:fs'

const registry = JSON.parse(readFileSync('templates/templates.json', 'utf8'))

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']
const FAPI = 'https://fapi.binance.com/fapi/v1/klines'
// public spot mirror: same kline shape, reachable from US-hosted runners
// where fapi answers 451; futures prices track spot, so it is a last resort
const VISION_SPOT = 'https://data-api.binance.vision/api/v3/klines'
const INTERVAL_MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 }
const CONTEXT_CANDLES = 5
const PAGE_LIMIT = 500
const TRADE_TZ = process.env.TRADE_TZ || 'Asia/Colombo'
const BOT_INTERVAL = '15m' // MT-Bots' working timeframe

const raw = process.env.TRADE_JSON || '{}'
let trade
try {
  trade = JSON.parse(raw)
} catch {
  console.error('TRADE_JSON is not valid JSON:', raw.slice(0, 200))
  process.exit(1)
}

if (process.env.TEMPLATE) trade.template = process.env.TEMPLATE
// the dashboard dispatch omits take_profit: a close in profit IS the TP
if (trade.take_profit == null && trade.close != null && (trade.pnl_pct ?? 0) > 0) {
  trade.take_profit = trade.close
}
if (!trade.klines) trade.klines = await fetchKlines(trade)

// offset the renderer needs to convert the naive filled_at back to UTC
const naiveFillAsUtcMs = trade.filled_at && !/Z|[+-]\d{2}:?\d{2}$/.test(String(trade.filled_at))
  ? Date.parse(`${trade.filled_at}Z`)
  : NaN
trade.tz_offset_minutes = Number.isFinite(naiveFillAsUtcMs) ? tzOffsetMinutes(new Date(naiveFillAsUtcMs)) : 0

function satisfiedField(field) {
  const v = trade[field]
  if (field === 'klines') return Array.isArray(v) && v.length > 2
  return v !== undefined && v !== null
}

let chosen
if (trade.template) {
  const def = registry.find(t => t.id === trade.template)
  if (!def) {
    console.error(`Unknown template "${trade.template}". Known: ${registry.map(t => t.id).join(', ')}`)
    process.exit(1)
  }
  if (def.requires.every(satisfiedField)) {
    chosen = def
  } else {
    console.warn(`Template "${def.id}" requested but its required inputs are missing — falling back to the first satisfied template`)
  }
}
chosen ||= registry.find(t => t.requires.every(satisfiedField))
if (!chosen) {
  console.error('No template in the registry is satisfied by this payload; nothing to render.')
  process.exit(1)
}

// per-section style overrides (STYLE_CHART / STYLE_INTRO / STYLE_RESULT);
// unset sections rotate deterministically from the trade id
// inside the template
const STYLE_ENVS = [
  ['STYLE_CHART', 'chart', ['candle', 'bar']],
  ['STYLE_INTRO', 'intro', ['oneline', 'stacked', 'classic', 'bigside']],
  ['STYLE_RESULT', 'result', ['duo', 'stacked', 'classic', 'heror']],
]
const styles = {}
for (const [envName, key, families] of STYLE_ENVS) {
  const value = process.env[envName]
  if (value) {
    if (!families.includes(value)) {
      console.error(`${envName}: unknown style "${value}" (${families.join(' | ')})`)
      process.exit(1)
    }
    styles[key] = value
  }
}

writeFileSync('props.json', JSON.stringify({ trade, template: chosen.id, ...(Object.keys(styles).length ? { styles } : {}) }, null, 2))
console.log(`template=${chosen.id} for ${trade.symbol ?? 'unknown symbol'}${Array.isArray(trade.klines) ? ` (${trade.klines.length} candles)` : ''}`)

// Binance FUTURES klines over the trade window: every true candle, fetched in
// paginated 500-candle pages (500/request, then resume from the last candle
// until the window is covered — nothing is merged or dropped). Returns null
// on any failure.
async function fetchKlines(trade) {
  try {
    if (!trade.symbol || !trade.filled_at || !trade.closed_at) return null
    const symbol = String(trade.symbol).replace(/\//g, '').toUpperCase()
    const start = toUtcMs(trade.filled_at)
    const end = toUtcMs(trade.closed_at)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null

    const interval = process.env.INTERVAL && INTERVALS.includes(process.env.INTERVAL)
      ? process.env.INTERVAL
      : BOT_INTERVAL
    // exactly CONTEXT_CANDLES of context before the entry candle, none after
    // the exit — the replay starts just before the signal and plays the trade
    const fetchStart = start - CONTEXT_CANDLES * INTERVAL_MS[interval]

    // source chain: the dashboard proxy when configured (exact futures
    // candles for geo-blocked runners), then direct fapi, then the public
    // spot mirror (1000-prefixed perps have no spot pair and are skipped)
    const sources = []
    if (process.env.KLINES_PROXY_URL) sources.push(process.env.KLINES_PROXY_URL)
    sources.push(FAPI)
    if (!/^1000/.test(symbol)) sources.push(VISION_SPOT)

    for (const source of sources) {
      try {
        const rows = await fetchAllPages(source, symbol, interval, fetchStart, end)
        if (rows && rows.length >= 3) {
          console.log(`klines: ${rows.length} x ${interval} from ${source}`)
          return rows
        }
        console.warn(`Kline fetch from ${source} returned no usable candles`)
      } catch (error) {
        console.warn(`Kline fetch failed from ${source}: ${error?.message ?? error}`)
      }
    }
    return null
  } catch (error) {
    console.warn(`Kline fetch failed: ${error?.message ?? error}`)
    return null
  }
}

// paginated fetch: PAGE_LIMIT candles per request, resuming from the last
// candle's open time until the window is fully covered
async function fetchAllPages(source, symbol, interval, fetchStart, end) {
  const rows = []
  let cursor = fetchStart
  while (cursor < end) {
    const query = `symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${end}&limit=${PAGE_LIMIT}`
    const response = await fetch(`${source}?${query}`)
    if (!response.ok) {
      throw new Error(`${source} responded ${response.status} (page at ${new Date(cursor).toISOString()})`)
    }
    const page = await response.json()
    if (!Array.isArray(page) || page.length === 0) break
    for (const k of page) {
      const row = [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4])]
      if (!rows.length || row[0] > rows[rows.length - 1][0]) rows.push(row)
    }
    if (page.length < PAGE_LIMIT) break
    cursor = rows[rows.length - 1][0] + 1
  }
  // keep only candles inside the window (drop a trailing in-progress candle)
  return rows.filter(r => r[0] >= fetchStart && r[0] <= end)
}

// UTC offset of TRADE_TZ at this instant: utc = local - offset
function tzOffsetMinutes(instant) {
  const parts = {}
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: TRADE_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)) parts[p.type] = p.value
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return Math.round((asUtc - instant.getTime()) / 60_000)
}

function toUtcMs(value) {
  const v = String(value)
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(v)
  const parsed = Date.parse(hasTz ? v : `${v}Z`)
  return hasTz || !Number.isFinite(parsed) ? parsed : parsed - tzOffsetMinutes(new Date(parsed)) * 60_000
}
