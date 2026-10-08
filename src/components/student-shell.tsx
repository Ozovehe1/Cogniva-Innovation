'use client'
import React from 'react'
import { AppShell, type NavItem } from './app-shell'

export function StudentShell({
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
    <AppShell fullName={fullName} initials={initials} navItems={navItems} homeHref="/dashboard">
      {children}
    </AppShell>
  )
}
