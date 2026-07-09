'use client'
import { Terminal } from 'lucide-react'
import { Blinker } from './Blinker'

/** Brand mark — bracketed terminal glyph + wordmark + a small
 * "system info" line. Used in the sidebar (compact) and on the
 * login/signup screens (large). */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const isLg = size === 'lg'
  const isSm = size === 'sm'
  return (
    <div className={isLg ? 'text-center' : ''}>
      <div className={`inline-flex items-center gap-2 font-term font-extrabold tracking-tight text-term-primary term-glow ${isLg ? 'text-3xl' : isSm ? 'text-sm' : 'text-lg'}`}>
        <span className={`border border-term-primary/60 px-1 ${isSm ? 'text-xs' : ''}`}>
          <Terminal className={isLg ? 'w-6 h-6' : isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        </span>
        SRE_AI_OS{!isSm && <Blinker className="ml-0.5" />}
      </div>
      <p className={`font-term text-term-amber tracking-widest uppercase mt-1 ${isLg ? 'text-xs' : 'text-[9px]'}`}>
        [ powered by ai ]
      </p>
      <p className={`font-term text-term-muted tracking-wide mt-0.5 ${isLg ? 'text-[11px]' : 'text-[9px]'}`}>
        // built by keshav saxena
      </p>
    </div>
  )
}
