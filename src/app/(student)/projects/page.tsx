import { redirect } from 'next/navigation'

/** Tutor-assigned projects were retired with the move to an AI tutor. */
export default function ProjectsPage() {
  redirect('/learn')
}
