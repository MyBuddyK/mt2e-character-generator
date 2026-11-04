import { useEffect, useId, useRef, useState } from 'react'
import type { Characteristic } from './engine/characteristics'
import type { CareerDefinition } from './engine/career-schema'
import type { EducationDefinition } from './engine/education-schema'
import type { SelectedRules } from './engine/career-pack'
import type { Rules } from './engine/rules-schema'
import { current } from './engine/overridable'
import { POLICY_SUMMARY } from './engine/policy'
import {
  canPick,
  laterRollsText,
  skillTableName,
  stepOverridden,
  type CareerInput,
  type CareerRun,
  type EducationOption,
  type EducationRecord,
  type LaterDM,
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
      {step.later?.map((held) => (
        <LaterDMRow key={held.key} held={held} name={name} input={input} onChange={onChange} />
      ))}
    </li>
  )
}

interface LaterDMRowProps {
  held: LaterDM
  /** The accessible name of the step that gave the DM, e.g. "Term 2 Event". */
  name: string
  input: CareerInput
  onChange: (next: CareerInput) => void
}

/**
 * Renders a DM from a `dm-later` effect: a select labelled "<step> DM <n> applies to" that lists "Not
 * applied" and each later roll the DM can be applied to. Picking a roll stores its step key under the
 * DM's choice key; "Not applied" removes it. Before any such roll has been rolled it says so.
 */
