import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { careerErrors, careers as bundledCareers } from './data/careers'
import { education as bundledEducation, educationErrors } from './data/education'
import { formatPackRefs, parsePackRefs } from './engine/career-pack'
import { CareerData } from './CareerData'
import { Career } from './Career'
import { useCareerPacks } from './use-career-packs'
import { FAIR_USE_DISCLAIMER } from './legal'
import { SeedBar } from './SeedBar'
import { HUMAN, applySpecies, dropMatchingOverrides, speciesBase, speciesModifier } from './engine/species'
import { browserStorage } from './storage/career-packs'
import { readSavedSpecies, writeSavedSpecies } from './storage/species'

/** Returns the trimmed ?seed= value from the page URL, or a new random seed when it is missing or empty. */
function initialSeed(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('seed')?.trim()
  return fromUrl ? fromUrl : randomSeed()
}

/**
 * Returns the ?packs= value from the page URL in the form formatPackRefs writes, or undefined when
 * the URL has no ?packs= value.
 */
function initialPacksParam(): string | undefined {
  const value = new URLSearchParams(window.location.search).get('packs')
  return value === null ? undefined : formatPackRefs(parsePackRefs(value))
}

/**
 * Sets ?seed= to `seed` and ?packs= to `packs` in the address bar, without adding a history entry.
 * Removes ?packs= when `packs` is empty. Does nothing when both already match.
 */
function writeParamsToUrl(seed: string, packs: string): void {
  const url = new URL(window.location.href)
  const currentPacks = url.searchParams.get('packs') ?? ''
  if (url.searchParams.get('seed') === seed && currentPacks === packs) return
  url.searchParams.set('seed', seed)
  if (packs === '') url.searchParams.delete('packs')
  else url.searchParams.set('packs', packs)
  window.history.replaceState(null, '', url)
}

/** Returns a dice modifier as text with an explicit sign for positive values, e.g. "+2", "0", "-1". */
function formatDM(dm: number): string {
  return dm > 0 ? `+${dm}` : String(dm)
}

interface CharacteristicRowProps {
  name: Characteristic
  /** The characteristic after applySpecies: `rolled` is the modified value. */
  entry: Overridable<number>
  /** The dice total. */
  dice: number
  /** The species modifier, or undefined when the Species column is hidden. */
  modifier: number | undefined
  onOverride: (value: number | undefined) => void
}

/**
 * Renders one characteristic as a table row. The input keeps its own draft text, so the player can
 * clear it and type a new number. Each in-range whole number typed is applied straight away. When the
 * field loses focus or Enter is pressed, any other number is applied after rounding and clamping, and
 * empty or non-numeric text is replaced by the current value. The Reset button removes the override.
 * The Roll cell shows the dice total, and a Species cell shows the modifier when `modifier` is set.
 */
