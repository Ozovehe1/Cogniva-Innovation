/**
 * Distress screening for any free text a learner types (intake answers, lesson
 * answers). Deterministic and local: no text is sent anywhere or stored because
 * of a match. On a match the app pauses and shows Nigerian helplines; the AI
 * never acts as a counsellor. Safe on the server and in the browser.
 */

const PATTERNS: RegExp[] = [
  // Self-harm and suicide
  /\b(kill(ing)?|hurt(ing)?|harm(ing)?|cut(ting)?) my ?self\b/i,
  /\bsuicid/i,
  /\bself[- ]?harm/i,
  /\b(want(ed)?|wanna|going|plan(ning)?) to die\b/i,
  /\bend (it all|my life|everything)\b/i,
  /\b(don'?t|do not) want to (live|be alive|wake up|exist)\b/i,
  /\bno (reason|point) (to|in) (live|living|being alive)\b/i,
  /\bbetter off (dead|without me)\b/i,
  /\bcan'?t (go on|take it anymore|do this anymore)\b/i,
  // Hopelessness (not "hopeless at maths")
  /\b(i feel|feeling|everything is|life is|it'?s all|i am|i'?m) (so |completely |totally )?hopeless\b(?! (at|with|in) )/i,
  /\bno hope( left)?\b/i,
  // Abuse
  /\b(he|she|they|someone|somebody|my \w+) (beats?|hits?|slaps?|touch(es|ed)?|abuses?d?|hurts?) me\b/i,
  /\b(being|been|was|am|i'?m) (abused|molested|raped|beaten)\b/i,
  /\babus(e|ing) me\b/i,
  // Not eating or sleeping (sustained)
  /\b(haven'?t|have not|can'?t|cannot|not) (eaten|been eating|slept|been sleeping)\b/i,
  /\bnot (eating|sleeping) (for|in) (days|weeks)\b/i,
  // Nigerian Pidgin and code-switching (self-harm, hopelessness, abuse)
  /\b(i|make i|mek i|i go|i wan|i want|i dey (think|plan) to) (just )?(die|kill (my ?self|myself)|end (am|my life|everything))\b/i,
  /\bi wan (die|commot for (this )?world)\b/i,
  /\b(life|this life) no (get|dey get) (meaning|value|point)\b/i,
  /\bi don tire (for|of) (this )?life\b/i,
  /\bi no (wan|want) (live|dey alive|wake up)( again)?\b/i,
  /\bmake i (just )?(drink|take) (sniper|poison|rat poison|otapiapia)\b/i,
  /\b(sniper|otapiapia|rat poison)\b.{0,40}\b(drink|take|swallow|chop)\b|\b(drink|take|swallow|chop)\b.{0,20}\b(sniper|otapiapia|rat poison)\b/i,
  /\bi (fit|go) (just )?jump (inside|for) (lagoon|river|bridge)\b/i,
  /\b(dem|e|my (papa|mama|uncle|aunty|step\w*)) (dey|don|de) (beat|flog|touch|abuse|hurt) me\b/i,
  /\bnobody (go|will) miss me\b/i,
  /\bi (no|don't|dont) (fit|wan) (cope|continue|carry (am|this)) again\b/i,
]

/** True when the text suggests the learner may be in distress. */
export function detectDistress(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.replace(/\s+/g, ' ').slice(0, 4000)
  return PATTERNS.some(p => p.test(t))
}

export const HELPLINES = [
  { name: 'SURPIN (Suicide Research and Prevention Initiative)', phone: '0800 078 7746', tel: '08000787746', note: 'Toll-free, 24 hours' },
  { name: 'MANI (Mentally Aware Nigeria Initiative)', phone: '0809 111 6264', tel: '08091116264', note: 'Mental health support' },
  { name: 'National emergency number', phone: '112', tel: '112', note: 'If you are in danger right now' },
] as const
