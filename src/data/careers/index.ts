import type { CareerDefinition } from '../../engine/career-schema'

/** Every *.json file in this folder is loaded as a career. */
const modules = import.meta.glob<CareerDefinition>('./*.json', { eager: true, import: 'default' })

export const careers: CareerDefinition[] = Object.values(modules).sort((a, b) => a.name.localeCompare(b.name))
