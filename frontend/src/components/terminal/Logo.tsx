'use client'
import { Blinker } from './Blinker'

const MARK_SIZE = { sm: 'w-6 h-6 border', md: 'w-8 h-8 border', lg: 'w-12 h-12 border-2' } as const
const MARK_TEXT = { sm: 'text-[11px]', md: 'text-sm', lg: 'text-2xl' } as const
const CURSOR_SIZE = { sm: 'w-[3px] h-2.5', md: 'w-1 h-3', lg: 'w-1.5 h-4' } as const
const WORD_SIZE = { sm: 'text-sm', md: 'text-lg', lg: 'text-3xl' } as const

/** Brand mark — a bracketed `>_` terminal-prompt badge (matching the
 * browser tab favicon, see app/icon.tsx) + wordmark + a small "system
 * info" line. Used compact in the sidebar and large on the login/signup
 * screens. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const isLg = size === 'lg'
  const isSm = size === 'sm'
  return (
    <div className={isLg ? 'text-center' : ''}>
      <div className={`inline-flex items-center gap-2.5 font-term font-extrabold tracking-tight text-term-primary ${isLg ? 'term-glow' : ''}`}>
        {/* Icon badge — same ">_" glyph as the favicon, for brand consistency */}
        <span className={`flex-shrink-0 flex items-center justify-center border-term-primary bg-black ${MARK_SIZE[size]}`}>
          <span className={`inline-flex items-center leading-none ${MARK_TEXT[size]}`}>
            &gt;<span className={`inline-block bg-term-primary ml-[1px] ${CURSOR_SIZE[size]}`} />
          </span>
        </span>
        <span className={WORD_SIZE[size]}>
          SRE_AI_OS{!isSm && <Blinker className="ml-0.5" />}
        </span>
      </div>
      {isLg && <div className="border-t border-dashed border-term-border mt-3 mb-2 w-40 mx-auto" />}
      <p className={`font-term text-term-amber tracking-widest uppercase ${isLg ? 'text-xs mt-0' : 'text-[9px] mt-1'}`}>
        [ powered by ai ]
      </p>
      <p className={`font-term text-term-muted tracking-wide mt-0.5 ${isLg ? 'text-[11px]' : 'text-[9px]'}`}>
        // built by keshav saxena
      </p>
    </div>
  )
}
