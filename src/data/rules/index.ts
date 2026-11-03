import { RulesSchema, type Rules } from '../../engine/rules-schema'
import sample from './sample-rules.json'

const parsed = RulesSchema.safeParse(sample)

/**
 * The invented sample rules in sample-rules.json, used when no loaded pack has `rules`. Throws when
 * the file stops matching RulesSchema, so a broken sample fails the unit tests and the build.
 */
export const sampleRules: Rules = (() => {
  if (!parsed.success) throw new Error(`sample-rules.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return parsed.data
})()
