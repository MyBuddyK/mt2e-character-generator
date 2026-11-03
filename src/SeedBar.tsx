import { useState } from 'react'

/** The result of the last Copy seed click: none yet, written to the clipboard, or refused by the browser. */
type CopyStatus = 'idle' | 'copied' | 'failed'

interface SeedBarProps {
  seed: string
  onClear: () => void
}

/**
 * Writes `text` to the clipboard. Resolves to true when the browser accepted it, and to false when the
 * page has no Clipboard API (for example over plain http) or the browser refused the write. Does not throw.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  if (!('clipboard' in navigator)) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Renders the current `seed` with a Copy seed button and a Clear seed button, for the top of the page.
 * Copy seed writes the seed text to the clipboard and then shows "Seed copied", or a message asking the
 * player to copy it by hand when the write fails. The message is in a polite live region and is removed
 * when the seed changes. Clear seed calls `onClear`.
 */
export function SeedBar({ seed, onClear }: SeedBarProps) {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const [statusSeed, setStatusSeed] = useState(seed)

  // A message about an earlier seed is dropped when the seed changes.
  if (statusSeed !== seed) {
    setStatusSeed(seed)
    setStatus('idle')
  }

  const copy = async () => {
    setStatus((await writeToClipboard(seed)) ? 'copied' : 'failed')
  }

  return (
    <section className="seed-bar" aria-label="Seed">
      <p>
        Seed <code data-testid="seed">{seed}</code>
      </p>
      <div className="seed-actions">
        <button type="button" className="secondary" onClick={() => void copy()}>
          Copy seed
        </button>
        <button type="button" className="secondary" onClick={onClear}>
          Clear seed
        </button>
      </div>
      <p className="muted seed-status" aria-live="polite" data-testid="seed-status">
        {status === 'copied' && 'Seed copied.'}
        {status === 'failed' && "Couldn't copy the seed. Select it and copy it by hand."}
      </p>
    </section>
  )
}
