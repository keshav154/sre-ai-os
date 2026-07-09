'use client'

const BRACKET_COLOR = {
  primary: 'text-term-primary hover:bg-term-primary hover:text-term-bg',
  amber: 'text-term-amber hover:bg-term-amber hover:text-term-bg',
  error: 'text-term-error hover:bg-term-error hover:text-term-bg',
  muted: 'text-term-muted hover:bg-term-muted hover:text-term-bg',
} as const

const SOLID_COLOR = {
  primary: 'bg-term-primary text-term-bg hover:bg-term-amber',
  amber: 'bg-term-amber text-term-bg hover:bg-term-primary',
  error: 'bg-term-error text-term-bg hover:opacity-80',
  muted: 'bg-term-muted text-term-primary hover:opacity-80',
} as const

/**
 * `[ LABEL ]` bracket-text button by default (most actions — bracket
 * hover-inverts), or a permanently-inverted solid block for the page's 1-2
 * top-level calls to action. Never rounded, never shadowed.
 */
export function TerminalButton({
  children,
  onClick,
  variant = 'primary',
  solid = false,
  disabled = false,
  size = 'md',
  className = '',
  title,
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'amber' | 'error' | 'muted'
  solid?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  const sizing = size === 'sm' ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-1.5'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`font-term font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${sizing} ${solid ? SOLID_COLOR[variant] : BRACKET_COLOR[variant]} ${className}`}
    >
      {solid ? children : <>[&nbsp;{children}&nbsp;]</>}
    </button>
  )
}