function CharacteristicRow({ name, entry, dice, modifier, onOverride }: CharacteristicRowProps) {
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
      <td>{dice}</td>
      {modifier !== undefined && <td data-testid={`species-mod-${name}`}>{formatDM(modifier)}</td>}
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
              aria-label={modifier === undefined || modifier === 0 ? `Reset ${name} to rolled value` : `Reset ${name} to modified value`}
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
 * Renders the seed bar (the current seed with Copy seed and Clear seed), the characteristics table, the Career section, the Career data section, the list of careers, any career file
 * errors, and a footer with Mongoose Publishing's Fair Use disclaimer. The current seed is kept in
 * the URL's ?seed= value and the loaded packs in ?packs=. Reroll and Clear seed each pick a new
 * random seed and roll a new character, as opening the page without a ?seed= value does; career input
 * saved for the old seed stays saved. When the page was opened with a ?packs= value that differs from the loaded packs, a
 * notice lists both and the address bar keeps the link's ?packs= value until they match; rolling
 * still works. The Species select applies the picked species' modifiers to the characteristics shown
 * and passed to the Career section; the species is saved per seed, and Reroll and Clear seed keep it.
 */
export default function App() {
  const [character, setCharacter] = useState<Character>(() => newCharacter(initialSeed()))
  const [expectedPacks] = useState(initialPacksParam)
  const [storage] = useState(() => browserStorage())
  const [picked, setPicked] = useState(() => ({ seed: character.seed, id: readSavedSpecies(storage, character.seed) }))
  const packs = useCareerPacks(bundledCareers, bundledEducation)
  let speciesId = picked.id
  // A new seed reads the species saved for it.
  if (picked.seed !== character.seed) {
    speciesId = readSavedSpecies(storage, character.seed)
    setPicked({ seed: character.seed, id: speciesId })
  }
  const found = packs.species.find((s) => s.id === speciesId)
  const species = found ?? HUMAN
  const missingSpecies = found === undefined ? speciesId : undefined
  const showModifiers = CHARACTERISTICS.some((key) => speciesModifier(species, key) !== 0)
  const [speciesSaveFailed, setSpeciesSaveFailed] = useState(false)
  // When the species in use changes (a pick, or a pack that defines the saved species loading), overrides
  // equal to the new modified values are removed, so no override is kept that the table doesn't show.
  const [overridesSpecies, setOverridesSpecies] = useState(species.id)
  if (overridesSpecies !== species.id) {
    setOverridesSpecies(species.id)
    setCharacter((c) => ({ ...c, characteristics: dropMatchingOverrides(c.characteristics, species) }))
  }
  const pickSpecies = (id: string) => {
    setSpeciesSaveFailed(writeSavedSpecies(storage, character.seed, id) === 'failed')
    setPicked({ seed: character.seed, id })
  }
  // Reroll and Clear seed both start a new character from a new random seed, keeping the species in use.
  // A saved species that no loaded pack defines is not carried, since the character is shown as Human.
  const speciesInUse = species.id
  const rollNewCharacter = useCallback(() => {
    const seed = randomSeed()
    setSpeciesSaveFailed(writeSavedSpecies(storage, seed, speciesInUse) === 'failed')
    setPicked({ seed, id: speciesInUse })
    setCharacter(newCharacter(seed))
  }, [storage, speciesInUse])
  const showingSample = packs.entries.length === 0
  const shown = useMemo(() => applySpecies(character.characteristics, species), [character.characteristics, species])
  const base = useMemo(() => speciesBase(character.characteristics, species), [character.characteristics, species])

  const mismatch = expectedPacks !== undefined && expectedPacks !== packs.packsParam
  // While the loaded packs differ from the link's ?packs=, the link's value stays in the address bar,
  // so a reload or bookmark still shows the notice.
  const urlPacks = mismatch ? expectedPacks : packs.packsParam

  useEffect(() => {
    writeParamsToUrl(character.seed, urlPacks)
  }, [character.seed, urlPacks])

  return (
    <>
      <main>
        <header>
          <h1>Traveller Character Generator</h1>
          <p className="muted">Unofficial fan tool for Mongoose Traveller 2nd Edition.</p>
          <SeedBar seed={character.seed} onClear={rollNewCharacter} />
        </header>

        {careerErrors.length + educationErrors.length > 0 && (
          <section role="alert" className="errors" aria-labelledby="errors-heading">
            <h2 id="errors-heading">Career file problems</h2>
            <ul>
              {[...careerErrors, ...educationErrors].map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        )}

        {mismatch && (
          <section className="notice" data-testid="pack-mismatch" aria-labelledby="mismatch-heading">
            <h2 id="mismatch-heading">Different career packs</h2>
            <p>
              This link was made with other career packs than the ones loaded here, so results may not match the
              referee's. The link keeps its pack list until the loaded packs match it.
            </p>
            <p>
              Link: <code>{expectedPacks || 'none'}</code>
              <br />
              Loaded: <code>{packs.packsParam || 'none'}</code>
            </p>
          </section>
        )}

        <section aria-labelledby="chars-heading">
          <div className="row">
            <h2 id="chars-heading">Characteristics</h2>
            <button type="button" onClick={rollNewCharacter}>
              Reroll
            </button>
          </div>
          <label className="species-pick">
            Species
            <select value={speciesId} onChange={(e) => pickSpecies(e.target.value)}>
              {packs.species.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {missingSpecies !== undefined && <option value={missingSpecies}>{missingSpecies} (not loaded)</option>}
            </select>
          </label>
          {speciesSaveFailed && (
            <p className="notice small" data-testid="species-save-failed">
              The species could not be saved in this browser. It stays until the page closes.
            </p>
          )}
          {missingSpecies !== undefined && (
            <p className="notice" data-testid="missing-species">
              The species "{missingSpecies}" saved for this seed is not in any loaded career pack. The character is
              shown as Human until a pack that defines it is loaded.
            </p>
          )}
          <p aria-live="polite">
            UPP <strong data-testid="upp">{upp(shown)}</strong>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <abbr title="Characteristic">Char</abbr>
                  </th>
                  <th scope="col">Roll</th>
                  {showModifiers && <th scope="col">Species</th>}
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
                    entry={shown[key]}
                    dice={character.characteristics[key].rolled}
                    modifier={showModifiers ? speciesModifier(species, key) : undefined}
                    onOverride={(value) => setCharacter((c) => overrideCharacteristic(c, key, value, species))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {species.traits.length > 0 && (
            <div data-testid="species-traits">
              <h3>{species.name} traits</h3>
              <ul>
                {species.traits.map((t) => (
                  <li key={t.name}>
                    <strong>{t.name}:</strong> {t.summary}
                  </li>
                ))}
              </ul>
              <p className="muted">Source: {species.source}</p>
            </div>
          )}
        </section>

        <Career
          seed={character.seed}
          base={base}
          careers={packs.careers}
          education={packs.education}
          rules={packs.rules}
          packs={packs.packsParam}
        />

        <CareerData packs={packs} />

        <section aria-labelledby="careers-heading">
          <h2 id="careers-heading">Careers loaded</h2>
          <ul data-testid="career-list">
            {packs.careers.map((c) => (
              <li key={c.id}>
                {showingSample && <span className="badge">Sample</span>} <strong>{c.name}</strong>{' '}
                <span className="muted">{c.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer>
        <p className="muted">Unofficial fan project, not affiliated with or endorsed by Mongoose Publishing.</p>
        <p className="muted" data-testid="fair-use-disclaimer">
          {FAIR_USE_DISCLAIMER}
        </p>
      </footer>
    </>
  )
}
