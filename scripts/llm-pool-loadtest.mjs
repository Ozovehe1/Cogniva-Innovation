// Runs scripts/llm-pool-loadtest.ts (TypeScript) through jiti. Usage: node scripts/llm-pool-loadtest.mjs [learners] [minutes] [after|before]
import { createJiti } from 'jiti'
const jiti = createJiti(import.meta.url, { alias: { '@': new URL('../src', import.meta.url).pathname } })
const mod = await jiti.import('./llm-pool-loadtest.ts')
await mod.main(process.argv.slice(2))
