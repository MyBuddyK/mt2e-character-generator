import { z } from 'zod'
import { CareerPackSchema } from './career-pack'

/**
 * Returns the JSON Schema for a career pack, generated from CareerPackSchema with z.toJSONSchema.
 * It describes field names, types, required fields and fixed lengths. Checks written with
 * superRefine (each roll covered once, unique assignment ids and rank values) are not part of it.
 */
export function careerPackJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(CareerPackSchema, { io: 'input' }),
    title: 'Traveller (MT2e) Character Generator career pack',
  }
}
