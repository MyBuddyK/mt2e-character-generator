import { mkdirSync, writeFileSync } from 'node:fs'
import { careerPackJsonSchema } from '../src/engine/pack-json-schema'

/**
 * Usage: npm run schema
 *
 * Writes public/career-pack.schema.json from careerPackJsonSchema(), creating public/ if needed.
 * `npm run dev` and `npm run build` run it first, so the site serves the file at
 * career-pack.schema.json.
 */
mkdirSync('public', { recursive: true })
writeFileSync('public/career-pack.schema.json', `${JSON.stringify(careerPackJsonSchema(), null, 2)}\n`)
console.log('Wrote public/career-pack.schema.json')
