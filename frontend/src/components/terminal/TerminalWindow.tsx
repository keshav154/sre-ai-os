'use client'

const VARIANT_BORDER = {
  primary: 'border-term-border',
  amber: 'border-term-amber/50',
  error: 'border-term-error/50',
} as const

const VARIANT_TITLEBAR = {
  primary: 'bg-term-primary text-term-bg',
  amber: 'bg-term-amber text-term-bg',
  error: 'bg-term-error text-term-bg',
} as const

/**
 * The "window/pane" primitive — a black box with a 1px border and an
 * inverted title bar, standing in for Card everywhere in the Terminal CLI
 * redesign. Deliberately no rounded corners, no shadow.
 */
export function TerminalWindow({
  title,
  titleRight,
  variant = 'primary',
  noPadding = false,
  className = '',
  children,
  onClick,
}: {
  title?: string
  titleRight?: React.ReactNode
  variant?: 'primary' | 'amber' | 'error'
  noPadding?: boolean
  className?: string
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`border ${VARIANT_BORDER[variant]} bg-term-bg font-term ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {title && (
        <div className={`flex items-center justify-between px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${VARIANT_TITLEBAR[variant]}`}>
          <span>{title}</span>
          {titleRight}
        </div>
      )}
      <div className={noPadding ? '' : 'p-4'}>{children}</div>
    </div>
  )
}
