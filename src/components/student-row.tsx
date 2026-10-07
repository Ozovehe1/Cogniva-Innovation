import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Avatar, Badge, initialsOf } from './ui'

/** A student list row: stacked on mobile, columnar on desktop. */
export function StudentRow({
  href,
  name,
  statement,
  assessed,
  level,
  projectsCompleted,
  chevron = true,
}: {
  href: string
  name?: string
  statement?: string
  assessed: boolean
  level: string
  projectsCompleted: number
  chevron?: boolean
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 px-5 py-4 transition-colors duration-150 hover:bg-[#FBFAF7] sm:items-center md:px-6"
    >
      <Avatar initials={initialsOf(name)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink">{name}</p>
        {assessed ? (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted sm:line-clamp-1">{statement}</p>
        ) : (
          <Badge className="mt-1.5 border-amber-line bg-amber-soft text-amber">Assessment pending</Badge>
        )}
        <p className="tnum mt-2 text-[13px] text-muted sm:hidden">
          <span className="font-medium text-ink-2">{level}</span> · {projectsCompleted} approved
        </p>
      </div>
      <div className="hidden w-28 flex-shrink-0 text-right sm:block">
        <p className="text-sm font-medium text-ink">{level}</p>
        <p className="tnum text-[12px] text-muted">{projectsCompleted} approved</p>
      </div>
      {chevron && (
        <ChevronRight className="mt-3 h-4 w-4 flex-shrink-0 text-faint transition-colors group-hover:text-ink-2 sm:mt-0" strokeWidth={1.75} />
      )}
    </Link>
  )
}
