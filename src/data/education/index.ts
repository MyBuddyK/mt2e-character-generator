import { loadEducation } from '../../engine/education-schema'

const files = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' })
const loaded = loadEducation(files)

/** Every *.json file in this folder that passes EducationSchema and has an unused id, in file name order. Loaded at build time. */
export const education = loaded.education

/** One message per problem in this folder's education files, prefixed with the file name. Empty when every file passes. */
export const educationErrors = loaded.errors
