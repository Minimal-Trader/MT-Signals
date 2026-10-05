import React from 'react'
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { BG, BrandMark, FONT_STACK, MUTED, ORANGE } from './brand'

// Length of the brand outro card, in frames. The playout template ends with
// it and adds it to its total duration (playoutDuration).
export const OUTRO_FRAMES = 72

// The outro sound (public/sfx/outro-whoosh-alt.mp3, Mixkit "fast whoosh")
// builds for ~0.7s and peaks exactly here, so the logo lands on the hit.
// If you swap in a different sound, re-time this to its peak
// (frames = peak seconds * 30).
const POP_FRAME = 22

// The one fixed end card (not part of the style rotation): whoosh rises over
// the white card, the MT wordmark pops in dead center as it hits, ripple
// ring expanding with the build, site link at the bottom.
export const BrandOutro: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const pop = spring({ frame: frame - POP_FRAME, fps, config: { damping: 12, mass: 0.85, stiffness: 170 } })
  const scale = 0.2 + 0.8 * pop
  // the ring starts expanding just ahead of the hit, riding the whoosh build
  const ripple = interpolate(frame, [POP_FRAME - 10, POP_FRAME + 22], [0.55, 1.75], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const rippleOpacity = interpolate(frame, [POP_FRAME - 10, POP_FRAME + 22], [0.45, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const linkOpacity = interpolate(frame, [POP_FRAME + 18, POP_FRAME + 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT_STACK, justifyContent: 'center', alignItems: 'center' }}>
      <Audio src={staticFile('sfx/outro-whoosh-alt.mp3')} volume={0.6} />

      <div style={{ position: 'relative', width: 360, height: 360, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <span
          style={{
            position: 'absolute',
            width: 360,
            height: 360,
            borderRadius: '50%',
            border: `3px solid ${ORANGE}`,
            transform: `scale(${ripple})`,
            opacity: rippleOpacity,
          }}
        />
        <div style={{ opacity: Math.min(1, Math.max(0, (frame - POP_FRAME) / 3)), transform: `scale(${scale})` }}>
          <BrandMark width={320} />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 300,
          opacity: linkOpacity,
          color: MUTED,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
        }}
      >
        minimaltrader.live
      </div>
    </AbsoluteFill>
  )
}
