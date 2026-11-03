import { useEffect, useState } from 'react'

/** How long a copy message stays on screen, in milliseconds. */
const COPY_MESSAGE_MS = 4000

/**
 * The result of a Copy seed click: the seed it copied, whether the browser accepted the write, and
 * which click it was (counted from 1), so a repeated click renders a new message node.
 */
interface CopyResult {
  seed: string
  copied: boolean
  attempt: number
}

interface SeedBarProps {
  seed: string
  onClear: () => void
}

/**
 * Writes `text` to the clipboard. Resolves to true when the browser accepted it, and to false when the
 * page has no Clipboard API (for example over plain http) or the browser refused the write. Does not throw.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  // navigator.clipboard is typed as always present, but browsers leave it out outside secure contexts.
  const clipboard: Clipboard | undefined = navigator.clipboard
  if (clipboard === undefined) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Renders the current `seed` in a polite live region, so a new seed from Reroll or Clear seed is
 * announced, with a Copy seed button and a Clear seed button, for the top of the page.
 * Copy seed writes the seed text to the clipboard and then shows "Seed copied.", or a message asking the
 * player to copy it by hand when the write fails. The message is shown only while the seed it was made
 * for is still the current seed, and is removed 4 seconds after it appears. Each click renders its
 * message as a new element inside the live region, so a repeated click with the same result is
 * announced again. Clear seed calls `onClear`.
 */
export function SeedBar({ seed, onClear }: SeedBarProps) {
  const [result, setResult] = useState<CopyResult | undefined>(undefined)
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    if (result === undefined) return undefined
    const timer = window.setTimeout(() => setResult(undefined), COPY_MESSAGE_MS)
    return () => window.clearTimeout(timer)
  }, [result])

  const copy = async () => {
    const copying = seed
    const attempt = attempts + 1
    setAttempts(attempt)
    setResult({ seed: copying, copied: await writeToClipboard(copying), attempt })
  }

  // A result for a seed that is no longer shown (Clear seed or Reroll during or after the copy) is ignored.
  const shown = result !== undefined && result.seed === seed ? result : undefined

  return (
    <section className="seed-bar" aria-label="Seed">
      <p aria-live="polite">
        Seed <code data-testid="seed">{seed}</code>
      </p>
      <div className="seed-actions">
        <button type="button" className="secondary" onClick={() => void copy()}>
          Copy seed
        </button>
        <button type="button" className="secondary" aria-describedby="clear-seed-hint" onClick={onClear}>
          Clear seed
        </button>
        <span id="clear-seed-hint" className="visually-hidden">
          Starts a new character with a new random seed.
        </span>
      </div>
      <p className="muted seed-status" aria-live="polite" data-testid="seed-status">
        {shown !== undefined && (
          <span key={shown.attempt}>
            {shown.copied ? 'Seed copied.' : "Couldn't copy the seed. Select it and copy it by hand."}
          </span>
        )}
      </p>
    </section>
  )
}
