// One-command local renderer (PowerShell-friendly, no inline env vars):
//   node scripts/render.mjs mytrade.json -t playout
//   node scripts/render.mjs mytrade.json playout
//   bun run render mytrade.json
//
// <trade.json> [template]   positional form (npm on Windows strips flags
//                           after `--`, so this is the reliable npm form)
// -d, --data <file>         same as the first positional
// -t, --template <id>       same as the second positional (playout)
// -o, --out <file>          output path; default out/<trade_id>-<template>.mp4
//
// Chains build-props -> voiceover -> remotion render. Voiceover env knobs
// (GEMINI_API_KEY, VO=skip, ...) pass straight through.
import { readFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const USAGE = `Usage: npm run render -- <trade.json> [template] [flags]
       node scripts/render.mjs <trade.json> [template] [flags]

  <trade.json>              trade JSON file (required; -d <file> also works)
  <template>                playout (default; -t <id>)
  -o, --out <file>          output path (default: out/<trade_id>-<template>.mp4)
  -h, --help               this help

Note: npm on Windows drops single-dash flags after the -- separator, so
prefer the positional form with npm, or run node/bun directly for flags.

Examples:
  npm run render -- trades/example.json
  node scripts/render.mjs trades/example.json playout
  bun run render trades/example.json -o out/reel.mp4`

function parseArgs(argv) {
  const args = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '-t' || a === '--template') args.template = argv[++i]
    else if (a === '-d' || a === '--data') args.data = argv[++i]
    else if (a === '-o' || a === '--out') args.out = argv[++i]
    else if (a.startsWith('-')) {
      console.error(`Unknown argument: ${a}\n`)
      console.error(USAGE)
      process.exit(1)
    } else positional.push(a)
  }
  args.data ||= positional[0]
  args.template ||= positional[1]
  if (positional.length > 2) {
    console.error(`Unexpected extra argument: ${positional[2]}\n`)
    console.error(USAGE)
    process.exit(1)
  }
  return args
}

function run(step, command, cmdArgs, env = {}) {
  console.log(`\n> ${step}`)
  const result = spawnSync(command, cmdArgs, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.status !== 0) {
    console.error(`${step} failed with exit code ${result.status ?? 'signal ' + result.signal}`)
    process.exit(result.status ?? 1)
  }
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(USAGE)
  process.exit(0)
}

let tradeJson = process.env.TRADE_JSON
if (args.data) {
  try {
    tradeJson = readFileSync(args.data, 'utf8')
  } catch (error) {
    console.error(`Cannot read data file ${args.data}: ${error.message}`)
    process.exit(1)
  }
} else if (!tradeJson) {
  console.error('Missing <trade.json> (or set TRADE_JSON)\n')
  console.error(USAGE)
  process.exit(1)
}

try {
  JSON.parse(tradeJson)
} catch (error) {
  console.error(`Data file is not valid JSON: ${error.message}`)
  process.exit(1)
}

run('build-props', process.execPath, ['scripts/build-props.mjs'], {
  TRADE_JSON: tradeJson,
  ...(args.template && { TEMPLATE: args.template }),
})

run('voiceover', process.execPath, ['scripts/voiceover.mjs'])

// the template actually rendered may differ from -t (build-props falls back
// when required inputs are missing), so read the chosen one from props.json
const props = JSON.parse(readFileSync('props.json', 'utf8'))
const template = props.template
const tradeId = String(props.trade.trade_id ?? 'video').replace(/[^a-z0-9._-]+/gi, '-')
const output = args.out ?? `out/${tradeId}-${template}.mp4`
mkdirSync(dirname(output), { recursive: true })

run(`render ${template} -> ${output}`, process.execPath, [
  join('node_modules', '@remotion', 'cli', 'remotion-cli.js'),
  'render', 'src/index.ts', template, output, '--props=props.json',
])

const sizeMb = (readFileSync(output).length / 1e6).toFixed(1)
console.log(`\nDone: ${output} (${sizeMb} MB, template=${template})`)
