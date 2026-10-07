'use client'
import React from 'react'
import { AppShell, type NavItem } from './app-shell'

export function TutorShell({
  children,
  fullName,
  initials,
  navItems,
}: {
  children: React.ReactNode
  fullName: string
  initials: string
  navItems: NavItem[]
}) {
  return (
    <AppShell fullName={fullName} initials={initials} navItems={navItems} roleLabel="Tutor" homeHref="/tutor/dashboard">
      {children}
    </AppShell>
  )
}
