import { useEffect, useId, useRef, useState } from 'react'
import type { Characteristic } from './engine/characteristics'
import type { CareerDefinition } from './engine/career-schema'
import type { SelectedRules } from './engine/career-pack'
import type { Rules } from './engine/rules-schema'
import { current } from './engine/overridable'
import { POLICY_SUMMARY } from './engine/policy'
import {
  skillTableName,
  stepOverridden,
  type CareerInput,
  type CareerRun,
  type PendingChoice,
  type Step,
  type TermResult,
} from './engine/terms'
import { useCareer } from './use-career'

/** Returns a DM as text with a sign, e.g. "+1", "+0", "-2". */
function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n)
}

/** Returns a copy of `record` with `key` set to `value`, or removed when `value` is undefined. */
function setKey<T>(record: Record<string, T>, key: string, value: T | undefined): Record<string, T> {
  const next = { ...record }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

interface StepRowProps {
  step: Step
  /** Prefix for the step's accessible names, e.g. "Term 2". */
  context: string
  input: CareerInput
  onChange: (next: CareerInput) => void
}

/**
 * Renders one step: its label, target, dice (an input that overrides the dice total), DM, total
 * and result. Checks also get a Result select (Rolled, Pass, Fail) that overrides the outcome.
 * Overridden steps show an Overridden badge and a Reset button that removes both overrides.
 */
function StepRow({ step, context, input, onChange }: StepRowProps) {
  const name = `${context} ${step.label}`
  const overridden = stepOverridden(step)
  const diceValue = step.dice === undefined ? undefined : current(step.dice)
  const [draft, setDraft] = useState(diceValue === undefined ? '' : String(diceValue))
  const [shown, setShown] = useState(diceValue)
  if (shown !== diceValue) {
    setShown(diceValue)
    setDraft(diceValue === undefined ? '' : String(diceValue))
  }
  const min = step.diceCount ?? 1
  const max = (step.diceCount ?? 1) * 6

  return (
    <li className={`step${overridden ? ' overridden' : ''}`} data-testid={`step-${step.key}`}>
      <div className="step-main">
        <span className="step-label">{step.label}</span>
        {step.characteristic !== undefined && step.target !== undefined && (
          <span className="muted">
            {step.characteristic} {step.target}+
          </span>
        )}
        {step.dice !== undefined && (
          <span className="step-roll">
            <label>
              <span className="visually-hidden">{name} dice</span>
              <span aria-hidden="true">{step.diceCount}D </span>
              <input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                value={draft}
                onChange={(e) => {
                  const text = e.target.value
                  setDraft(text)
                  const n = Number(text)
                  if (text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) {
                    onChange({ ...input, rolls: setKey(input.rolls, step.key, n === step.dice?.rolled ? undefined : n) })
                  }
                }}
                onBlur={() => setDraft(diceValue === undefined ? '' : String(diceValue))}
              />
            </label>
            <span>
              {signed(step.dm ?? 0)} = <strong data-testid="step-total">{step.total}</strong>
            </span>
          </span>
        )}
        {step.passed !== undefined && (
          <label className="step-outcome">
            <span className="visually-hidden">{name} result</span>
            <select
              value={input.outcomes[step.key] ?? 'rolled'}
              onChange={(e) => {
                const v = e.target.value
                onChange({
                  ...input,
                  outcomes: setKey(input.outcomes, step.key, v === 'pass' || v === 'fail' ? v : undefined),
                })
              }}
            >
              <option value="rolled">As rolled</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
          </label>
        )}
        <span className="step-result" data-testid="step-result">
          {step.passed !== undefined ? (current(step.passed) ? 'Pass' : 'Fail') : step.result}
          {step.outOfRange && <span className="muted"> (total outside the table; nearest row used)</span>}
        </span>
        {step.connection && (
          <span className="badge connection" data-testid="connection-marker">
            Connection
          </span>
        )}
        {overridden && (
          <>
            <span className="badge">Overridden</span>
            <button
              type="button"
              className="secondary"
              aria-label={`Reset ${name}`}
              onClick={() =>
                onChange({
                  ...input,
                  rolls: setKey(input.rolls, step.key, undefined),
                  outcomes: setKey(input.outcomes, step.key, undefined),
                })
              }
            >
              Reset
            </button>
          </>
        )}
      </div>
      {step.applied.length > 0 && <div className="step-applied">Applied: {step.applied.join(', ')}</div>}
      {step.reasons.map((r, i) => (
        <div className="step-reason" key={`${i}-${r}`} data-testid="step-reason">
          {r}
        </div>
      ))}
      {step.notes.map((n) => (
        <div className="step-note" key={n}>
          Apply by hand: {n}
        </div>
      ))}
    </li>
  )
}

/**
 * Returns the text of the anagathics info tip, built from the pack's `anagathics` rules: what the
 * drugs are and what the app does while a term takes them.
 */
/** Returns a cost as shown to the player: "<dice>D × Cr<perDie>, taken from cash (a debt if cash runs out)". */
function cashCost(dice: number, perDie: number): string {
  return `${dice}D × Cr${perDie}, taken from cash (a debt if cash runs out)`
}

function anagathicsInfo(drugs: NonNullable<Rules['anagathics']>): string {
  return (
    `Anagathics are drugs that slow ageing. Tick the box to take them in this term. Starting needs ${drugs.characteristic} ${drugs.target}+. ` +
    `Each term on them costs ${cashCost(drugs.costDice, drugs.costPerDie)}, ` +
    'needs a second survival roll (either failure is a mishap), and adds +1 to the aging roll for each term taken in a row. ' +
    'A term without them after a term with them rolls aging at once.'
  )
}

interface InfoTipProps {
  /** The accessible name of the button, e.g. "About anagathics". */
  label: string
  text: string
}

/**
 * Renders an "i" button that shows `text` in a tooltip while a mouse pointer is over it, and toggles
 * it on click or tap (a click while it is shown hides it). Escape anywhere, a press outside the tip,
 * or moving focus away hides it.
 */
function InfoTip({ label, text }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const id = useId()
  const root = useRef<HTMLSpanElement>(null)
  const shown = open || hover
  useEffect(() => {
    if (!shown) return undefined
    const hide = () => {
      setOpen(false)
      setHover(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    const onPress = (e: PointerEvent) => {
      if (e.target instanceof Node && root.current?.contains(e.target)) return
      hide()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [shown])
  return (
    <span
      className="info-tip"
      ref={root}
      // Only a mouse hovers; a touch would otherwise show the tip on touch and hide it on the click that follows.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setHover(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHover(false)
      }}
    >
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-describedby={shown ? id : undefined}
        onClick={() => {
          if (shown) {
            setOpen(false)
            setHover(false)
          } else {
            setOpen(true)
          }
        }}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {shown && (
        <span role="tooltip" id={id} className="info-tip-text">
          {text}
        </span>
      )}
    </span>
  )
}

interface TermProps {
  term: TermResult
  /** The rules' anagathics values, which add the Anagathics checkbox and its info tip, or undefined. */
  anagathics: Rules['anagathics']
  input: CareerInput
  onChange: (next: CareerInput) => void
}

/**
 * Renders one term: its age range and rank, an Anagathics checkbox when the rules allow them, its
 * steps, why the career ends (if it does), and a notes field.
 */
function Term({ term, anagathics, input, onChange }: TermProps) {
  const notesKey = `term-${term.number}`
  const drugsKey = `${term.key}.anagathics`
  return (
    <li className="term" data-testid={`term-${term.number}`}>
      <div className="term-head">
        <h3>Term {term.number}</h3>
        <span className="muted" data-testid="term-age">
          age {term.ageStart}-{term.ageEnd}
        </span>
        <span data-testid="term-rank">
          {term.officer ? 'officer rank' : 'rank'} {term.rank}
          {term.title ? ` ${term.title}` : ''}
        </span>
        {anagathics && (
          <span className="term-anagathics">
            <label>
              <input
                type="checkbox"
                checked={input.choices[drugsKey] === 'take'}
                onChange={(e) => onChange({ ...input, choices: setKey(input.choices, drugsKey, e.target.checked ? 'take' : undefined) })}
              />{' '}
              Anagathics<span className="visually-hidden"> in term {term.number}</span>
            </label>
            <InfoTip label="About anagathics" text={anagathicsInfo(anagathics)} />
          </span>
        )}
      </div>
      <ul className="steps" data-testid="term-steps">
        {term.steps.map((step) => (
          <StepRow key={step.key} step={step} context={`Term ${term.number}`} input={input} onChange={onChange} />
        ))}
      </ul>
      {term.endReason && <p className="notice">{term.endReason}</p>}
      <label className="term-notes">
        Term {term.number} notes
        <textarea
          rows={2}
          value={input.notes[notesKey] ?? ''}
          onChange={(e) => onChange({ ...input, notes: setKey(input.notes, notesKey, e.target.value) })}
        />
      </label>
    </li>
  )
}

interface PendingProps {
  pending: PendingChoice
  input: CareerInput
  onChange: (next: CareerInput) => void
  onGenerate: () => void
}

/** Renders the controls for the choice the career needs next. The start choice is rendered by StartForm. */
function Pending({ pending, input, onChange, onGenerate }: PendingProps) {
  const choose = (key: string, value: string) => onChange({ ...input, choices: { ...input.choices, [key]: value } })
  const generate = (
    <>
      <button type="button" className="secondary" onClick={onGenerate}>
        Finish career
      </button>
      <p className="muted small" data-testid="policy-note">
        {POLICY_SUMMARY}
      </p>
    </>
  )
  switch (pending.kind) {
    case 'start':
      return null
    case 'fallback':
      return (
        <div className="pending" role="group" aria-label="Qualification failed">
          <p>Qualification failed. Override the roll, or:</p>
          {pending.draftAllowed && (
            <button type="button" onClick={() => choose(pending.key, 'draft')}>
              Take the Draft
            </button>
          )}
          {pending.fallback !== undefined && (
            <button type="button" onClick={() => choose(pending.key, 'fallback')}>
              Enter {pending.fallback}
            </button>
          )}
        </div>
      )
    case 'assignment':
      return (
        <div className="pending" role="group" aria-label="Choose an assignment">
          <p>Choose an assignment in {pending.careerName}:</p>
          {pending.options.map((o) => (
            <button type="button" key={o.id} onClick={() => choose(pending.key, o.id)}>
              {o.name}
            </button>
          ))}
        </div>
      )
    case 'commission':
      return (
        <div className="pending" role="group" aria-label="Commission">
          <p>A commission can be tried this term instead of the advancement roll.</p>
          <button type="button" onClick={() => choose(pending.key, 'try')}>
            Try for commission
          </button>
          <button type="button" onClick={() => choose(pending.key, 'skip')}>
            Skip commission
          </button>
          {generate}
        </div>
      )
    case 'characteristic':
      return (
        <div className="pending" role="group" aria-label="Choose a characteristic">
          <p>Reduce which characteristic by {pending.amount}?</p>
          {pending.options.map((c) => (
            <button type="button" key={c} onClick={() => choose(pending.key, c)}>
              {c}
            </button>
          ))}
          {generate}
        </div>
      )
    case 'ageing-crisis':
      return (
        <div className="pending" role="group" aria-label="Ageing crisis">
          <p data-testid="ageing-crisis-notice">
            Ageing crisis: {pending.characteristics.join(', ')} at 0 or below. Medical care costs{' '}
            {cashCost(pending.costDice, pending.costPerDie)}; it brings them back to 1, and every later
            qualification roll fails. Without it the character dies. You can also override the aging dice.
          </p>
          <button type="button" onClick={() => choose(pending.key, 'care')}>
            Pay for medical care
          </button>
          <button type="button" onClick={() => choose(pending.key, 'die')}>
            The character dies
          </button>
        </div>
      )
    case 'skill-table':
      return (
        <div className="pending" role="group" aria-label="Choose a skill table">
          <p>Choose a skill table to roll on:</p>
          {pending.options.map((t) => (
            <button type="button" key={t} onClick={() => choose(pending.key, t)}>
              {skillTableName(t)}
            </button>
          ))}
          {generate}
        </div>
      )
    case 'skill-option':
      return (
        <div className="pending" role="group" aria-label="Choose a skill">
          <p>Choose a skill:</p>
          {pending.options.map((o) => (
            <button type="button" key={o} onClick={() => choose(pending.key, o)}>
              {o}
            </button>
          ))}
          {generate}
        </div>
      )
    case 'wager':
      return (
        <div className="pending" role="group" aria-label="Wager benefit rolls">
          <p>
            Wager benefit rolls on {pending.skills.join(' or ')} {pending.target}+? Success gains half the wager (rounded
            up); failure loses it.
          </p>
          {Array.from({ length: pending.max + 1 }, (_, n) => (
            <button type="button" key={n} onClick={() => choose(pending.key, String(n))}>
              {n === 0 ? 'Wager nothing' : `Wager ${n}`}
            </button>
          ))}
          {generate}
        </div>
      )
    case 'next':
      if (pending.forced === 'muster') {
        return (
          <div className="pending" role="group" aria-label="End of career">
            <p>{pending.reason}</p>
            <button type="button" onClick={() => choose(pending.key, 'muster')}>
              Muster out
            </button>
            {generate}
          </div>
        )
      }
      return (
        <div className="pending" role="group" aria-label="After this term">
          {pending.reason !== undefined && <p>{pending.reason}</p>}
          <button type="button" onClick={() => choose(pending.key, 'continue')}>
            Continue in career
          </button>
          {pending.forced === undefined && (
            <button type="button" onClick={() => choose(pending.key, 'leave')}>
              Leave career
            </button>
          )}
          {generate}
        </div>
      )
    case 'benefit':
      return (
        <div className="pending" role="group" aria-label="Mustering out">
          <p>
            Benefit roll {pending.index + 1} of {pending.count}: roll on which table?
          </p>
          <button type="button" disabled={!pending.cashAllowed} onClick={() => choose(pending.key, 'cash')}>
            Cash
          </button>
          <button type="button" onClick={() => choose(pending.key, 'benefit')}>
            Benefit
          </button>
          {!pending.cashAllowed && <p className="muted small">The cash roll limit has been reached.</p>}
          {generate}
        </div>
      )
  }
}

interface StartFormProps {
  careers: CareerDefinition[]
  /** The key prefix of the career's choices: "" for the first career. */
  prefix: string
  /** Career ids that can't be picked. */
  exclude: string[]
  input: CareerInput
  onChange: (next: CareerInput) => void
}

/**
 * Renders the career and assignment pickers and the start button. For the first career (prefix "")
 * starting replaces every choice and override; for a later career it replaces only the choices and
 * overrides whose keys start with `prefix`.
 */
function StartForm({ careers, prefix, exclude, input, onChange }: StartFormProps) {
  const [pickedCareer, setPickedCareer] = useState('')
  const [pickedAssignment, setPickedAssignment] = useState('')
  const offered = careers.filter((c) => !exclude.includes(c.id))
  const selected = offered.find((c) => c.id === pickedCareer) ?? offered[0]
  const assignment = selected?.assignments.find((a) => a.id === pickedAssignment) ?? selected?.assignments[0]
  const without = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([k]) => !k.startsWith(prefix)))
  return (
    <form
      className="career-start"
      onSubmit={(e) => {
        e.preventDefault()
        if (!selected || !assignment) return
        const picks = { [`${prefix}start.career`]: selected.id, [`${prefix}start.assignment`]: assignment.id }
        onChange(
          prefix === ''
            ? { ...input, choices: picks, rolls: {}, outcomes: {} }
            : { ...input, choices: { ...without(input.choices), ...picks }, rolls: without(input.rolls), outcomes: without(input.outcomes) },
        )
      }}
    >
      <label>
        Career
        <select value={selected?.id ?? ''} onChange={(e) => setPickedCareer(e.target.value)}>
          {offered.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignment
        <select value={assignment?.id ?? ''} onChange={(e) => setPickedAssignment(e.target.value)}>
          {selected?.assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={!selected || !assignment}>
        {prefix === '' ? 'Start career' : 'Start next career'}
      </button>
    </form>
  )
}

interface RunProps {
  run: CareerRun
  /** The rules' anagathics values, or undefined when the rules have none. */
  anagathics: Rules['anagathics']
  input: CareerInput
  onChange: (next: CareerInput) => void
}

/**
 * Renders one career entered: its name and assignment (with a heading from the second career on),
 * the qualification roll, how a Draft or fallback career was entered, its terms and its mustering out.
 */
function Run({ run, anagathics, input, onChange }: RunProps) {
  const context = run.index === 1 ? 'Career' : `Career ${run.index}`
  return (
    <div className="career-run" data-testid={`career-run-${run.index}`}>
      {run.index > 1 && <h3>Career {run.index}</h3>}
      <p data-testid="career-name">
        <strong>{run.career.name}</strong>
        {run.assignment ? ` / ${run.assignment.name}` : ''}
      </p>
      <ul className="steps">
        <StepRow step={run.qualification} context={context} input={input} onChange={onChange} />
        {run.draft && <StepRow step={run.draft} context={context} input={input} onChange={onChange} />}
      </ul>
      {run.entry !== 'qualified' && (
        <p className="notice small" data-testid="career-entry">
          Qualification for {run.applied.name} failed.{' '}
          {run.entry === 'draft' ? `Drafted into ${run.career.name}.` : `Entered ${run.career.name} instead.`}
        </p>
      )}
      {run.terms.length > 0 && (
        <ol className="terms">
          {run.terms.map((t) => (
            <Term key={t.number} term={t} anagathics={anagathics} input={input} onChange={onChange} />
          ))}
        </ol>
      )}
      {run.benefits.length > 0 && (
        <div data-testid={run.index === 1 ? 'benefits' : `benefits-${run.index}`}>
          <h3>Mustering out</h3>
          <ul className="steps">
            {run.benefits.map((b) => (
              <StepRow key={b.step.key} step={b.step} context={run.index === 1 ? 'Mustering out' : `${context} mustering out`} input={input} onChange={onChange} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Props for the Career section. */
export interface CareerProps {
  seed: string
  base: Record<Characteristic, number>
  careers: CareerDefinition[]
  rules: SelectedRules
  packs: string
}

/**
 * Renders the Career section (docs/features/career-terms.md and career-rules.md): career and
 * assignment pickers, then each career entered with its qualification roll, terms, steps, notes and
 * mustering out, the controls for the next choice, the finished character's summary and connection
 * opportunities, and the optional next-career picker.
 */
export function Career({ seed, base, careers, rules, packs }: CareerProps) {
  const career = useCareer(seed, base, careers, rules.rules, packs)
  const { input, result, update } = career
  const pending = result.pending
  const changes = Object.entries(result.characteristicChanges).filter(([, v]) => v !== 0)

  return (
    <section aria-labelledby="career-heading" data-testid="career">
      <h2 id="career-heading">Career</h2>

      {rules.packName === undefined ? (
        <p className="notice small" data-testid="sample-rules-notice">
          Using invented sample rules values (starting age, term length, aging and benefits). Load a career pack with
          rules for real values.
        </p>
      ) : (
        rules.differ && (
          <p className="notice small" data-testid="rules-notice">
            The loaded packs have different rules. Using the rules from "{rules.packName}".
          </p>
        )
      )}

      {career.savedFromOtherPacks ? (
        <div className="notice" data-testid="saved-choices-notice">
          <p>This character's saved choices were made with other career packs, so they have not been applied.</p>
          <button type="button" onClick={career.applySaved}>
            Apply anyway
          </button>{' '}
          <button type="button" className="secondary" onClick={career.discardSaved}>
            Start over
          </button>
        </div>
      ) : (
        <>
          {result.problems.length > 0 && (
            <div className="notice" data-testid="career-problems">
              <ul>
                {result.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {career.removedCount > 0 && (
            <p className="notice small" data-testid="removed-notice">
              That change removed {career.removedCount} later choice{career.removedCount === 1 ? '' : 's'} or
              override{career.removedCount === 1 ? '' : 's'} that no longer apply.
            </p>
          )}
          {career.saveFailed && (
            <p className="notice small" data-testid="career-save-failed">
              This character could not be saved in this browser. It stays until the page closes.
            </p>
          )}

          {result.runs.length === 0 && pending?.kind !== 'start' && (
            <StartForm careers={careers} prefix="" exclude={[]} input={input} onChange={update} />
          )}
          {result.runs.map((run) => (
            <Run key={run.index} run={run} anagathics={rules.rules.anagathics} input={input} onChange={update} />
          ))}
          {pending?.kind === 'start' && (
            <>
              {pending.failedQualification && (
                <p className="notice" data-testid="qualification-failed">
                  Qualification failed. Override the roll, or pick a career and start again.
                </p>
              )}
              <StartForm
                key={pending.prefix}
                careers={careers}
                prefix={pending.prefix}
                exclude={pending.exclude}
                input={input}
                onChange={update}
              />
            </>
          )}

          {pending && pending.kind !== 'start' && (
            <>
              {pending.kind === 'next' && result.terms[result.terms.length - 1]?.ageingCrisis && (
                <p className="notice" data-testid="ageing-crisis-notice">
                  Term {result.terms.length} ended in an ageing crisis, so Finish career stopped here. Resolve it by hand
                  before going on.
                </p>
              )}
              <Pending pending={pending} input={input} onChange={update} onGenerate={career.generate} />
            </>
          )}

          {result.finished && (
            <div className="summary" data-testid="career-summary">
              <h3>Finished character</h3>
              {result.dead && (
                <p className="notice" data-testid="summary-dead">
                  The character died in an ageing crisis.
                </p>
              )}
              {result.costs > 0 && (
                <p data-testid="summary-costs">
                  Anagathics and medical care cost Cr{result.costs}, taken from cash
                  {result.cash < 0 ? `, leaving a debt of Cr${-result.cash}` : ''}.
                </p>
              )}
              <p>
                Age <strong data-testid="summary-age">{result.age}</strong>,{' '}
                {result.runs[result.runs.length - 1]?.officerRank !== undefined ? 'officer rank' : 'rank'} {result.rank}
                {result.title ? ` ${result.title}` : ''}, cash <strong data-testid="summary-cash">Cr{result.cash}</strong>
              </p>
              {result.runs.length > 1 && (
                <p data-testid="summary-careers">
                  Careers:{' '}
                  {result.runs
                    .map((r) => `${r.career.name} (${r.terms.length} term${r.terms.length === 1 ? '' : 's'})`)
                    .join(', ')}
                </p>
              )}
              <p data-testid="summary-skills">
                Skills:{' '}
                {Object.entries(result.skills)
                  .map(([s, l]) => `${s} ${l}`)
                  .join(', ') || 'none'}
              </p>
              {changes.length > 0 && (
                <p data-testid="summary-changes">
                  Characteristic changes: {changes.map(([c, v]) => `${c} ${signed(v)}`).join(', ')}
                </p>
              )}
              <p data-testid="summary-benefits">
                Benefits:{' '}
                {result.benefits
                  .flatMap((b) => (b.benefit ? [b.benefit] : []))
                  .join(', ') || 'none'}
              </p>
              <h3>Connection opportunities</h3>
              {result.connections.length === 0 ? (
                <p className="muted" data-testid="connections-empty">
                  No events in these careers were marked as connection opportunities.
                </p>
              ) : (
                <ul data-testid="connections">
                  {result.connections.map((c) => (
                    <li key={`${c.term}-${c.label}-${c.summary}`}>
                      Term {c.term}, {c.label}: {c.summary}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {result.nextCareer && (
            <div className="next-career" data-testid="next-career">
              <h3>Next career</h3>
              <p className="muted small">
                Optional. The character can enter another career; {result.runs[result.runs.length - 1]?.career.name ?? 'the career just left'}{' '}
                can't be entered again straight away.
              </p>
              <StartForm
                key={result.nextCareer.prefix}
                careers={careers}
                prefix={result.nextCareer.prefix}
                exclude={result.nextCareer.exclude}
                input={input}
                onChange={update}
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}
