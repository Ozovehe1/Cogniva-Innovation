import { AgentLab } from './agent-lab'

// Public lab (noindex) for the Live Tutor's external stage tools (?tool=circuit|molecule|mermaid|physics|geogebra|phet|desmos)
// and, for a signed-in learner, the live agent's decision trace (signal → reasoning → plan → tools → outcome).
export const metadata = { title: 'Live tutor lab · Ideanimo', robots: { index: false } }

export default async function AgentLabPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  return <AgentLab tool={sp.tool} />
}
