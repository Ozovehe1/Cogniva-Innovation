'use client'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, History, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { Pending, SheetGrabber, buttonClass, cx } from '@/components/ui'
import { toPlainText } from '@/components/rich-text'
import type { ChatListItem } from '@/lib/agent/chat-store'

/** "just now", "5 min ago", "3 h ago", "Yesterday", "Mon", "12 Oct" (the learner's own clock). */
export function chatWhen(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  const d = new Date(t), today = new Date(now)
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (t >= startToday) return `${Math.floor(s / 3600)} h ago`
  if (t >= startToday - 86_400_000) return 'Yesterday'
  if (t >= startToday - 6 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

/** Asks the open AgentChat to clear itself (a client-made chat keeps the same component key on /ask). */
export const NEW_CHAT_EVENT = 'gm:new-chat'

const openId = () => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('session'))

/**
 * Ask's chat history: a "Chats" button that opens a drawer with every saved chat (newest first), a New chat action,
 * and per chat an overflow menu / long-press / swipe-left to delete it (with a confirmation). Chats are kept until the
 * learner deletes them; deleting removes the chat and its messages for good, server-side.
 */
export function ChatHistory({ initial }: { initial: ChatListItem[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState<ChatListItem[]>(initial)
  const [loading, setLoading] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ChatListItem | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const ids = useId()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/agent/chats', { cache: 'no-store' })
      if (r.ok) setChats(((await r.json()) as { chats: ChatListItem[] }).chats)
    } finally { setLoading(false) }
  }, [])

  const show = () => { setNow(Date.now()); setOpen(true); void load() }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !confirm) { if (menu) setMenu(null); else setOpen(false) } }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, menu, confirm])

  const current = open ? openId() : null
  const onDeleted = (id: string) => {
    setChats(cs => cs.filter(c => c.id !== id))
    setConfirm(null)
    if (openId() === id) { setOpen(false); window.dispatchEvent(new Event(NEW_CHAT_EVENT)); router.replace('/ask'); router.refresh() }
  }

  return (
    <>
      <button type="button" onClick={show} aria-haspopup="dialog" aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 shadow-[var(--shadow-card)] hover:border-line-strong hover:text-ink">
        <History className="h-4 w-4" strokeWidth={1.75} />Chats
      </button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby={`${ids}-h`}>
            <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside className="absolute inset-y-0 left-0 flex w-[88%] max-w-[380px] flex-col border-r border-line bg-canvas shadow-[var(--shadow-raised)]"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'tween', duration: 0.22 }}>
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 pb-3 pt-[calc(14px+env(safe-area-inset-top))]">
                <h2 id={`${ids}-h`} className="font-display text-[22px] leading-tight text-ink">Your chats</h2>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close chats" className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"><X className="h-5 w-5" strokeWidth={1.75} /></button>
              </div>
              <div className="px-4 py-3">
                <Link href="/ask" onClick={() => { setOpen(false); window.dispatchEvent(new Event(NEW_CHAT_EVENT)) }} className={buttonClass('primary', 'md', 'w-full justify-center')}><Plus className="h-4 w-4" strokeWidth={2} />New chat</Link>
              </div>
              <ul className="flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(16px+env(safe-area-inset-bottom))]" aria-busy={loading}>
                {chats.length === 0 && !loading && <li className="px-3 py-8 text-center text-[14px] text-muted">No chats yet. Ask a question and it is saved here until you delete it.</li>}
                {chats.length === 0 && loading && <li className="px-3 py-8 text-center text-[14px] text-muted">Loading your chats…</li>}
                {chats.map(c => (
                  <ChatRow key={c.id} chat={c} now={now} active={c.id === current} menuOpen={menu === c.id}
                    onMenu={v => setMenu(v ? c.id : null)} onOpen={() => setOpen(false)} onDelete={() => { setMenu(null); setConfirm(c) }} />
                ))}
              </ul>
              <p className="border-t border-line px-4 py-2.5 text-[12px] leading-snug text-muted">Chats stay until you delete them. Only you can see them.</p>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
      <ConfirmDeleteChat key={confirm?.id ?? 'none'} chat={confirm} onCancel={() => setConfirm(null)} onDeleted={onDeleted} />
    </>
  )
}

