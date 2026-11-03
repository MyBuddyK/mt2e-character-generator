import { useEffect, useState } from 'react'
import { newCharacter, overrideCharacteristic, randomSeed, type Character } from './engine/character'
import {
  CHARACTERISTICS,
  MAX_CHARACTERISTIC,
  MIN_CHARACTERISTIC,
  characteristicDM,
  normalizeCharacteristic,
  upp,
  type Characteristic,
} from './engine/characteristics'
import { current, isOverridden, type Overridable } from './engine/overridable'
import { careerErrors, careers } from './data/careers'

/** Returns the trimmed ?seed= value from the page URL, or a new random seed when it is missing or empty. */
function initialSeed(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('seed')?.trim()
  return fromUrl ? fromUrl : randomSeed()
}

/** Replaces the ?seed= value in the address bar with `seed`, without adding a history entry. */
function writeSeedToUrl(seed: string): void {
  const url = new URL(window.location.href)
  if (url.searchParams.get('seed') === seed) return
  url.searchParams.set('seed', seed)
  window.history.replaceState(null, '', url)
}

/** Returns a dice modifier as text with an explicit sign for positive values, e.g. "+2", "0", "-1". */
function formatDM(dm: number): string {
  return dm > 0 ? `+${dm}` : String(dm)
}

interface CharacteristicRowProps {
  name: Characteristic
  entry: Overridable<number>
  onOverride: (value: number | undefined) => void
}

/**
 * Renders one characteristic as a table row. The input keeps its own draft text, so the player can
 * clear it and type a new number. Each in-range whole number typed is applied straight away. When the
 * field loses focus or Enter is pressed, any other number is applied after rounding and clamping, and
 * empty or non-numeric text is replaced by the current value. The Reset button removes the override.
 */
function CharacteristicRow({ name, entry, onOverride }: CharacteristicRowProps) {
  const value = current(entry)
  const overridden = isOverridden(entry)
  const [draft, setDraft] = useState(String(value))
  const [shownValue, setShownValue] = useState(value)

  // Copies an outside change (reroll, reset, clamping on blur) into the draft text.
  if (shownValue !== value) {
    setShownValue(value)
    setDraft(String(value))
  }

  const commitDraft = () => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(value))
      return
    }
    onOverride(n)
    setDraft(String(normalizeCharacteristic(n)))
  }

  return (
    <tr data-testid={`char-${name}`} className={overridden ? 'overridden' : undefined}>
      <th scope="row">{name}</th>
      <td>{entry.rolled}</td>
      <td>
        <input
          type="number"
          inputMode="numeric"
          step={1}
          min={MIN_CHARACTERISTIC}
          max={MAX_CHARACTERISTIC}
          aria-label={`${name} value`}
          value={draft}
          onChange={(e) => {
            const text = e.target.value
            setDraft(text)
            const n = Number(text)
            if (text.trim() !== '' && Number.isInteger(n) && n >= MIN_CHARACTERISTIC && n <= MAX_CHARACTERISTIC) {
              onOverride(n)
            }
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft()
          }}
        />
      </td>
      <td data-testid={`dm-${name}`}>{formatDM(characteristicDM(value))}</td>
      <td>
        {overridden && (
          <div className="status">
            <span className="badge" data-testid={`overridden-${name}`}>
              Overridden
            </span>
            <button
              type="button"
              className="secondary"
              aria-label={`Reset ${name} to rolled value`}
              onClick={() => onOverride(undefined)}
            >
              Reset
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

/**
 * Renders the characteristics table, the list of loaded careers, any career file errors, and the legal
 * notice. The current seed is kept in the URL's ?seed= value. Reroll picks a new seed and rolls a new
 * character.
 */
export default function App() {
  const [character, setCharacter] = useState<Character>(() => newCharacter(initialSeed()))

  useEffect(() => {
    writeSeedToUrl(character.seed)
  }, [character.seed])

  return (
    <>
      <main>
        <header>
          <h1>Traveller Character Generator</h1>
          <p className="muted">Unofficial fan tool for Mongoose Traveller 2nd Edition.</p>
        </header>

        {careerErrors.length > 0 && (
          <section role="alert" className="errors" aria-labelledby="errors-heading">
            <h2 id="errors-heading">Career file problems</h2>
            <ul>
              {careerErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="chars-heading">
          <div className="row">
            <h2 id="chars-heading">Characteristics</h2>
            <button type="button" onClick={() => setCharacter(newCharacter(randomSeed()))}>
              Reroll
            </button>
          </div>
          <p aria-live="polite">
            UPP <strong data-testid="upp">{upp(character.characteristics)}</strong>{' '}
            <span className="muted">
              seed <span data-testid="seed">{character.seed}</span>
            </span>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <abbr title="Characteristic">Char</abbr>
                  </th>
                  <th scope="col">Roll</th>
                  <th scope="col">Value</th>
                  <th scope="col">DM</th>
                  <th scope="col">
                    <span className="visually-hidden">Status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {CHARACTERISTICS.map((key) => (
                  <CharacteristicRow
                    key={`${character.seed}-${key}`}
                    name={key}
                    entry={character.characteristics[key]}
                    onOverride={(value) => setCharacter((c) => overrideCharacteristic(c, key, value))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="careers-heading">
          <h2 id="careers-heading">Careers loaded</h2>
          <ul data-testid="career-list">
            {careers.map((c) => (
              <li key={c.id}>
                <strong>{c.name}</strong> <span className="muted">{c.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer>
        <p className="muted">
          Unofficial fan project. Traveller is a trademark of Far Future Enterprises. Not affiliated with or endorsed by
          Far Future Enterprises or Mongoose Publishing.
        </p>
      </footer>
    </>
  )
}
