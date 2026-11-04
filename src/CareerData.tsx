import { useState } from 'react'
import type { CareerPacks } from './use-career-packs'

/** The README section that explains the career pack format and links to the sample data files. */
export const PACK_GUIDE_URL = 'https://github.com/MyBuddyK/mt2e-character-generator#writing-a-career-pack'

/**
 * Renders the Career data section: a file picker and a URL field for importing career packs, one
 * row per loaded pack with its revision, fingerprint, career count and origin, and the messages
 * from useCareerPacks. Error messages use role="alert"; other messages use role="status".
 */
export function CareerData({ packs }: { packs: CareerPacks }) {
  const [url, setUrl] = useState('')
  const { message } = packs

  return (
    <section aria-labelledby="career-data-heading" data-testid="career-data">
      <h2 id="career-data-heading">Career data</h2>

      <div className="import-controls">
        <label className="file-label">
          Import from file
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const input = e.currentTarget
              const file = input.files?.[0]
              if (!file) return
              void file.text().then((text) => {
                input.value = ''
                return packs.importFile(file.name, text)
              })
            }}
          />
        </label>
        <form
          className="url-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void packs.importUrl(url)
          }}
        >
          <label htmlFor="pack-url">Pack URL</label>
          <input
            id="pack-url"
            type="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-describedby="pack-url-note"
          />
          <button type="submit" disabled={packs.busy || url.trim() === ''}>
            {packs.busy ? 'Loading…' : 'Load from URL'}
          </button>
          <p id="pack-url-note" className="muted small">
            Anyone who has a public link to a pack can read it.
          </p>
        </form>
      </div>

      {message &&
        (message.kind === 'error' ? (
          <div role="alert" className="errors" data-testid="pack-message">
            <p>{message.text}</p>
            <MessageDetails details={message.details} />
          </div>
        ) : (
          <div role="status" className="notice" data-testid="pack-message">
            <p>{message.text}</p>
            <MessageDetails details={message.details} />
          </div>
        ))}

      {packs.entries.length === 0 ? (
        <p className="muted" data-testid="no-packs">
          No career packs loaded. Your referee can share a career pack file or link; until then the sample
          career below is available.
        </p>
      ) : (
        <ul className="pack-list" data-testid="pack-list">
          {packs.entries.map((entry) => (
            <li key={entry.pack.id} data-testid={`pack-${entry.pack.id}`}>
              <div className="pack-row">
                <strong>{entry.pack.name}</strong>
                <span>rev {entry.pack.revision}</span>
                <span>
                  fp <code data-testid="pack-fingerprint">{entry.stored.fingerprint}</code>
                </span>
                <span>
                  {entry.careers.length} career{entry.careers.length === 1 ? '' : 's'}
                </span>
                <span data-testid="pack-origin">{entry.stored.origin.kind === 'url' ? 'URL' : 'file'}</span>
                {entry.stored.origin.kind === 'url' && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={packs.busy}
                    onClick={() => void packs.checkForUpdate(entry)}
                    aria-label={`Check ${entry.pack.name} for update`}
                  >
                    Check for update
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => packs.remove(entry.stored, entry.pack.name)}
                  aria-label={`Remove ${entry.pack.name}`}
                >
                  Remove
                </button>
              </div>
              {entry.problems.length > 0 && (
                <details>
                  <summary>
                    {entry.problems.length} problem{entry.problems.length === 1 ? '' : 's'}: some careers or
                    species were skipped
                  </summary>
                  <MessageDetails details={entry.problems} />
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {packs.duplicates.length > 0 && (
        <div className="notice" data-testid="duplicate-careers">
          <p>
            Some career or species ids are used more than once. The one from the pack whose id sorts first is used, and
            the built-in Human is always kept.
          </p>
          <MessageDetails details={packs.duplicates} />
        </div>
      )}
      {packs.broken.length > 0 && (
        <div className="notice" data-testid="broken-packs">
          <p>Some saved packs can no longer be loaded:</p>
          <ul>
            {packs.broken.map((b, i) => (
              <li key={`${b.stored.importedAt}-${i}`}>
                {b.reason}{' '}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => packs.remove(b.stored, `saved pack ${i + 1}`)}
                  aria-label={`Remove saved pack ${i + 1} that can't be loaded`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {packs.unreadableCount > 0 && (
        <div className="notice" data-testid="unreadable-packs">
          <p>
            {packs.unreadableCount} saved entr{packs.unreadableCount === 1 ? 'y' : 'ies'} could not be read. They are
            kept in this browser until you delete them.{' '}
            <button type="button" className="secondary" onClick={packs.discardUnreadable}>
              Delete unreadable data
            </button>
          </p>
        </div>
      )}
      {!packs.storageAvailable && (
        <p className="notice" data-testid="storage-notice">
          This browser is not letting the site save data, so packs will be forgotten when the page closes.
        </p>
      )}
      {packs.unsaved.length > 0 && (
        <p className="notice" data-testid="unsaved-notice">
          Could not save {packs.unsaved.map((n) => `"${n}"`).join(', ')} in this browser (its storage may be full).
          It stays loaded until the page closes.
        </p>
      )}
      <p className="muted small">Packs are stored only in this browser. Nothing is uploaded.</p>
      <p className="small">
        <a href={PACK_GUIDE_URL} target="_blank" rel="noreferrer">
          How to write a career pack
        </a>{' '}
        <span className="muted">(GitHub README, with the sample data files)</span>
      </p>
    </section>
  )
}

/** Renders `details` as a list, or nothing when it is empty. */
function MessageDetails({ details }: { details: string[] }) {
  if (details.length === 0) return null
  return (
    <ul>
      {details.map((d) => (
        <li key={d}>{d}</li>
      ))}
    </ul>
  )
}
