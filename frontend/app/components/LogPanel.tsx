'use client'

import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from './Dashboard'

interface LogPanelProps {
  logs: LogEntry[]
  stepImages: Record<number, string>
  onOpenViewer: () => void
}

export default function LogPanel({ logs, stepImages, onOpenViewer }: LogPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [arrowHovered, setArrowHovered] = useState(false)

  useEffect(() => {
    setMounted(true)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const fmt = (ts: number) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  const stepCount = Object.keys(stepImages).length
  const hasSteps = stepCount > 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '10px 16px 12px' }}>
      {/* Header row with label + inspector arrow */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="section-label">pipeline log</div>

        <button
          onClick={onOpenViewer}
          onMouseEnter={() => setArrowHovered(true)}
          onMouseLeave={() => setArrowHovered(false)}
          title="open pipeline inspector"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: 4,
            transition: 'all 0.15s ease',
          }}
        >
          {hasSteps && (
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              color: arrowHovered ? 'var(--accent-blue)' : 'var(--text-muted)',
              transition: 'color 0.15s ease',
            }}>
              {stepCount}/5
            </span>
          )}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={arrowHovered ? 'var(--accent-blue)' : hasSteps ? 'var(--text-secondary)' : 'var(--text-muted)'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transition: 'stroke 0.15s ease' }}
          >
            <polyline points="9,18 15,12 9,6" />
          </svg>
        </button>
      </div>

      <div className="log-terminal" style={{ flex: 1, overflow: 'auto' }}>
        {logs.map((entry, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, lineHeight: 1.6 }}>
            <span className="log-dim" style={{ flexShrink: 0, minWidth: 56 }}>{fmt(entry.ts)}</span>
            <span className={`log-${entry.type}`}>{entry.msg}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="log-dim" style={{ minWidth: 56 }}>
            {mounted ? fmt(Date.now()) : '--:--:--'}
          </span>
          <span className="log-dim">▋<span className="cursor">_</span></span>
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
