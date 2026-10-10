/** The renderer/solver registry for worked examples: one plugin per diagram type. */
import type { Plugin } from './plugin'
import { circuitPlugin } from './domains/circuit'
import { projectilePlugin, inclinePlugin } from './domains/mechanics'
import { graphPlugin } from './domains/graph'
import { reactionPlugin } from './domains/chem'
import { punnettPlugin } from './domains/genetics'
import { illustrationPlugin, boardPlugin } from './domains/generic'

export const PLUGINS: Plugin[] = [circuitPlugin, projectilePlugin, inclinePlugin, graphPlugin, reactionPlugin, punnettPlugin, illustrationPlugin, boardPlugin]
const BY_TYPE = new Map(PLUGINS.map(p => [p.type, p]))

export function pluginFor(type: unknown): Plugin | null {
  return typeof type === 'string' ? BY_TYPE.get(type) ?? null : null
}

/** Plugins whose words appear in a request, best first (the generator prompt lists these schemas first). */
export function likelyPlugins(text: string): Plugin[] {
  return PLUGINS.filter(p => p.match.test(text))
}
