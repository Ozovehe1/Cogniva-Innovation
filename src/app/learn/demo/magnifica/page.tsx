import { MagnificaLab } from './lab'

export const metadata = { title: 'UI lab · GeniusMap', robots: { index: false } }

/** Lab page (noindex, signed-in): the Magnifica pieces that are hard to reach in a live lesson, rendered in place. */
export default function Page() {
  return <main className="mx-auto w-full max-w-[760px] px-3 py-5"><MagnificaLab /></main>
}
