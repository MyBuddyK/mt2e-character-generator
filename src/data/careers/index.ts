import { loadCareers } from '../../engine/career-schema'

const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' })
const loaded = loadCareers(files)

/** Every *.json file in this folder that passes CareerSchema, sorted by name. Loaded at build time. */
export const careers = loaded.careers

/** One message per problem in this folder's career files, prefixed with the file name. Empty when every file passes. */
export const careerErrors = loaded.errors
