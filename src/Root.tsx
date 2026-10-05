import { Composition } from 'remotion'
import { TradePlayOut, playoutDuration } from '../templates/TradePlayOut'
import { videoPropsSchema } from './schema'
import type { Trade } from './schema'

// 1080x1920 (9:16 for TikTok/Reels/Shorts), 30fps.
// Templates are registered in templates.json — keep the two in sync when
// adding one (composition id = template id). defaultProps are intentionally
// empty: real content always comes from props.json (dispatch payload or the
// local -d file); preview real props in the studio with --props=props.json.
const emptyTrade: Trade = { trade_id: '', bot_name: '', symbol: '', side: '' }

export const RemotionRoot = () => (
  <>
    <Composition
      id="playout"
      component={TradePlayOut}
      durationInFrames={600}
      fps={30}
      width={1080}
      height={1920}
      schema={videoPropsSchema}
      defaultProps={{ trade: emptyTrade, voiceover: null, music: null, alert: null, styles: null }}
      // replay length adapts to the candle count (slow/fast/slow pacing),
      // stretches to cover the voiceover, then the brand outro card
      calculateMetadata={({ props }) => ({
        durationInFrames: playoutDuration(props.trade, props.voiceover?.durationSeconds ?? null),
      })}
    />
  </>
)
