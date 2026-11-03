// Regenerates src/online/abi.ts from the Foundry artifact. Run `forge build` first.
import { readFileSync, writeFileSync } from 'node:fs'

const artifact = JSON.parse(readFileSync('contracts/out/PenaltyMatch.sol/PenaltyMatch.json', 'utf8')) as { abi: unknown }
const header =
  '// Generated from contracts/PenaltyMatch.sol (forge build). Do not edit by hand.\n// Regenerate: bun run abi:match\n'
writeFileSync('src/online/abi.ts', `${header}export const penaltyMatchAbi = ${JSON.stringify(artifact.abi, null, 2)} as const\n`)
console.log('Wrote src/online/abi.ts')
