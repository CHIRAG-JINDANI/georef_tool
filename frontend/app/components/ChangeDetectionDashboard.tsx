'use client'

import { useState, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CDLogEntry {
  type: 'info' | 'ok' | 'warn' | 'error' | 'dim'
  msg: string
  ts: number
}

interface CDResult {
  image1Url: string   // annotated original (2021-era)
  image2Url: string   // annotated aligned (2025-era)
  changeCount: number
  totalChangedArea: number
  alignmentScore: number
  processingTime: number
}

type CDStage = 'idle' | 'uploading' | 'ready' | 'processing' | 'done' | 'error'

const CD_STEPS = [
  { id: 'step-1', label: 'alignment', sub: 'orb + homography' },
  { id: 'step-2', label: 'ssim diff', sub: 'structural similarity' },
  { id: 'step-3', label: 'threshold + morph', sub: 'otsu + open/close' },
  { id: 'step-4', label: 'result — image 1', sub: 'annotated t1' },
  { id: 'step-5', label: 'result — image 2', sub: 'annotated t2' },
]

// ─── Main Component ───────────────────────────────────────────────────────────

interface ChangeDetectionDashboardProps {
  onSwitchTool: () => void
}

export default function ChangeDetectionDashboard({ onSwitchTool }: ChangeDetectionDashboardProps) {
  const [stage, setStage] = useState<CDStage>('idle')
  const [image1, setImage1] = useState<File | null>(null)
  const [image2, setImage2] = useState<File | null>(null)
  const [preview1, setPreview1] = useState<string | null>(null)
  const [preview2, setPreview2] = useState<string | null>(null)
  const [result, setResult] = useState<CDResult | null>(null)
  const [logs, setLogs] = useState<CDLogEntry[]>([
    { type: 'dim', msg: 'change detection engine ready', ts: Date.now() },
    { type: 'dim', msg: 'upload two raster images (t1 and t2) → run detection', ts: Date.now() },
  ])
  const [stepImages, setStepImages] = useState<Record<number, string>>({})
  const [activeSection, setActiveSection] = useState<string>('step-1')
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // zoom / pan state for the image viewer
  const [zoomScale, setZoomScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const fileInput1Ref = useRef<HTMLInputElement>(null)
  const fileInput2Ref = useRef<HTMLInputElement>(null)
  const [drag1, setDrag1] = useState(false)
  const [drag2, setDrag2] = useState(false)

  // ─── Log helper ─────────────────────────────────────────────────────────────

  const addLog = useCallback((type: CDLogEntry['type'], msg: string) => {
    setLogs(prev => [...prev, { type, msg, ts: Date.now() }])
  }, [])

  const fmt = (ts: number) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  // ─── Upload helpers ──────────────────────────────────────────────────────────

  const handleFile1 = (file: File) => {
    if (!file.type.startsWith('image/')) return
    setImage1(file)
    setPreview1(URL.createObjectURL(file))
    addLog('ok', `t1 loaded — ${file.name} (${(file.size / 1024).toFixed(0)} KB)`)
    if (image2 || preview2) setStage('ready')
    else setStage('uploading')
  }

  const handleFile2 = (file: File) => {
    if (!file.type.startsWith('image/')) return
    setImage2(file)
    setPreview2(URL.createObjectURL(file))
    addLog('ok', `t2 loaded — ${file.name} (${(file.size / 1024).toFixed(0)} KB)`)
    if (image1 || preview1) setStage('ready')
    else setStage('uploading')
  }

  // ─── Zoom / Pan ──────────────────────────────────────────────────────────────

  const clampPan = (newX: number, newY: number, currentScale: number) => {
    if (!containerRef.current) return { x: newX, y: newY }
    const { clientWidth, clientHeight } = containerRef.current
    const extraWidth = Math.max(0, (clientWidth * currentScale - clientWidth) / 2)
    const extraHeight = Math.max(0, (clientHeight * currentScale - clientHeight) / 2)
    const boundsX = extraWidth + clientWidth * 0.3
    const boundsY = extraHeight + clientHeight * 0.3
    return {
      x: Math.min(Math.max(newX, -boundsX), boundsX),
      y: Math.min(Math.max(newY, -boundsY), boundsY),
    }
  }

  const handleZoom = (delta: number) => {
    setZoomScale(s => {
      const ns = Math.max(1, Math.min(s + delta, 10))
      setPan(prev => clampPan(prev.x, prev.y, ns))
      return ns
    })
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    handleZoom(e.deltaY < 0 ? 0.25 : -0.25)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    const nX = e.clientX - dragStart.current.x
    const nY = e.clientY - dragStart.current.y
    setPan(clampPan(nX, nY, zoomScale))
  }

  const handleMouseUp = () => setIsDragging(false)
  const resetView = () => { setZoomScale(1); setPan({ x: 0, y: 0 }) }

  // ─── Process ─────────────────────────────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    if (!image1 || !image2) return
    setStage('processing')
    setResult(null)
    setStepImages({})
    setActiveSection('step-1')
    addLog('info', 'dispatching to change detection pipeline...')
    const t0 = Date.now()

    try {
      const formData = new FormData()
      formData.append('image1', image1)
      formData.append('image2', image2)

      const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'
      const resp = await fetch(`${baseURL}/change-detection`, {
        method: 'POST',
        body: formData,
      })

      if (!resp.ok) throw new Error('pipeline network error')

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('no response stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          const payload = JSON.parse(line)

          if (payload.type === 'log') {
            addLog('dim', payload.msg)
          } else if (payload.type === 'step_img') {
            setStepImages(prev => ({ ...prev, [payload.step]: payload.img }))
          } else if (payload.type === 'error') {
            throw new Error(payload.msg)
          } else if (payload.type === 'result') {
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
            setResult({ ...payload.data, processingTime: parseFloat(elapsed) })
            setStage('done')
            setActiveSection('step-4')
            addLog('ok', `detection complete — ${payload.data.changeCount} change regions identified`)
            addLog('ok', `total changed area: ${payload.data.totalChangedArea.toFixed(0)} px²`)
            addLog('info', `elapsed: ${elapsed}s`)
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      addLog('error', `pipeline failed: ${message}`)
      setStage('ready')
    }
  }, [image1, image2, addLog])

  // ─── Reset ───────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setStage('idle')
    setImage1(null)
    setImage2(null)
    setPreview1(null)
    setPreview2(null)
    setResult(null)
    setStepImages({})
    setActiveSection('step-1')
    setZoomScale(1)
    setPan({ x: 0, y: 0 })
    setLogs([
      { type: 'dim', msg: 'session reset', ts: Date.now() },
      { type: 'dim', msg: 'upload two raster images (t1 and t2) → run detection', ts: Date.now() },
    ])
  }, [])

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const canProcess = stage === 'ready' && !!image1 && !!image2
  const stepCount = Object.keys(stepImages).length
  const activeStepNum = activeSection.startsWith('step-') ? parseInt(activeSection.replace('step-', '')) : null
  const activeImg = activeStepNum ? stepImages[activeStepNum] : null

  const stageBadge: Record<CDStage, { label: string; cls: string }> = {
    idle: { label: 'idle', cls: 'badge-idle' },
    uploading: { label: 'uploading', cls: 'badge-running' },
    ready: { label: 'ready', cls: 'badge-ready' },
    processing: { label: 'processing', cls: 'badge-running' },
    done: { label: 'done', cls: 'badge-done' },
    error: { label: 'error', cls: 'badge-error' },
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gridTemplateRows: '48px 1fr', height: '100vh', background: 'var(--bg-primary)', gap: 0 }}
      onClick={() => dropdownOpen && setDropdownOpen(false)}
    >
      {/* ── Header ── */}
      <header style={{
        gridColumn: '1 / -1',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        zIndex: 50,
      }}>
        {/* Left: logo + dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 28, height: 28,
              background: 'linear-gradient(135deg, #3d6b5f, #5a8a7a)',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="white" opacity="0.9" />
                <circle cx="12" cy="9" r="2.5" fill="#3d6b5f" />
              </svg>
            </div>
          </div>

          {/* Dropdown trigger */}
          <button
            onClick={e => { e.stopPropagation(); setDropdownOpen(o => !o) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '0 10px', height: 48,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>GeoRef Studio</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>v1.0</span>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', marginLeft: 2 }}
            >
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {dropdownOpen && (
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute', top: 44, left: 0,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                overflow: 'hidden',
                minWidth: 200,
                zIndex: 100,
              }}
            >
              <div style={{ padding: '6px 0' }}>
                <DropdownItem
                  label="GeoRef Studio"
                  sub="automatic georeferencing"
                  active={false}
                  onClick={() => { setDropdownOpen(false); onSwitchTool() }}
                />
                <DropdownItem
                  label="Change Detection"
                  sub="temporal raster diff"
                  active={true}
                  onClick={() => setDropdownOpen(false)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right: badge + reset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
            change detection
          </span>
          <span className={`badge ${stageBadge[stage].cls}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {stage === 'processing' && (
              <span className="pulse-dot" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-amber)' }} />
            )}
            {stageBadge[stage].label}
          </span>
          <button className="btn-ghost" onClick={handleReset} style={{ fontSize: 10, padding: '5px 12px' }}>
            reset session
          </button>
        </div>
      </header>

      {/* ── Left Sidebar: Controls + Log ── */}
      <aside style={{
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-panel)',
        overflow: 'hidden',
      }}>
        {/* Controls */}
        <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 16px 10px' }}>
          <div className="section-label">detection controls</div>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* Upload T1 */}
          <UploadSection
            num="01"
            title="upload t1 (before)"
            sub="earlier temporal image"
            active={stage === 'idle' || stage === 'uploading' || stage === 'ready'}
            done={!!image1}
            file={image1}
            preview={preview1}
            dragOver={drag1}
            setDragOver={setDrag1}
            fileInputRef={fileInput1Ref}
            onFile={handleFile1}
          />

          {/* Upload T2 */}
          <UploadSection
            num="02"
            title="upload t2 (after)"
            sub="later temporal image"
            active={stage === 'idle' || stage === 'uploading' || stage === 'ready'}
            done={!!image2}
            file={image2}
            preview={preview2}
            dragOver={drag2}
            setDragOver={setDrag2}
            fileInputRef={fileInput2Ref}
            onFile={handleFile2}
          />

          {/* Run */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', opacity: (stage === 'ready' || stage === 'done') ? 1 : 0.4, transition: 'opacity 0.2s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, fontWeight: 600, color: stage === 'done' ? 'var(--accent-cyan)' : stage === 'ready' ? 'var(--accent-blue)' : 'var(--text-muted)', letterSpacing: '0.05em' }}>
                {stage === 'done' ? '✓' : '03'}
              </span>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, fontWeight: 500, color: (stage === 'ready' || stage === 'done') ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                run detection
              </span>
            </div>

            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 10px', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              orb alignment → ssim diff → otsu threshold → morphological clean → change polygons
            </p>

            <div className="card" style={{ padding: '8px 10px', marginBottom: 10 }}>
              {[
                ['detector', 'ORB 5000 features'],
                ['matcher', 'BFMatcher (hamming)'],
                ['ransac thr', '5.0 px'],
                ['diff method', 'SSIM structural'],
                ['threshold', 'Otsu binary'],
                ['morph kernel', '7×7 px'],
                ['min area', '500 px²'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{k}</span>
                  <span style={{ fontSize: 10, color: 'var(--accent-purple)', fontFamily: 'monospace' }}>{v}</span>
                </div>
              ))}
            </div>

            <button
              className="btn-primary"
              onClick={handleProcess}
              disabled={!canProcess || (stage as string) === 'processing'}
              style={{ width: '100%' }}
            >
              {stage === 'processing' ? '⠿ processing...' : 'run change detection'}
            </button>
          </div>

          {/* Results summary */}
          {result && (
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <div className="section-label" style={{ marginBottom: 10 }}>detection results</div>
              <div className="card" style={{ padding: '8px 10px' }}>
                {[
                  ['change regions', String(result.changeCount)],
                  ['total area Δ', `${result.totalChangedArea.toFixed(0)} px²`],
                  ['elapsed', `${result.processingTime}s`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{k}</span>
                    <span style={{ fontSize: 10, color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Download buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <button
                  className="btn-download"
                  style={{ width: '100%' }}
                  onClick={() => downloadDataUrl(result.image1Url, 'change_t1_annotated.jpg')}
                >
                  ↓ download t1 annotated
                </button>
                <button
                  className="btn-download"
                  style={{ width: '100%' }}
                  onClick={() => downloadDataUrl(result.image2Url, 'change_t2_annotated.jpg')}
                >
                  ↓ download t2 annotated
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Log terminal */}
        <div style={{ height: 200, display: 'flex', flexDirection: 'column', padding: '10px 16px 12px', borderTop: '1px solid var(--border)' }}>
          <div className="section-label" style={{ marginBottom: 8 }}>pipeline log</div>
          <div className="log-terminal" style={{ flex: 1, overflow: 'auto' }}>
            {logs.map((entry, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, lineHeight: 1.6 }}>
                <span className="log-dim" style={{ flexShrink: 0, minWidth: 56 }}>{fmt(entry.ts)}</span>
                <span className={`log-${entry.type}`}>{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── Right: Pipeline Inspector (PipelineViewer-style) ── */}
      <main style={{ display: 'flex', overflow: 'hidden', background: 'var(--bg-primary)' }}>

        {/* Nav rail */}
        <div style={{ width: '22%', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '20px 0', gap: 2, background: 'var(--bg-panel)', flexShrink: 0 }}>
          <div style={{ padding: '0 20px 12px', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            pipeline steps
          </div>

          {CD_STEPS.map(step => {
            const num = parseInt(step.id.replace('step-', ''))
            const isActive = activeSection === step.id
            const isHovered = hoveredNav === step.id
            const hasImage = !!stepImages[num]
            return (
              <div
                key={step.id}
                onClick={() => hasImage && setActiveSection(step.id)}
                onMouseEnter={() => setHoveredNav(step.id)}
                onMouseLeave={() => setHoveredNav(null)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 20px',
                  cursor: hasImage ? 'pointer' : 'default',
                  opacity: hasImage ? 1 : 0.35,
                  background: isActive ? 'rgba(168, 85, 247, 0.15)' : isHovered && hasImage ? 'rgba(255,255,255,0.04)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)', letterSpacing: '0.05em', minWidth: 16 }}>
                      {hasImage ? '✓' : `0${num}`}
                    </span>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--text-primary)' : isHovered && hasImage ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'color 0.15s ease' }}>
                      {step.label}
                    </span>
                  </div>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: 'var(--text-muted)', paddingLeft: 24 }}>
                    {step.sub}
                  </span>
                </div>
              </div>
            )
          })}

          {/* Stats section */}
          {result && (
            <>
              <div style={{ padding: '24px 20px 12px', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                change analysis
              </div>
              {[
                { id: 'change-stats', label: 'change metrics', sub: 'region statistics' },
                { id: 'change-compare', label: 'side by side', sub: 'annotated pair' },
              ].map(nav => {
                const isActive = activeSection === nav.id
                const isHovered = hoveredNav === nav.id
                return (
                  <div
                    key={nav.id}
                    onClick={() => setActiveSection(nav.id)}
                    onMouseEnter={() => setHoveredNav(nav.id)}
                    onMouseLeave={() => setHoveredNav(null)}
                    style={{
                      display: 'flex', alignItems: 'center',
                      padding: '10px 20px', cursor: 'pointer',
                      background: isActive ? 'rgba(168, 85, 247, 0.15)' : isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
                      borderLeft: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)', minWidth: 16 }}>◆</span>
                        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--text-primary)' : isHovered ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'color 0.15s ease' }}>
                          {nav.label}
                        </span>
                      </div>
                      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: 'var(--text-muted)', paddingLeft: 24 }}>{nav.sub}</span>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {/* Progress indicator at bottom */}
          <div style={{ marginTop: 'auto', padding: '16px 20px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: 'var(--text-muted)' }}>steps complete</span>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: 'var(--accent-cyan)' }}>{stepCount}/5</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${(stepCount / 5) * 100}%` }} />
            </div>
          </div>
        </div>

        {/* Main viewer pane */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Idle / waiting state */}
          {stage === 'idle' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--text-muted)', padding: 40 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }}>
                <rect x="3" y="3" width="8" height="8" rx="1" />
                <rect x="13" y="3" width="8" height="8" rx="1" />
                <rect x="3" y="13" width="8" height="8" rx="1" />
                <rect x="13" y="13" width="8" height="8" rx="1" />
              </svg>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, marginBottom: 6, color: 'var(--text-secondary)' }}>change detection inspector</div>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  upload two images (t1 and t2)<br />
                  then run the pipeline to see changes
                </div>
              </div>
            </div>
          )}

          {/* Step images */}
          {activeStepNum !== null && activeSection.startsWith('step-') && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 32 }}>
              {activeImg ? (
                <>
                  <div style={{ alignSelf: 'flex-start', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, color: 'var(--accent-cyan)', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: 4, padding: '3px 8px', letterSpacing: '0.08em' }}>
                      step {activeStepNum} / 5
                    </span>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {CD_STEPS.find(s => s.id === activeSection)?.label}
                    </span>
                  </div>
                  <div style={{ flex: 1, width: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                    <img
                      src={activeImg}
                      alt={`step ${activeStepNum}`}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', borderRadius: 6 }}
                      draggable={false}
                    />
                  </div>
                </>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)' }}>
                  {stage === 'processing' ? (
                    <>
                      <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--accent-blue)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11 }}>awaiting step output...</span>
                    </>
                  ) : (
                    <>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21,15 16,10 5,21" />
                      </svg>
                      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11 }}>no output for this step yet</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Change metrics view */}
          {activeSection === 'change-stats' && result && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, width: '100%', maxWidth: 600 }}>
                <MetricCard
                  label="change regions detected"
                  value={String(result.changeCount)}
                  unit=""
                  color="var(--accent-purple)"
                  large
                />
                <MetricCard
                  label="processing time"
                  value={String(result.processingTime)}
                  unit="s"
                  color="var(--accent-green)"
                  large={false}
                />
                <MetricCard
                  label="pipeline status"
                  value="complete"
                  unit=""
                  color="var(--accent-cyan)"
                  large={false}
                />
              </div>
            </div>
          )}

          {/* Side-by-side compare view */}
          {activeSection === 'change-compare' && result && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* toolbar */}
              <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-secondary)' }}>
                <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, fontWeight: 500, marginRight: 'auto' }}>side by side — annotated pair</span>
                <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={() => handleZoom(0.5)}>zoom +</button>
                <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={() => handleZoom(-0.5)}>zoom -</button>
                <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={resetView}>reset</button>
              </div>

              {/* image pair */}
              <div
                ref={containerRef}
                style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: isDragging ? 'grabbing' : 'grab' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
              >
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomScale})`,
                  transformOrigin: 'center',
                  transition: isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.2, 0, 0, 1)',
                }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>t1 — before</span>
                      <img
                        src={result.image1Url}
                        draggable={false}
                        style={{ maxWidth: 460, maxHeight: 420, display: 'block', borderRadius: 6, border: '1px solid var(--border)', userSelect: 'none' }}
                        alt="t1 annotated"
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>t2 — after</span>
                      <img
                        src={result.image2Url}
                        draggable={false}
                        style={{ maxWidth: 460, maxHeight: 420, display: 'block', borderRadius: 6, border: '1px solid var(--border)', userSelect: 'none' }}
                        alt="t2 annotated"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Global spin keyframe */}
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function DropdownItem({ label, sub, active, onClick }: { label: string; sub: string; active: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 16px',
        cursor: 'pointer',
        background: active ? 'rgba(168, 85, 247, 0.15)' : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        borderLeft: active ? '2px solid var(--accent-blue)' : '2px solid transparent',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
        {sub}
      </div>
    </div>
  )
}

interface UploadSectionProps {
  num: string
  title: string
  sub: string
  active: boolean
  done: boolean
  file: File | null
  preview: string | null
  dragOver: boolean
  setDragOver: (v: boolean) => void
  fileInputRef: React.RefObject<HTMLInputElement>
  onFile: (f: File) => void
}

function UploadSection({ num, title, sub, active, done, file, preview, dragOver, setDragOver, fileInputRef, onFile }: UploadSectionProps) {
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFile(f)
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && f.type.startsWith('image/')) onFile(f)
  }

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', opacity: (!active && !done) ? 0.4 : 1, transition: 'opacity 0.2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, fontWeight: 600, color: done ? 'var(--accent-cyan)' : active ? 'var(--accent-blue)' : 'var(--text-muted)', letterSpacing: '0.05em' }}>
          {done ? '✓' : num}
        </span>
        <div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, fontWeight: 500, color: done ? 'var(--accent-cyan)' : active ? 'var(--text-primary)' : 'var(--text-muted)' }}>{title}</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: 'var(--text-muted)' }}>{sub}</div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleInput} style={{ display: 'none' }} />

      <div
        className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
        style={{ padding: '12px', textAlign: 'center', cursor: active ? 'pointer' : 'default', opacity: active ? 1 : 0.5 }}
        onClick={() => active && fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); if (active) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={active ? handleDrop : undefined}
      >
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11, color: 'var(--text-secondary)' }}>
          {file ? file.name : 'drop image or click'}
        </div>
        {file && (
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {(file.size / 1024).toFixed(0)} kb
          </div>
        )}
      </div>

      {preview && (
        <img
          src={preview}
          alt={title}
          style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)', marginTop: 8, display: 'block' }}
        />
      )}
    </div>
  )
}

function MetricCard({ label, value, unit, color, large }: { label: string; value: string; unit: string; color: string; large: boolean }) {
  return (
    <div className="card" style={{ padding: large ? 32 : 24, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center', background: 'var(--bg-secondary)' }}>
      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: large ? 36 : 24, fontWeight: large ? 600 : 500, color }}>
        {value}<span style={{ fontSize: large ? 14 : 12, color: 'var(--text-muted)' }}>{unit}</span>
      </span>
    </div>
  )
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}