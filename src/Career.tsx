import { useState } from 'react'
import type { Characteristic } from './engine/characteristics'
import type { CareerDefinition } from './engine/career-schema'
import type { SelectedRules } from './engine/career-pack'
import { current, isOverridden } from './engine/overridable'
import { POLICY_SUMMARY } from './engine/policy'
import { skillTableName, type CareerInput, type PendingChoice, type Step, type TermResult } from './engine/terms'
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
  const overridden = (step.dice !== undefined && isOverridden(step.dice)) || (step.passed !== undefined && isOverridden(step.passed))
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
      {step.notes.map((n) => (
        <div className="step-note" key={n}>
          Apply by hand: {n}
        </div>
      ))}
    </li>
  )
}

interface TermProps {
  term: TermResult
  input: CareerInput
  onChange: (next: CareerInput) => void
}

/** Renders one term: its age range and rank, its steps, why the career ends (if it does), and a notes field. */
function Term({ term, input, onChange }: TermProps) {
  const notesKey = `term-${term.number}`
  return (
    <li className="term" data-testid={`term-${term.number}`}>
      <div className="term-head">
        <h3>Term {term.number}</h3>
        <span className="muted" data-testid="term-age">
          age {term.ageStart}-{term.ageEnd}
        </span>
        <span data-testid="term-rank">
          rank {term.rank}
          {term.title ? ` ${term.title}` : ''}
        </span>
      </div>
      <ul className="steps">
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
  benefitCount: number
}

/** Renders the controls for the choice the career needs next. */
function Pending({ pending, input, onChange, onGenerate, benefitCount }: PendingProps) {
  const choose = (key: string, value: string) => onChange({ ...input, choices: { ...input.choices, [key]: value } })
  const generate = (
    <>
      <button type="button" className="secondary" onClick={onGenerate}>
        Generate the rest
      </button>
      <p className="muted small" data-testid="policy-note">
        {POLICY_SUMMARY}
      </p>
    </>
  )
  switch (pending.kind) {
    case 'start':
      return null
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
    case 'next':
      return pending.forced ? (
        <div className="pending" role="group" aria-label="End of career">
          <p>{pending.reason}</p>
          <button type="button" onClick={() => choose(pending.key, 'muster')}>
            Muster out
          </button>
        </div>
      ) : (
        <div className="pending" role="group" aria-label="After this term">
          <button type="button" onClick={() => choose(pending.key, 'continue')}>
            Continue in career
          </button>
          <button type="button" onClick={() => choose(pending.key, 'leave')}>
            Leave career
          </button>
          {generate}
        </div>
      )
    case 'benefit':
      return (
        <div className="pending" role="group" aria-label="Mustering out">
          <p>
            Benefit roll {pending.index + 1} of {benefitCount}: roll on which table?
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

/** Props for the Career section. */
export interface CareerProps {
  seed: string
  base: Record<Characteristic, number>
  careers: CareerDefinition[]
  rules: SelectedRules
  packs: string
}

/**
 * Renders the Career section (docs/features/career-terms.md, part 1): career and assignment
 * pickers, the qualification roll, each term with its steps and notes, the controls for the next
 * choice, mustering out, and the finished character's summary and connection opportunities.
 */
export function Career({ seed, base, careers, rules, packs }: CareerProps) {
  const career = useCareer(seed, base, careers, rules.rules, packs)
  const { input, result, update } = career
  const [pickedCareer, setPickedCareer] = useState('')
  const [pickedAssignment, setPickedAssignment] = useState('')
  const selected = careers.find((c) => c.id === pickedCareer) ?? careers[0]
  const assignment = selected?.assignments.find((a) => a.id === pickedAssignment) ?? selected?.assignments[0]
  const started = result.career !== undefined && result.assignment !== undefined
  const pending = result.pending
  const benefitCount = result.benefits.length + (pending?.kind === 'benefit' ? 1 : 0)
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

          {!started || pending?.kind === 'start' ? (
            <form
              className="career-start"
              onSubmit={(e) => {
                e.preventDefault()
                if (!selected || !assignment) return
                update({
                  ...input,
                  choices: { 'start.career': selected.id, 'start.assignment': assignment.id },
                  rolls: {},
                  outcomes: {},
                })
              }}
            >
              <label>
                Career
                <select value={selected?.id ?? ''} onChange={(e) => setPickedCareer(e.target.value)}>
                  {careers.map((c) => (
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
                Start career
              </button>
            </form>
          ) : (
            <p data-testid="career-name">
              <strong>{result.career?.name}</strong> / {result.assignment?.name}
            </p>
          )}

          {result.qualification && (
            <ul className="steps">
              <StepRow step={result.qualification} context="Career" input={input} onChange={update} />
            </ul>
          )}
          {pending?.kind === 'start' && pending.failedQualification && (
            <p className="notice" data-testid="qualification-failed">
              Qualification failed. Override the roll, or pick a career and start again.
            </p>
          )}

          {result.terms.length > 0 && (
            <ol className="terms">
              {result.terms.map((t) => (
                <Term key={t.number} term={t} input={input} onChange={update} />
              ))}
            </ol>
          )}

          {result.benefits.length > 0 && (
            <div data-testid="benefits">
              <h3>Mustering out</h3>
              <ul className="steps">
                {result.benefits.map((b) => (
                  <StepRow key={b.step.key} step={b.step} context="Mustering out" input={input} onChange={update} />
                ))}
              </ul>
            </div>
          )}

          {pending && started && (
            <Pending pending={pending} input={input} onChange={update} onGenerate={career.generate} benefitCount={benefitCount} />
          )}

          {result.finished && (
            <div className="summary" data-testid="career-summary">
              <h3>Finished character</h3>
              <p>
                Age <strong data-testid="summary-age">{result.age}</strong>, rank {result.rank}
                {result.title ? ` ${result.title}` : ''}, cash <strong data-testid="summary-cash">Cr{result.cash}</strong>
              </p>
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
                  No events in this career were marked as connection opportunities.
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
        </>
      )}
    </section>
  )
}
