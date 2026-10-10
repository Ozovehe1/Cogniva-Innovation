/** Domain plugins for worked examples: one per diagram type (circuit, projectile, incline, graph, reaction, punnett…). */
import type { DiagramSpec, ExampleSpec, SolStep } from './spec'

export interface DiagramView {
  /** -1 = the problem as posed (no answers shown) */
  step: number
  /** the current step's diagram action (renderer-specific) */
  action?: Record<string, unknown>
  /** the final answer is revealed */
  reveal?: boolean
  /** give answers away? (false for the learner's own try) */
  answers?: boolean
  /** no SMIL/CSS motion (board figures, PNG) */
  static?: boolean
}

export interface Plugin {
  type: string
  /** one-paragraph schema + action vocabulary for the generator prompt */
  prompt: string
  /** words that make this the right plugin for a request */
  match: RegExp
  /** validate the diagram (may add givens to the spec, e.g. one per circuit component); returns problems */
  prepare?(d: DiagramSpec, spec: ExampleSpec): string[]
  /** independently derived values (added to the scope as names the steps may use) */
  facts?(d: DiagramSpec, scope: Record<string, number>): Record<string, number>
  /** the plugin writes the solution itself (circuits: series-parallel reduction) */
  derive?(d: DiagramSpec, spec: ExampleSpec): { steps: SolStep[]; mistakes?: { expr: string; why: string }[] } | null
  /** independent cross-check of the numbers (a second solver / physical law) */
  crossCheck?(d: DiagramSpec, spec: ExampleSpec, scope: Record<string, number>, answer: number | null): string[]
  /** check a text answer (a balanced equation, a ratio) */
  checkText?(d: DiagramSpec, spec: ExampleSpec): string[]
  /** SVG for this view, drawn from the scope (never from model-written numbers) */
  render(d: DiagramSpec, scope: Record<string, number>, view: DiagramView, spec: ExampleSpec): string
}
