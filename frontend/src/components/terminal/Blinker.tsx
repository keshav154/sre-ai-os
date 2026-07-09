'use client'

/** The blinking block cursor — the "heartbeat" of the interface. Used
 * sparingly (page title, active prompts) rather than scattered everywhere,
 * per the restrained-effects direction. */
export function Blinker({ className = '' }: { className?: string }) {
  return <span className={`term-cursor inline-block w-[0.55em] h-[1em] bg-term-primary align-middle ${className}`} aria-hidden="true" />
}
