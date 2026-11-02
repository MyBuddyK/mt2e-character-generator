import { useState } from 'react'
import { newCharacter, overrideCharacteristic, randomSeed, type Character } from './engine/character'
import { CHARACTERISTICS, characteristicDM, upp } from './engine/characteristics'
import { current, isOverridden } from './engine/overridable'
import { careers } from './data/careers'

/** Returns the ?seed= value from the page URL, or a new random seed when there is none. */
function initialSeed(): string {
  return new URLSearchParams(window.location.search).get('seed') ?? randomSeed()
}

/** Returns a dice modifier as text with an explicit sign for positive values, e.g. "+2", "0", "-1". */
function formatDM(dm: number): string {
  return dm > 0 ? `+${dm}` : String(dm)
}

/**
 * Renders the characteristics table and the list of loaded careers. Reroll picks a new seed, writes it
 * to the URL and rolls a new character. Editing a value stores it as an override of the rolled value.
 */
export default function App() {
  const [character, setCharacter] = useState<Character>(() => newCharacter(initialSeed()))

  const reroll = () => {
    const seed = randomSeed()
    const url = new URL(window.location.href)
    url.searchParams.set('seed', seed)
    window.history.replaceState(null, '', url)
    setCharacter(newCharacter(seed))
  }

  return (
    <main>
      <header>
        <h1>Traveller Character Generator</h1>
        <p className="muted">Unofficial fan tool for Mongoose Traveller 2nd Edition.</p>
      </header>

      <section aria-labelledby="chars-heading">
        <div className="row">
          <h2 id="chars-heading">Characteristics</h2>
          <button type="button" onClick={reroll}>
            Reroll
          </button>
        </div>
        <p>
          UPP <strong data-testid="upp">{upp(character.characteristics)}</strong>{' '}
          <span className="muted" data-testid="seed">
            seed {character.seed}
          </span>
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Characteristic</th>
              <th scope="col">Rolled</th>
              <th scope="col">Value</th>
              <th scope="col">DM</th>
            </tr>
          </thead>
          <tbody>
            {CHARACTERISTICS.map((key) => {
              const entry = character.characteristics[key]
              const value = current(entry)
              return (
                <tr key={key} data-testid={`char-${key}`} className={isOverridden(entry) ? 'overridden' : undefined}>
                  <th scope="row">{key}</th>
                  <td>{entry.rolled}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={15}
                      aria-label={`${key} value`}
                      value={value}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber
                        setCharacter((c) => overrideCharacteristic(c, key, Number.isNaN(n) ? undefined : n))
                      }}
                    />
                  </td>
                  <td data-testid={`dm-${key}`}>{formatDM(characteristicDM(value))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
  )
}
