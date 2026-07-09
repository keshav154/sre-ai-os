'use client'

/**
 * A `--- LABEL ---` style section separator. Uses a dashed border rather
 * than literally repeating characters — renders identically to the ASCII
 * motif but doesn't need to measure/overflow-guard against container width.
 */
export function AsciiDivider({ label, className = '' }: { label?: string; className?: string }) {
  if (!label) {
    return <div className={`border-t border-dashed border-term-border ${className}`} />
  }
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex-1 border-t border-dashed border-term-border" />
      <span className="font-term text-[10px] font-bold uppercase tracking-widest text-term-muted">{label}</span>
      <div className="flex-1 border-t border-dashed border-term-border" />
    </div>
  )
}
