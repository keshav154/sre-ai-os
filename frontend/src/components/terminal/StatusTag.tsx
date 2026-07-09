'use client'

const VARIANT_COLOR = {
  primary: 'text-term-primary border-term-border',
  amber: 'text-term-amber border-term-amber/50',
  error: 'text-term-error border-term-error/50',
  muted: 'text-term-muted border-term-border',
} as const

/** Replaces colored pill badges with bracketed status text, e.g.
 * `[ YOUTUBE ]`, `[ HIGH ]`, `[ OK ]` — the "status code" shell metaphor. */
export function StatusTag({
  children,
  variant = 'muted',
  className = '',
}: {
  children: React.ReactNode
  variant?: 'primary' | 'amber' | 'error' | 'muted'
  className?: string
}) {
  return (
    <span className={`font-term text-[10px] font-bold uppercase tracking-wide border px-1.5 py-0.5 ${VARIANT_COLOR[variant]} ${className}`}>
      [&nbsp;{children}&nbsp;]
    </span>
  )
}
