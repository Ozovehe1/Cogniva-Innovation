/**
 * Remote tools (the Modal tool bench, lib/toolbench/client.ts, or any HTTP tool): registered as ordinary registry tools
 * with prepare → run → validate → fallback. Kept apart from registry.ts so tools.ts can include them without a cycle.
 */
import type { AgentCtx, ToolSpec } from '@/lib/agent/tools'

export type Renderer = 'board' | 'scene' | 'figure' | 'svg' | 'image' | 'clip' | 'embed' | 'text' | 'data' | 'action'
export type Cost = 'free-browser' | 'free-api' | 'llm' | 'modal-cpu' | 'modal-gpu'
export type Latency = 'instant' | 'fast' | 'slow' | 'async'

export interface RemoteToolContract {
  name: string
  short: string
  parameters: Record<string, unknown>
  renderer: Renderer
  cost: Cost
  latency: Latency
  topics?: RegExp
  /** Shape / check arguments before the call; return an error string to send back to the agent. */
  prepare?: (args: Record<string, unknown>) => { args?: Record<string, unknown>; error?: string }
  /** Do the work (may stream blocks to ctx.emit while it runs). */
  run: (args: Record<string, unknown>, ctx: AgentCtx) => Promise<unknown>
  /** Check the result before the agent sees it; issues go back as self_check. */
  validate?: (result: unknown) => string[]
  /** The tool to suggest when this one fails or is over budget. */
  fallback?: string
}

const remote = new Map<string, RemoteToolContract>()
export function remoteContract(name: string) { return remote.get(name) }
export function registerRemoteTool(c: RemoteToolContract) { remote.set(c.name, c) }
export function remoteTools(): ToolSpec[] {
  return [...remote.values()].map(c => ({
    def: { name: c.name, description: c.short, parameters: c.parameters },
    tier: 'visual' as const, modes: ['chat' as const], label: `Running ${c.name.replace(/_/g, ' ')}`,
    run: async (args: Record<string, unknown>, ctx: AgentCtx) => {
      const p = c.prepare ? c.prepare(args) : { args }
      if (p.error) return { error: p.error }
      try {
        const r = await c.run(p.args ?? args, ctx)
        const issues = c.validate ? c.validate(r) : []
        return issues.length ? { ...(r && typeof r === 'object' ? r as object : { result: r }), self_check: { ok: false, issues } } : r
      } catch (err) {
        return { error: `${c.name} failed: ${err instanceof Error ? err.message.slice(0, 200) : err}${c.fallback ? `. Try ${c.fallback} instead.` : ''}` }
      }
    },
  }))
}

