import { redirect } from 'next/navigation'

/** The old Gardner assessment was replaced by the AI intake and adaptive check. */
export default function AssessmentPage() {
  redirect('/start')
}
