import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

// Terminal-prompt mark — a bracketed ">_" glyph in the same green-phosphor
// palette as the in-app Terminal CLI redesign, so the browser tab matches
// the product itself instead of the default Next.js logo.
export default function Icon() {
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
          border: '2px solid #33ff00',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontFamily: 'monospace',
            fontWeight: 700,
            fontSize: 18,
            color: '#33ff00',
            letterSpacing: '-1px',
          }}
        >
          <span>&gt;</span>
          <span style={{ background: '#33ff00', width: 8, height: 14, marginLeft: 2 }} />
        </div>
      </div>
    ),
    { ...size }
  )
}
