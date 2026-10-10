import { SceneLab } from './scene-lab'

// Public design lab for the live scene engine: every kind's default spec, live or frozen at ?t= (deterministic
// screenshots). ?kind=<id>&t=<seconds>; ?spec=<url-encoded JSON> renders (and validates) any spec.
export const metadata = { title: 'Scene lab · Ideanimo', robots: { index: false } }

export default async function SceneLabPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  return <SceneLab kind={sp.kind} t={sp.t} spec={sp.spec} legacy={sp.legacy} />
}
