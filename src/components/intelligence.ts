// Presentation metadata for Gardner's eight intelligences.
// Keys match the intelligence_scores object stored in Supabase.

export const intelligenceMeta: Record<string, { label: string; short: string; desc: string }> = {
  linguistic:          { label: 'Linguistic',         short: 'Ling.',   desc: 'Words, reading, writing and explaining' },
  logicalMathematical: { label: 'Logical–mathematical', short: 'Logic',  desc: 'Reasoning, patterns, numbers and systems' },
  spatial:             { label: 'Spatial',            short: 'Spatial', desc: 'Visualising, mapping, design and form' },
  musical:             { label: 'Musical',            short: 'Music',   desc: 'Rhythm, pitch and sensitivity to sound' },
  bodilyKinesthetic:   { label: 'Bodily–kinesthetic', short: 'Body',    desc: 'Learning by doing, movement and craft' },
  interpersonal:       { label: 'Interpersonal',      short: 'People',  desc: 'Reading others and working in groups' },
  intrapersonal:       { label: 'Intrapersonal',      short: 'Self',    desc: 'Reflection, self-knowledge and focus' },
  naturalist:          { label: 'Naturalist',         short: 'Nature',  desc: 'Noticing and classifying the living world' },
}

export const intelligenceOrder = [
  'linguistic',
  'logicalMathematical',
  'spatial',
  'musical',
  'bodilyKinesthetic',
  'interpersonal',
  'intrapersonal',
  'naturalist',
]

export function intelligenceLabel(key: string) {
  return intelligenceMeta[key]?.label ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}