function LaterDMRow({ held, name, input, onChange }: LaterDMRowProps) {
  const label = `${name} DM ${signed(held.dm)} applies to`
  return (
    <div className="step-later" data-testid="later-dm">
      <label>
        DM {signed(held.dm)} for {laterRollsText(held.rolls)}, applied by hand:{' '}
        <select
          aria-label={label}
          value={held.appliedTo ?? ''}
          onChange={(e) => onChange({ ...input, choices: setKey(input.choices, held.key, e.target.value === '' ? undefined : e.target.value) })}
        >
          <option value="">Not applied</option>
          {held.targets.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {held.targets.length === 0 && <span className="muted small"> Pick the roll here once it has been rolled.</span>}
    </div>
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
 * Renders an "i" button that shows `text` in a tooltip while a mouse pointer is over it. A click or tap
 * pins the tip open, and a click or tap while it is pinned hides it. Whether a click pins or hides
 * depends only on the pin, not on the hover, so a mouse click on a tip shown by hover pins it. Escape
 * anywhere, a press outside the tip, or moving focus away hides it.
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
          if (open) {
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
  /** Removes this term; set only for the most recent term, which then shows a Remove term button. */
  onRemove: (() => void) | undefined
}

/**
 * Renders one term: its age range and rank, an Anagathics checkbox when the rules allow them, its
 * steps, why the career ends (if it does), a notes field, and a Remove term button when `onRemove` is set.
 */
function Term({ term, anagathics, input, onChange, onRemove }: TermProps) {
  const notesKey = `term-${term.number}`
  const drugsKey = `${term.key}.anagathics`
  return (
    <li className="term" data-testid={`term-${term.number}`}>
      <div className="term-head">
        <h3>Term {term.number}</h3>
        <span className="muted" data-testid="term-age">
          age {term.ageStart}-{term.ageEnd}
        </span>
        {term.education === undefined ? (
          <span data-testid="term-rank">
            {term.officer ? 'officer rank' : 'rank'} {term.rank}
            {term.title ? ` ${term.title}` : ''}
          </span>
        ) : (
          <span data-testid="term-education">{term.education}</span>
        )}
        {anagathics && term.education === undefined && (
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
      {onRemove && (
        <button type="button" className="secondary remove-term" data-testid="remove-term" onClick={onRemove}>
          Remove term {term.number}
        </button>
      )}
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
    case 'event-choice':
      return (
        <div className="pending" role="group" aria-label="Choose an option">
          <p data-testid="event-choice">
            {pending.source}: {pending.summary} Choose one:
          </p>
          {pending.options.map((o) => (
            <button type="button" key={o} onClick={() => choose(pending.key, o)}>
              {o}
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
  /** Education entries that can be picked instead of a career, stored as "education:<id>". */
  education: EducationOption[]
  /** The key prefix of the career's choices: "" for the first career. */
  prefix: string
  /** Career ids that can't be picked. */
  exclude: string[]
  input: CareerInput
  onChange: (next: CareerInput) => void
}

/**
 * Renders the career and assignment pickers and the start button. The career picker also lists
 * `education` entries in their own group; picking one hides the assignment picker. For the first
 * career (prefix "") starting replaces every choice and override; for a later career it replaces only
 * the choices and overrides whose keys start with `prefix`.
 */
function StartForm({ careers, education, prefix, exclude, input, onChange }: StartFormProps) {
  const [pickedCareer, setPickedCareer] = useState('')
  const [pickedAssignment, setPickedAssignment] = useState('')
  const offered = careers.filter((c) => canPick(c, exclude))
  const school = education.find((e) => `education:${e.id}` === pickedCareer)
  const selected = school ? undefined : (offered.find((c) => c.id === pickedCareer) ?? offered[0])
  const assignment = selected?.assignments.find((a) => a.id === pickedAssignment) ?? selected?.assignments[0]
  const without = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([k]) => !k.startsWith(prefix)))
  return (
    <form
      className="career-start"
      onSubmit={(e) => {
        e.preventDefault()
        let picks: Record<string, string>
        if (school) picks = { [`${prefix}start.career`]: `education:${school.id}` }
        else if (selected && assignment) picks = { [`${prefix}start.career`]: selected.id, [`${prefix}start.assignment`]: assignment.id }
        else return
        onChange(
          prefix === ''
            ? { ...input, choices: picks, rolls: {}, outcomes: {} }
            : { ...input, choices: { ...without(input.choices), ...picks }, rolls: without(input.rolls), outcomes: without(input.outcomes) },
        )
      }}
    >
      <label>
        Career
        <select value={school ? `education:${school.id}` : (selected?.id ?? '')} onChange={(e) => setPickedCareer(e.target.value)}>
          {education.length > 0 ? (
            <>
              <optgroup label="Careers">
                {offered.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Education">
                {education.map((e) => (
                  <option key={e.id} value={`education:${e.id}`}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            offered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))
          )}
        </select>
      </label>
      {!school && (
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
      )}
      <button type="submit" disabled={!school && (!selected || !assignment)}>
        {school ? 'Start education' : prefix === '' ? 'Start career' : 'Start next career'}
      </button>
    </form>
  )
}

interface EducationBlockProps {
  record: EducationRecord
  input: CareerInput
  onChange: (next: CareerInput) => void
  /** Removes the character's most recent term, passed to the education term when it is the most recent. */
  onRemoveLast: () => void
  /** The number of the character's most recent term. */
  lastTerm: number | undefined
}

/** Returns the text shown for an education outcome, or undefined while the term is still being played. */
function outcomeText(record: EducationRecord): string | undefined {
  switch (record.outcome) {
    case 'failed-entry':
      return `Entry to ${record.education.name} failed. Pick a career for this term.`
    case 'graduated':
      return 'Graduated.'
    case 'honours':
      return 'Graduated with honours.'
    case 'failed':
      return 'Did not graduate.'
    case undefined:
      return undefined
  }
}

/**
 * Renders one education attempt (docs/features/education.md): the school's name, the entry roll, the
 * education term when entry passed, the outcome, and the bonuses graduation gives the next career.
 */
function EducationBlock({ record, input, onChange, onRemoveLast, lastTerm }: EducationBlockProps) {
  const outcome = outcomeText(record)
  return (
    <div className="career-run" data-testid={`education-${record.order}`}>
      <h3>Education</h3>
      <p data-testid="education-name">
        <strong>{record.education.name}</strong>
      </p>
      <ul className="steps">
        <StepRow step={record.entry} context={`Term ${record.number}`} input={input} onChange={onChange} />
      </ul>
      {record.term && (
        <ol className="terms">
          <Term
            term={record.term}
            anagathics={undefined}
            input={input}
            onChange={onChange}
            onRemove={record.term.number === lastTerm ? onRemoveLast : undefined}
          />
        </ol>
      )}
      {outcome && (
        <p className={record.outcome === 'failed-entry' ? 'notice small' : undefined} data-testid="education-outcome">
          {outcome}
        </p>
      )}
      {record.bonuses.length > 0 && (
        <div data-testid="education-bonuses">
          <p>Bonuses for the next career:</p>
          <ul>
            {record.bonuses.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

interface RunProps {
  run: CareerRun
  /** The rules' anagathics values, or undefined when the rules have none. */
  anagathics: Rules['anagathics']
  input: CareerInput
  onChange: (next: CareerInput) => void
  /** Removes the character's most recent term, which Run passes to that term when it is in this career. */
  onRemoveLast: () => void
  /** The number of the character's most recent term. */
  lastTerm: number | undefined
}

/**
 * Renders one career entered: its name and assignment (with a heading from the second career on),
 * the qualification roll, how a Draft or fallback career was entered, its terms and its mustering out.
 */
function Run({ run, anagathics, input, onChange, onRemoveLast, lastTerm }: RunProps) {
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
      {run.forced ? (
        <p className="notice small" data-testid="career-entry">
          {run.entry === 'draft' ? `An event sent the character to the Draft: drafted into ${run.career.name}.` : `An event sent the character to ${run.career.name}.`}
        </p>
      ) : (
        run.entry !== 'qualified' && (
          <p className="notice small" data-testid="career-entry">
            Qualification for {run.applied.name} failed.{' '}
            {run.entry === 'draft' ? `Drafted into ${run.career.name}.` : `Entered ${run.career.name} instead.`}
          </p>
        )
      )}
      {run.terms.length > 0 && (
        <ol className="terms">
          {run.terms.map((t) => (
            <Term
              key={t.number}
              term={t}
              anagathics={run.career.anagathics === false ? undefined : anagathics}
              input={input}
              onChange={onChange}
              onRemove={t.number === lastTerm ? onRemoveLast : undefined}
            />
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
  /** The education entries the career pick can offer (docs/features/education.md). */
  education: EducationDefinition[]
  rules: SelectedRules
  packs: string
}

/**
 * Renders the Career section (docs/features/career-terms.md and career-rules.md): career and
 * assignment pickers, then each career entered with its qualification roll, terms, steps, notes and
 * mustering out, the controls for the next choice, the finished character's summary and connection
 * opportunities, and the optional next-career picker.
 */
export function Career({ seed, base, careers, education, rules, packs }: CareerProps) {
  const career = useCareer(seed, base, careers, rules.rules, education, packs)
  const { input, result, update } = career
  const pending = result.pending
  const changes = Object.entries(result.characteristicChanges).filter(([, v]) => v !== 0)
  // DMs from events that no roll used: dm-later DMs the player didn't apply, and dm-next DMs left over.
  const unusedDMs = [
    ...result.laterDMs.filter((d) => d.appliedTo === undefined).map((d) => `DM ${signed(d.dm)} for ${laterRollsText(d.rolls)} (${d.source})`),
    ...(['advancement', 'survival'] as const).flatMap((roll) =>
      result.unusedNextDMs[roll] === 0 ? [] : [`DM ${signed(result.unusedNextDMs[roll])} on the next ${roll} roll`],
    ),
  ]
  const sectionRef = useRef<HTMLElement>(null)
  const removedTerm = career.removedTerm
  // After a removal the clicked button is gone, so focus moves to the new most recent term's Remove
  // term button, or to Start career when no term is left.
  useEffect(() => {
    if (removedTerm === undefined) return
    const section = sectionRef.current
    const target =
      section?.querySelector<HTMLButtonElement>('[data-testid="remove-term"]') ??
      section?.querySelector<HTMLButtonElement>('.career-start button[type="submit"]')
    target?.focus()
  }, [removedTerm])

  return (
    <section aria-labelledby="career-heading" data-testid="career" ref={sectionRef}>
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
          {/* The live region stays mounted, empty until a removal, so screen readers announce the first removal too. */}
          <p className={removedTerm === undefined ? undefined : 'notice small'} data-testid="removed-term-notice" aria-live="polite">
            {removedTerm === undefined
              ? ''
              : `Removed term ${removedTerm}. ${removedTerm > 1 ? `The character is back at the end of term ${removedTerm - 1}.` : 'Pick a career to start again.'}`}
          </p>
          {career.saveFailed && (
            <p className="notice small" data-testid="career-save-failed">
              This character could not be saved in this browser. It stays until the page closes.
            </p>
          )}

          {result.runs.length === 0 && result.educations.length === 0 && pending?.kind !== 'start' && (
            <StartForm careers={careers} education={[]} prefix="" exclude={[]} input={input} onChange={update} />
          )}
          {[...result.runs.map((run) => ({ order: run.order, run })), ...result.educations.map((record) => ({ order: record.order, record }))]
            .sort((a, b) => a.order - b.order)
            .map((block) =>
              'run' in block ? (
                <Run
                  key={block.order}
                  run={block.run}
                  anagathics={rules.rules.anagathics}
                  input={input}
                  onChange={update}
                  onRemoveLast={career.removeLastTerm}
                  lastTerm={result.terms[result.terms.length - 1]?.number}
                />
              ) : (
                <EducationBlock
                  key={block.order}
                  record={block.record}
                  input={input}
                  onChange={update}
                  onRemoveLast={career.removeLastTerm}
                  lastTerm={result.terms[result.terms.length - 1]?.number}
                />
              ),
            )}
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
                education={pending.education}
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
                {result.shipShares > 0 && (
                  <>
                    , ship shares <strong data-testid="summary-ship-shares">{result.shipShares}</strong>
                  </>
                )}
              </p>
              {result.educations.some((e) => e.term) && (
                <p data-testid="summary-education">
                  Education:{' '}
                  {result.educations
                    .flatMap((e) => (e.term ? [`${e.education.name} (${outcomeText(e)?.replace(/\.$/, '').toLowerCase() ?? 'in progress'})`] : []))
                    .join(', ')}
                </p>
              )}
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
              {unusedDMs.length > 0 && <p data-testid="summary-later-dms">DMs not applied: {unusedDMs.join(', ')}</p>}
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
                education={result.nextCareer.education}
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
