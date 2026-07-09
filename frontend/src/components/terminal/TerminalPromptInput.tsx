'use client'

/** "No box, just a prompt" input — `user@host:~$ _` rather than a boxed
 * field. A single underline grounds the row instead of a full border; focus
 * is signalled by the brightening prompt symbol, not a ring. */
export function TerminalPromptInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  prompt = '>',
  type = 'text',
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  prompt?: string
  type?: string
  className?: string
}) {
  return (
    <div className={`flex items-center gap-2 border-b border-term-border py-1.5 focus-within:border-term-primary ${className}`}>
      <span className="font-term text-term-primary text-sm">{prompt}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="flex-1 bg-transparent border-none outline-none font-term text-sm text-term-primary placeholder:text-term-muted"
      />
    </div>
  )
}