function ChatRow({ chat, now, active, menuOpen, onMenu, onOpen, onDelete }: {
  chat: ChatListItem; now: number; active: boolean; menuOpen: boolean; onMenu: (open: boolean) => void; onOpen: () => void; onDelete: () => void
}) {
  // Swipe left to reveal Delete; a long press (500 ms without moving) asks to delete straight away.
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [at, setAt] = useState<DOMRect | null>(null)
  const start = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout> | null; swiping: boolean; long: boolean } | null>(null)
  const revealed = dx <= -72
  const end = () => { const s = start.current; if (s?.t) clearTimeout(s.t); start.current = null }
  const title = toPlainText(chat.title) || 'New chat'
  return (
    <li className="relative my-0.5">
      <div className="relative overflow-hidden rounded-[12px]">
      <button type="button" onClick={onDelete} tabIndex={revealed ? 0 : -1} aria-hidden={!revealed}
        className="absolute inset-y-0 right-0 flex w-[84px] items-center justify-center gap-1 bg-danger text-[13px] font-medium text-white">
        <Trash2 className="h-4 w-4" strokeWidth={2} />Delete
      </button>
      <div className={cx('relative flex items-center gap-1 rounded-[12px] transition-transform', active ? 'bg-accent-soft' : 'bg-canvas')}
        style={{ transform: `translateX(${Math.max(-84, Math.min(0, dx))}px)`, transitionDuration: dragging ? '0ms' : '180ms' }}
        onTouchStart={e => {
          const p = e.touches[0]
          start.current = { x: p.clientX - dx, y: p.clientY, swiping: false, long: false, t: setTimeout(() => { if (start.current && !start.current.swiping) { start.current.long = true; navigator.vibrate?.(10); onDelete() } }, 500) }
        }}
        onTouchMove={e => {
          const s = start.current; if (!s) return
          const p = e.touches[0]
          const mx = p.clientX - s.x, my = p.clientY - s.y
          if (!s.swiping && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) { s.swiping = true; setDragging(true); if (s.t) clearTimeout(s.t) }
          else if (!s.swiping && Math.abs(my) > 8 && s.t) { clearTimeout(s.t); s.t = null }
          if (s.swiping) setDx(Math.min(0, mx))
        }}
        onTouchEnd={e => { const s = start.current; setDragging(false); if (s?.long) e.preventDefault(); if (s?.swiping) setDx(dx < -40 ? -84 : 0); end() }}
        onTouchCancel={() => { end(); setDx(0); setDragging(false) }}
        onContextMenu={e => { e.preventDefault(); if (!start.current?.long) { setAt((e.currentTarget.lastElementChild as HTMLElement).getBoundingClientRect()); onMenu(true) } }}>
        <Link href={`/ask?session=${chat.id}`} onClick={e => { if (dx < 0) { e.preventDefault(); setDx(0); return } onOpen() }} aria-current={active ? 'page' : undefined}
          className="min-w-0 flex-1 select-none px-3 py-2.5 [-webkit-touch-callout:none]">
          <span className={cx('line-clamp-2 text-[15px] leading-snug', active ? 'font-medium text-accent' : 'text-ink')}>{title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
            {chat.lesson_title && <><BookOpen className="h-3 w-3 flex-shrink-0" strokeWidth={1.75} /><span className="truncate">{toPlainText(chat.lesson_title)}</span><span aria-hidden>·</span></>}
            <time dateTime={chat.updated_at} className="flex-shrink-0">{chatWhen(chat.updated_at, now)}</time>
          </span>
        </Link>
        <button type="button" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setAt(menuOpen ? null : r); onMenu(!menuOpen) }} aria-label={`More for ${title}`} aria-haspopup="menu" aria-expanded={menuOpen}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink"><MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.75} /></button>
      </div>
      </div>
      {menuOpen && at && createPortal(
        // Portalled and fixed to the viewport (the list scrolls, each row clips its swipe layer and the drawer is
        // transformed), below the button or above it near the bottom.
        <>
          <div className="fixed inset-0 z-[75]" onClick={() => onMenu(false)} onTouchStart={e => e.stopPropagation()} />
          <div role="menu" className="fixed z-[76] min-w-[168px] rounded-[12px] border border-line bg-surface p-1 shadow-[var(--shadow-raised)]"
            style={{ right: Math.max(8, window.innerWidth - at.right), ...(at.bottom + 64 > window.innerHeight ? { bottom: window.innerHeight - at.top + 4 } : { top: at.bottom + 4 }) }}>
            <button type="button" role="menuitem" autoFocus onClick={onDelete} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2.5 text-left text-[14px] font-medium text-danger hover:bg-danger-soft">
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />Delete chat
            </button>
          </div>
        </>, document.body,
      )}
    </li>
  )
}

function ConfirmDeleteChat({ chat, onCancel, onDeleted }: { chat: ChatListItem | null; onCancel: () => void; onDeleted: (id: string) => void }) {
  const ids = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!chat) return
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chat, onCancel])
  const go = async () => {
    if (!chat || pending) return
    setPending(true); setError(null)
    try {
      const r = await fetch(`/api/agent/chats/${chat.id}`, { method: 'DELETE' })
      if (r.ok || r.status === 404) { onDeleted(chat.id); return }
      const j = await r.json().catch(() => ({})) as { error?: string }
      setError(j.error ?? 'Could not delete the chat. Please try again.')
    } catch { setError('Could not delete the chat. Check your connection and try again.') }
    setPending(false)
  }
  return (
    <AnimatePresence>
      {chat && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby={`${ids}-t`} aria-describedby={`${ids}-d`}>
          <motion.div className="absolute inset-0 bg-ink/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !pending && onCancel()} />
          <motion.div className="pb-safe relative w-full max-w-md rounded-t-[18px] border border-line bg-surface p-6 shadow-[var(--shadow-raised)] sm:rounded-[18px]"
            initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.2 }}>
            <SheetGrabber className="-mt-4 mb-4" />
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-danger">Delete chat</p>
            <h2 id={`${ids}-t`} className="mt-1.5 line-clamp-3 font-display text-[22px] leading-snug text-ink">{toPlainText(chat.title) || 'New chat'}</h2>
            <p id={`${ids}-d`} className="mt-3 text-[15px] leading-relaxed text-ink-2">This deletes the chat, every message in it and its visuals, on all your devices. It can’t be undone.</p>
            {error && <p className="mt-3 text-[14px] text-danger" role="alert">{error}</p>}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={cancelRef} type="button" onClick={onCancel} disabled={pending} className={buttonClass('secondary', 'lg', 'sm:h-10 sm:px-4 sm:text-sm')}>Keep chat</button>
              <button type="button" onClick={go} disabled={pending} className={buttonClass('danger', 'lg', 'sm:h-10 sm:px-4 sm:text-sm')}>
                <Pending busy={pending} label="Deleting"><Trash2 className="h-4 w-4" strokeWidth={2} />Delete chat</Pending>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
