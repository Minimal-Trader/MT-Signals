// Voiceover pipeline, run between build-props and remotion render:
//   props.json -> narrative stats from the trade -> LLM script (validated,
//   static copy as fallback) -> TTS down a provider chain -> public/voiceover.*
//   + measured duration -> props.json augmented with voiceover + music.
//
// The voice rotates per trade (deterministic on trade_id, so the same trade
// always renders identically) across a pool of calm prebuilt voices.
//
// Google only. Keys are tried in order — GEMINI_API_KEY, then
// GEMINI_API_KEY_2, GEMINI_API_KEY_3, ... as many as you set — for both the
// copy (Gemini's OpenAI-shaped chat endpoint) and the TTS (native
// generateContent down the free TTS models; quotas are per model). When every
// key fails, the copy falls back to the static variants and the voice to
// edge-tts (keyless Microsoft voices). Without any key at all we warn and
// render silent — never fail.
//
//   VO=skip       force a silent render
//   VO_STATIC=1   skip the LLM, use the built-in copy variants
//   TTS_MODELS    comma list for the TTS chain
//   LLM_MODELS    comma list for the script model chain
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const FPS = 30

// calm register only; lively voices read hype, which is off-brand
const VOICES = ['Charon', 'Sadaltager', 'Erinome', 'Gacrux', 'Despina']
const EDGE_TTS_VOICES = {
  Charon: 'en-US-AndrewNeural',
  Sadaltager: 'en-US-GuyNeural',
  Erinome: 'en-US-AriaNeural',
  Gacrux: 'en-US-JennyNeural',
  Despina: 'en-US-MichelleNeural',
}
const TTS_MODELS = (process.env.TTS_MODELS ||
  'gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-3.8-flash-lite-tts').split(',')
const LLM_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
// copy model chain: tried in order per API key, so an overloaded or
// unavailable model falls through to the next (LLM_MODELS env overrides)
const LLM_MODELS = (process.env.LLM_MODELS ||
  'gemini-flash-latest,gemini-3.5-flash,gemini-flash-lite-latest,gemma-4-31b-it').split(',')

// voiceover word budget scales with the candle count the chart replays:
// a longer window can carry a longer narration (TTS paces ~2.7 words/sec),
// short trades stay at 30-55 words so the chart never freezes long, and the
// caps keep the whole video short-form
function wordBudget(trade) {
  const step = Math.floor((trade.klines?.length ?? 0) / 100)
  return [Math.min(30 + step * 5, 45), Math.min(55 + step * 10, 75)]
}
const BANNED = /guarantee|guaranteed|risk[- ]free|moon|get rich|cannot lose|sure thing|\bbot\b/i

// structural variety: each render gets one angle + one closing line, picked
// deterministically from the trade id, so consecutive wins never sound alike
const ANGLES = [
  'Open with one line on the market before the signal. Name the trade when the entry marks. Cover the dip mid-chart, then the run to target. Land the R and the percent as the result card appears.',
  'Beat by beat on the agent: the signal forms and he enters, the trade turns against him and he holds, the level breaks his way and he exits at target. Close on the R and percent as the result card shows.',
  'Cover, in order: the market before the signal, the level that triggered the entry, the grind through the middle, the tag of target. Finish with the R and percent on the result card.',
  'Name the entry when it marks. Spend the middle on how far the trade went against him before it turned. Then the run to target and the numbers on the result card.',
  'Open with the result in one line, then give entry, dip, and run in chart order, and land the R and percent again as the result card appears.',
]
const CTAS = [
  'Follow along for the next trade.',
  'The next trade is already live. Stick around.',
  'See you on the next trade.',
  'Follow us to see the next trade.',
  'Every win gets posted here. Follow us to stay updated.',
  'One trade at a time. Thats how we like it.',
  'Clean exit, Follow for the next trade.',
]
// ---------------------------------------------------------------------------
// narrative stats: the speakable numbers of the trade, pre-spelled so the
// script never carries a digit; the market block gives the LLM the candles
// themselves so it understands how the trade unfolded

