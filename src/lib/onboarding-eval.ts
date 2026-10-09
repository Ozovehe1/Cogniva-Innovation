/** Static eval cases for onboarding v2 (docs/design/onboarding.md): screen count, back-compat mapping, inference. Pure. */
import { SCREENS, visibleScreens, inferStatus, type Answers } from './intake'
import { answersToColumns } from './learner'
import { inferSignals } from './onboarding-signals'
import type { DiagAnswer } from './diagnostic-core'

type R = { id: string; group: string; pass: boolean; detail: string }
const ans = (rows: [boolean, DiagAnswer['confidence'], number | null][]): DiagAnswer[] =>
  rows.map(([correct, confidence, choice], i) => ({ node: 'n' + i, item: 0, choice, correct, confidence, at: new Date(1e12 + i * 20_000).toISOString() }))

export function onboardingStaticCases(): R[] {
  const out: R[] = []
  const add = (id: string, pass: boolean, detail: string) => out.push({ id, group: 'static', pass, detail })
  const adult: Answers = { age: { v: '18plus' } }, minor: Answers = { age: { v: '13to17' } }
  const before = (a: Answers) => visibleScreens(a).filter(s => s.id !== 'purpose').length
  add('onb-screen-count', before(adult) === 3 && before(minor) === 4 && SCREENS.length === 5, `adult ${before(adult)}+1 optional, minor ${before(minor)}+1 optional`)
  // v1 answers still map (anxiety pair, efficacy, status), v2 SIMA number and goal contexts map.
  const v1 = answersToColumns({ status: { v: 'finished' }, efficacy: { v: 2 }, anxiety: { v: { test: 4, problems: 3, new_topic: 5 } }, example_pref: { v: 'try' }, interests: { v: ['sport'] } })
  const v2 = answersToColumns({ age: { v: '13to17' }, level: { v: 'SS2' }, anxiety: { v: 4 }, goal_pick: { v: { goal: 'Size solar panels', subject: 'Solar PV', stem: true, contexts: ['their family shop'] } } })
  add('onb-backcompat-v1', v1.learner_status === 'finished' && v1.efficacy === 2 && (v1.anxiety as Record<string, number>)?.test === 4 && v1.example_pref === 'try', JSON.stringify(v1).slice(0, 160))
  add('onb-v2-mapping', v2.learner_status === 'in_school' && (v2.anxiety as Record<string, number>)?.sima === 4 && v2.interests?.[0] === 'their family shop' && inferStatus({ level: { v: 'Finished school' } }) === 'finished', JSON.stringify(v2).slice(0, 160))
  // Under-confident: right answers tapped as guesses -> low efficacy, flagged anxious on STEM; confident -> high.
  const shy = inferSignals({ asked: ans([[true, 'guess', 1], [true, 'guess', 0], [false, null, null], [true, 'fairly', 2], [true, 'guess', 1], [false, null, null]]) }, { stem: true })
  const sure = inferSignals({ asked: ans([[true, 'sure', 1], [true, 'sure', 0], [true, 'fairly', 2], [false, 'sure', 1], [true, 'sure', 3], [true, 'sure', 0]]) }, { stem: true })
  add('onb-signals', !!shy && !!sure && shy.efficacy <= 2 && shy.anxious && shy.calibrationGap >= 0.25 && sure.efficacy >= 4 && !sure.anxious && inferSignals({ asked: ans([[true, 'sure', 1]]) }) === null, `shy ${JSON.stringify(shy)} | sure eff ${sure?.efficacy}`)
  return out
}
