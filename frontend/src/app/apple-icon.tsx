import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// Larger variant of icon.tsx for iOS home-screen bookmarks — same mark,
// more breathing room since iOS applies its own corner mask on top.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          border: '10px solid #33ff00',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontFamily: 'monospace',
            fontWeight: 700,
            fontSize: 92,
            color: '#33ff00',
            letterSpacing: '-4px',
          }}
        >
          <span>&gt;</span>
          <span style={{ background: '#33ff00', width: 38, height: 68, marginLeft: 10 }} />
        </div>
      </div>
    ),
    { ...size }
  )
}
