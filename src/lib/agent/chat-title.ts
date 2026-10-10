/**
 * A chat's title, made from the learner's first question without a model call: the first sentence or question,
 * whitespace collapsed, trimmed to ~60 characters at a word boundary, first letter capitalised.
 */
export function chatTitle(message: string, max = 60): string {
  let t = message.replace(/\s+/g, ' ').trim()
  // Drop a leading greeting / filler ("hi,", "hey Ideanimo,", "please") so the title names the topic.
  t = t.replace(/^(hi|hello|hey|yo|ok|okay|so|um+|please)\b[\s,!.:-]*((?:genius ?map|ideanimo)[\s,!.:-]*)?/i, '').trim() || t
  // First sentence or question, when the message runs on.
  const m = t.match(/^(.{12,}?[?.!])(\s|$)/)
  if (m && m[1].length <= max + 20) t = m[1]
  if (t.length > max) {
    const cut = t.slice(0, max + 1)
    const sp = cut.lastIndexOf(' ')
    t = `${(sp > max * 0.5 ? cut.slice(0, sp) : cut.slice(0, max)).replace(/[\s,;:.!?-]+$/, '')}…`
  }
  t = t.replace(/[.]+$/, '')
  return t ? t[0].toUpperCase() + t.slice(1) : 'New chat'
}
