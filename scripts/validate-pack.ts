import { readFileSync } from 'node:fs'
import { parseCareerPack } from '../src/engine/career-pack'

/**
 * Usage: npm run validate-pack <file>
 *
 * Reads a career pack file, checks it with parseCareerPack (the same check the app runs on import),
 * and prints the same reason and problem messages the app shows. Exits with code 0 when the pack
 * loads with no problems, 1 when it is rejected or any career was skipped, and 2 for a usage error
 * or a file that can't be read.
 */
function main(args: string[]): number {
  const file = args[0]
  if (file === undefined || args.length !== 1) {
    console.error('Usage: npm run validate-pack <file>')
    return 2
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    console.error(`${file}: could not read the file (${error instanceof Error ? error.message : String(error)})`)
    return 2
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    console.error(`${file}: the file is not valid JSON.`)
    return 1
  }
  const result = parseCareerPack(data)
  if (!result.ok) {
    console.error(`${file}: ${result.reason}`)
    for (const problem of result.problems) console.error(`  ${problem}`)
    return 1
  }
  const count = result.careers.length
  console.log(`Loaded "${result.pack.name}" revision ${result.pack.revision}: ${count} career${count === 1 ? '' : 's'}.`)
  for (const problem of result.problems) console.error(`  ${problem}`)
  return result.problems.length === 0 ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
