'use client'
import { Logo } from '@/components/ui'
import { ErrorView } from '@/components/system/error-view'

export default function RootError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="pt-safe mx-auto flex h-16 max-w-[1120px] items-center px-5 md:px-8"><Logo /></header>
      <main className="px-5"><ErrorView error={error} retry={unstable_retry} homeHref="/" /></main>
    </div>
  )
}
