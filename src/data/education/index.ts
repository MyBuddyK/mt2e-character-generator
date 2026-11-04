import { parseEducation, type EducationDefinition } from '../../engine/education-schema'

const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' })

const loaded: EducationDefinition[] = []
const errors: string[] = []
for (const [file, data] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  const result = parseEducation(data)
  if (result.ok) loaded.push(result.education)
  else errors.push(...result.errors.map((e) => `${file}: ${e}`))
}

/** Every *.json file in this folder that passes EducationSchema, in file name order. Loaded at build time. */
export const education = loaded

/** One message per problem in this folder's education files, prefixed with the file name. Empty when every file passes. */
export const educationErrors = errors
