import type { CareerDefinition } from '../../engine/career-schema'

/** Every *.json file in this folder, loaded at build time and sorted by name. */
const modules = import.meta.glob<CareerDefinition>('./*.json', { eager: true, import: 'default' })

export const careers: CareerDefinition[] = Object.values(modules).sort((a, b) => a.name.localeCompare(b.name))