function deriveStats(trade, asset) {
  return {
    agent: speakAgentName(trade.bot_name),
    asset: asset ?? String(trade.symbol ?? '').replace(/(USDT|USD|PERP)$/i, '').toUpperCase(),
    side: /SELL|SHORT/i.test(String(trade.side ?? '')) ? 'short' : 'long',
    leverage: trade.leverage != null ? `${intWords(trade.leverage)} X` : null,
    entry: trade.entry != null ? sayPrice(trade.entry) : null,
    stop: trade.initial_stop != null ? sayPrice(trade.initial_stop) : null,
    target: trade.take_profit != null ? sayPrice(trade.take_profit) : null,
    r: trade.pnl_r != null ? `${sayDecimal(Math.abs(trade.pnl_r))} R` : null,
    accountPct: trade.pnl_pct != null ? `${sayDecimal(Math.abs(trade.pnl_pct))} percent on the account` : null,
    hitTarget: /TP|TARGET/i.test(String(trade.reason ?? '')),
  }
}

// the exact candles the video replays, as compact UTC lines; thinned evenly
// past 600 candles so multi-week windows stay inside the token budget
function marketBlock(trade) {
  const klines = trade.klines ?? []
  if (klines.length < 2) return null
  const stride = Math.max(1, Math.ceil(klines.length / 600))
  const mins = (klines[1][0] - klines[0][0]) / 60_000
  const interval = mins >= 1440 ? `${mins / 1440}d` : mins >= 60 ? `${mins / 60}h` : `${mins}m`
  const pad = n => String(n).padStart(2, '0')
  const lines = klines
    .filter((_, i) => i % stride === 0)
    .map(k => {
      const d = new Date(k[0])
      return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${k[1]} ${k[2]} ${k[3]} ${k[4]}`
    })
  const thinned = stride > 1 ? ` (every ${stride} candles shown)` : ''
  return `MARKET, the exact candles the video replays, ${interval} candles in UTC (date time open high low close)${thinned}:\n${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// spoken numbers: everything phonetic so the TTS never has to parse digits

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function intWords(n) {
  n = Math.round(n)
  if (n < 10) return ONES[n]
  if (n < 20) return TEENS[n - 10]
  if (n < 100) return TENS[Math.floor(n / 10) - 2] + (n % 10 ? ` ${ONES[n % 10]}` : '')
  return String(n) // prices in the hundreds rarely matter here; digits are fine
}

function sayDecimal(v) {
  if (Number.isInteger(v)) return intWords(v) // "three R", not "three point zero R"
  const [whole, frac = ''] = v.toFixed(2).replace(/0$/, '').split('.')
  const digits = frac.split('').map(d => ONES[Number(d)]).join(' ')
  return digits ? `${intWords(Number(whole))} point ${digits}` : intWords(Number(whole))
}

function sayPrice(p) {
  if (p >= 1000) {
    const k = Math.round(p / 100) / 10 // one decimal of a K, e.g. 64 -> 65.1
    const whole = Math.floor(k)
    const frac = Math.round((k - whole) * 10)
    return frac ? `${intWords(whole)} point ${ONES[frac]} K` : `${intWords(whole)} K`
  }
  if (p >= 1) return sayDecimal(p)
  return `zero point ${fracDigits(p, 3)}`
}

function fracDigits(p, places) {
  return p.toFixed(places).split('.')[1].replace(/0+$/, '').split('').map(d => ONES[Number(d)]).join(' ') || 'zero'
}

// proper coin name for narration ("Kaspa", not "KAS") from CoinGecko's free
// endpoint; on any failure falls back to the bare base symbol
async function coinName(symbol) {
  const base = String(symbol ?? '').replace(/\//g, '').replace(/(USDT|USD|PERP)$/i, '').replace(/^1000/, '').toUpperCase()
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${encodeURIComponent(base.toLowerCase())}`
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (response.ok) {
      const name = (await response.json())?.[0]?.name
      if (name) return name
    }
  } catch {}
  return base
}

// the agent's version suffix is on-screen text only ('axiom-v1.0' -> 'Axiom');
// narration always says "agent", never "bot"
function speakAgentName(name) {
  const base = String(name ?? 'MT-Sniper').replace(/[-_ ]v\d+([._]\d+)*$/i, '').replace(/[-_]+/g, ' ').trim()
  return base ? base[0].toUpperCase() + base.slice(1) : 'MT Sniper'
}

// ---------------------------------------------------------------------------
// copy: LLM first, static variants as the never-fails fallback

async function llmScript(stats, trade, tradeId, minWords, maxWords, key) {
  const angle = ANGLES[hash32(`${tradeId}|angle`) % ANGLES.length]
  const cta = CTAS[hash32(`${tradeId}|cta`) % CTAS.length]
  const messages = [
    {
      role: 'system',
      content: [
        'Voiceover for a 9:16 video replaying a winning crypto futures trade, told over its chart.',
        'The MARKET block holds the exact candles the video plays. Read them and tell the story of what happened: the setup, the entry, the fight, the exit. Let the candles set the mood.',
        'Speak every number exactly as given in FACTS, already spelled for the narrator: "two point four R", "sixty four K". Never write digits.',
        'Work in both the R multiple and the percent gained on the account.',
        'No financial advice, no exclamation marks.',
        `Return JSON {"script": "..."} with ${minWords} to ${maxWords} words.`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `FACTS: ${JSON.stringify(stats)}`,
        marketBlock(trade),
        `Angle for this video: ${angle}`,
        `Close with exactly: "${cta}"`,
      ].filter(Boolean).join('\n'),
    },
  ]
  let lastError
  for (const model of LLM_MODELS) {
    try {
      const response = await fetch(LLM_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 1,
        }),
      })
      if (!response.ok) throw new Error(`${model} responded ${response.status}: ${(await response.text()).slice(0, 200)}`)
      const data = await response.json()
      const text = data?.choices?.[0]?.message?.content ?? ''
      let script
      try {
        script = JSON.parse(text).script
      } catch {
        throw new Error(`${model} returned unparseable JSON`)
      }
      if (typeof script !== 'string' || !validScript(script, minWords, maxWords, { r: stats.r != null, pct: stats.accountPct != null })) {
        throw new Error(`${model} script rejected by validation`)
      }
      return script.trim()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function validScript(script, minWords, maxWords, needs = {}) {
  const words = countWords(script)
  if (words < minWords || words > maxWords) return false
  if (/\d/.test(script) || BANNED.test(script)) return false
  if (needs.r && !/\bR\b/.test(script)) return false
  if (needs.pct && !/percent/i.test(script)) return false
  return true
}

const countWords = s => s.trim().split(/\s+/).filter(Boolean).length

function staticScript(template, stats) {
  const s = stats
  const tension = s.dip ?? 'it went our way almost from the start'
  // "most traders bail" only earns its place when there was a dip to bail at
  const dipFlow = s.dip ? `${cap(tension)}. This is where most traders bail.` : 'Steady from the first candle.'
  const payoff = `${s.hitTarget ? 'full target' : 'closed green'}${s.r ? `, plus ${s.r}` : ''}${s.accountPct ? `, ${s.accountPct}` : ''}${s.hold ? ` ${s.hold}` : ''}`
  const variants = {
    playout: [
      `Here's how ${s.agent} took this ${s.asset} ${s.side}. ${s.entry ? `Entry ${s.entry}` : 'In at market'}${s.stop ? `, stop ${s.side === 'long' ? 'below' : 'above'} ${s.stop}` : ''}. ${dipFlow} Then the reversal: ${payoff}. Follow for the next one.`,
      `${cap(s.asset)} ${s.side}${s.leverage ? `, ${s.leverage}` : ''}. ${dipFlow} Most people would have closed at a loss. ${s.agent} held the plan. ${cap(payoff)}. Follow for the next signal.`,
    ],
  }
  const pool = variants[template] ?? variants.playout
  const script = pool[hash32(trade.trade_id ?? 'x') % pool.length]
  if (!validScript(script, 0, Infinity)) throw new Error(`static script invalid: ${script}`)
  return script
}

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)

// djb2, good enough for deterministic per-trade rotation
function hash32(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// ---------------------------------------------------------------------------
// providers

async function geminiTts(model, voice, script, key, outFile) {
  // no style steering here: these TTS models vocalize systemInstruction (and
  // "Say ..." prefixes) instead of applying them — the voice choice plus the
  // script's own tone carry the delivery, so the model speaks the script only
  const speech = {
    contents: [{ parts: [{ text: script }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  }
  let data
  try {
    data = await callGemini(`${model}:generateContent`, speech, key)
  } catch {
    return false
  }
  const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
  if (!part) return false
  const buf = Buffer.from(part.inlineData.data, 'base64')
  if (/wav/.test(part.inlineData.mimeType ?? '')) {
    writeFileSync(outFile, buf)
  } else {
    // raw l16 (or anything headerless): 24 kHz mono 16-bit per the docs
    writeFileSync(outFile, Buffer.concat([wavHeader(buf.length, 24_000, 1, 2), buf]))
  }
  console.log(`voiceover: synthesized with ${model}`)
  return true
}

function wavHeader(dataBytes, rate, channels, bitsPerSample) {
  const h = Buffer.alloc(44)
  const byteRate = (rate * channels * bitsPerSample) / 8
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + dataBytes, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(byteRate, 28)
  h.writeUInt16LE((channels * bitsPerSample) / 8, 32)
  h.writeUInt16LE(bitsPerSample, 34)
  h.write('data', 36)
  h.writeUInt32LE(dataBytes, 40)
  return h
}

// unofficial free Microsoft voices: same calm-neural quality family, no key,
// no contract. Only reached when every Gemini model failed.
function edgeTts(voice, script, outFile) {
  const edgeVoice = EDGE_TTS_VOICES[voice] ?? 'en-US-AndrewNeural'
  const run = spawnSync('edge-tts', ['--voice', edgeVoice, '--rate=-5%', '--text', script, '--write-media', outFile], { shell: true })
  if (run.status !== 0 || !existsSync(outFile)) {
    console.warn('voiceover: edge-tts unavailable or failed')
    return false
  }
  console.log(`voiceover: synthesized with edge-tts (${edgeVoice})`)
  return true
}

async function callGemini(method, body, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${method}?key=${key}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`Gemini ${method} responded ${response.status}: ${detail}`)
  }
  return response.json()
}

// ---------------------------------------------------------------------------
// run (last: the helpers above are consts, so everything must be initialized)

async function buildVoiceover(template, trade, keys) {
  const asset = await coinName(trade.symbol)
  const stats = deriveStats(trade, asset)
  const voice = VOICES[hash32(trade.trade_id ?? trade.symbol ?? 'x') % VOICES.length]
  const [minWords, maxWords] = wordBudget(trade)

  let script
  let source
  if (process.env.VO_STATIC === '1') {
    script = staticScript(template, stats)
    source = 'static'
  } else {
    for (const [i, key] of keys.entries()) {
      try {
        script = await llmScript(stats, trade, trade.trade_id ?? 'x', minWords, maxWords, key)
        source = `llm${i ? `#${i + 1}` : ''}`
        break
      } catch (error) {
        console.warn(`voiceover: LLM key ${i + 1} failed: ${error?.message ?? error}`)
      }
    }
    if (script == null) {
      script = staticScript(template, stats)
      source = 'static'
    }
  }
  console.log(`voiceover: script (${source}): "${script}"`)

  // public/voiceover.wav (Gemini) or .mp3 (edge-tts)
  const wav = 'public/voiceover.wav'
  const mp3 = 'public/voiceover.mp3'
  let file = null
  let ttsSource = null
  for (const model of TTS_MODELS) {
    if (file) break
    for (const key of keys) {
      if (await geminiTts(model, voice, script, key, wav)) {
        file = wav
        ttsSource = `gemini:${model}`
        break
      }
    }
    if (!file) console.warn(`voiceover: ${model} failed on every key`)
  }
  if (!file && edgeTts(voice, script, mp3)) {
    file = mp3
    ttsSource = 'edge-tts'
  }
  if (!file) throw new Error('every TTS provider failed')

  const durationSeconds = audioDurationSeconds(file)
  return {
    src: file.replace(/^public\//, ''),
    durationSeconds: Math.round(durationSeconds * FPS) / FPS,
    voice,
    script,
    source: `${source}+${ttsSource}`,
  }
}

// duration without ffprobe: WAV from its chunks, edge-tts mp3 from its fixed
// 24 kHz / 48 kbps mono CBR stream (plus a small pad for tag overhead)
function audioDurationSeconds(file) {
  const buf = readFileSync(file)
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF') {
    let offset = 12
    while (offset + 8 <= buf.length) {
      const id = buf.toString('latin1', offset, offset + 4)
      const size = buf.readUInt32LE(offset + 4)
      if (id === 'data') return size / (buf.readUInt32LE(28) || 48_000) // fmt byteRate
      offset += 8 + size + (size % 2)
    }
    throw new Error('WAV has no data chunk')
  }
  return buf.length / 6000 + 0.2
}

const props = JSON.parse(readFileSync('props.json', 'utf8'))
const trade = props.trade
const template = props.template ?? 'playout'

mkdirSync('public', { recursive: true })

// music bed + alert chime: every audio file in their folders is a candidate,
// rotating per trade like the voices do (deterministic on trade_id)
const audioFilesIn = dir =>
  existsSync(dir) ? readdirSync(dir).filter(f => /\.(mp3|wav|m4a|ogg)$/i.test(f)).sort() : []
const rotated = (dir, volume) => {
  const pool = audioFilesIn(`public/${dir}`)
  if (!pool.length) return null
  const file = pool[hash32(`${trade.trade_id ?? 'x'}|${dir}`) % pool.length]
  return { src: `${dir}/${file}`, volume }
}
const music = rotated('music', 0.1)
const alert = rotated('sounds', 0.6)
let voiceover = null

// GEMINI_API_KEY first, then GEMINI_API_KEY_2, GEMINI_API_KEY_3, ... in
// numeric order — set as many as you like; each stage tries them one by one
const geminiKeys = () => {
  const numbered = Object.entries(process.env)
    .map(([name, value]) => [name.match(/^GEMINI_API_KEY_(\d+)$/), value])
    .filter(([match, value]) => match && value)
    .sort((a, b) => Number(a[0][1]) - Number(b[0][1]))
    .map(([, value]) => value)
  return [...new Set([process.env.GEMINI_API_KEY, ...numbered].filter(Boolean))]
}

const keys = geminiKeys()
if (process.env.VO === 'skip') {
  console.log('voiceover: VO=skip, rendering without narration')
} else if (!keys.length) {
  console.log('voiceover: no GEMINI_API_KEY / GEMINI_API_KEY_2 set, rendering without narration')
} else {
  try {
    voiceover = await buildVoiceover(template, trade, keys)
  } catch (error) {
    console.warn(`voiceover: failed, rendering without narration: ${error?.message ?? error}`)
  }
}

props.voiceover = voiceover
props.music = music
props.alert = alert
writeFileSync('props.json', JSON.stringify(props, null, 2))

if (voiceover) {
  console.log(`voiceover: ${voiceover.voice} (${voiceover.source}), ${voiceover.durationSeconds.toFixed(1)}s, ${countWords(voiceover.script)} words`)
} else {
  console.log('voiceover: none')
}
console.log(alert ? `alert: ${alert.src} (volume ${alert.volume})` : 'alert: no chime files')
console.log(music ? `music: ${music.src} (volume ${music.volume})` : 'music: no bed tracks, silent bed')
