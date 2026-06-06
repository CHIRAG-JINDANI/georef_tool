'use client'

import { useState, useRef, useEffect } from 'react'
import type { ProcessingResult } from './Dashboard'

interface PipelineViewerProps {
  stepImages: Record<number, string>
  result: ProcessingResult | null
  onClose: () => void
}

const STEPS = [
  { id: 'step-1', label: 'preprocessing', sub: 'clahe + bilateral' },
  { id: 'step-2', label: 'keypoint detection', sub: 'sift grid bucketing' },
  { id: 'step-3', label: 'ransac inliers', sub: 'affine consensus' },
  { id: 'step-4', label: 'warp + mask', sub: 'alpha boundary' },
  { id: 'step-5', label: 'clean mosaic', sub: 'final overlay' },
]

export default function PipelineViewer({ stepImages, result, onClose }: PipelineViewerProps) {
  const [activeSection, setActiveSection] = useState<string>('step-1')
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)
  const [selectedGcpId, setSelectedGcpId] = useState<number | null>(null)

  const [zoomScale, setZoomScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const clampPan = (newX: number, newY: number, currentScale: number) => {
    if (!containerRef.current) return { x: newX, y: newY }
    const { clientWidth, clientHeight } = containerRef.current

    const extraWidth = Math.max(0, (clientWidth * currentScale - clientWidth) / 2)
    const extraHeight = Math.max(0, (clientHeight * currentScale - clientHeight) / 2)

    const marginX = clientWidth * 0.30
    const marginY = clientHeight * 0.30

    const boundsX = extraWidth + marginX
    const boundsY = extraHeight + marginY

    return {
      x: Math.min(Math.max(newX, -boundsX), boundsX),
      y: Math.min(Math.max(newY, -boundsY), boundsY)
    }
  }

  const handleZoom = (delta: number) => {
    setZoomScale(s => {
      const newScale = Math.max(1, Math.min(s + delta, 10))
      setPan(prev => clampPan(prev.x, prev.y, newScale))
      return newScale
    })
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    handleZoom(0.5)
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
    const newX = e.clientX - dragStart.current.x
    const newY = e.clientY - dragStart.current.y
    setPan(clampPan(newX, newY, zoomScale))
  }

  const handleMouseUp = () => setIsDragging(false)

  const resetView = () => {
    setZoomScale(1)
    setPan({ x: 0, y: 0 })
  }

  const activeStepNum = activeSection.startsWith('step-') ? parseInt(activeSection.replace('step-', '')) : null
  const activeImg = activeStepNum ? stepImages[activeStepNum] : null

  const n = result?.gcpData?.length || 1
  const rmse = result ? Math.sqrt(result.gcpData.reduce((acc, g) => acc + g.residual ** 2, 0) / n) : 0
  const mae = result ? (result.gcpData.reduce((acc, g) => acc + g.residual, 0) / n) : 0
  const maxErr = result ? Math.max(...result.gcpData.map(g => g.residual)) : 0
  const minErr = result ? Math.min(...result.gcpData.map(g => g.residual)) : 0

  const exportQgisPoints = () => {
    if (!result?.gcpData) return

    const header = "mapX,mapY,pixelX,pixelY,enable"
    const lines = result.gcpData.map(g =>
      `${g.dst[0].toFixed(8)},${g.dst[1].toFixed(8)},${g.src[0].toFixed(4)},-${g.src[1].toFixed(4)},1`
    )
    const content = [header, ...lines].join('\n')

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'georef_qgis.points'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>

      <div style={{ height: 48, display: 'flex', alignItems: 'center', padding: '0 20px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', gap: 16, flexShrink: 0 }}>
        <button
          onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11, transition: 'all 0.15s ease' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-active)'; e.currentTarget.style.color = 'var(--accent-cyan)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6" /></svg>
          back
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>pipeline inspector</span>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <div style={{ width: '20%', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', padding: '20px 0', gap: 2, background: 'var(--bg-panel)' }}>
          <div style={{ padding: '0 20px 12px', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>pipeline steps</div>
          {STEPS.map(step => {
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
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', cursor: hasImage ? 'pointer' : 'default', opacity: hasImage ? 1 : 0.35,
                  background: isActive ? 'rgba(168, 85, 247, 0.15)' : isHovered && hasImage ? 'rgba(255,255,255,0.04)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent', transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)', letterSpacing: '0.05em', minWidth: 16 }}>{hasImage ? '✓' : `0${num}`}</span>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--text-primary)' : isHovered && hasImage ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'color 0.15s ease' }}>{step.label}</span>
                  </div>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: 'var(--text-muted)', paddingLeft: 24 }}>{step.sub}</span>
                </div>
              </div>
            )
          })}

          <div style={{ padding: '24px 20px 12px', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>gcp analysis</div>
          {[{ id: 'gcp-table', label: 'gcp points table', sub: 'per-point residuals' }, { id: 'gcp-metrics', label: 'metrics calculated', sub: 'rmse & mae summary' }].map(nav => {
            const isActive = activeSection === nav.id
            const isHovered = hoveredNav === nav.id
            const canClick = !!result?.gcpData
            return (
              <div
                key={nav.id}
                onClick={() => canClick && setActiveSection(nav.id)}
                onMouseEnter={() => setHoveredNav(nav.id)}
                onMouseLeave={() => setHoveredNav(null)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', cursor: canClick ? 'pointer' : 'default', opacity: canClick ? 1 : 0.35,
                  background: isActive ? 'rgba(168, 85, 247, 0.15)' : isHovered && canClick ? 'rgba(255,255,255,0.04)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent', transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)', letterSpacing: '0.05em', minWidth: 16 }}>◆</span>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--text-primary)' : isHovered && canClick ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'color 0.15s ease' }}>{nav.label}</span>
                  </div>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 9, color: 'var(--text-muted)', paddingLeft: 24 }}>{nav.sub}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

          {activeStepNum && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 32 }}>
              {activeImg ? (
                <>
                  <div style={{ alignSelf: 'flex-start', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, color: 'var(--accent-cyan)', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: 4, padding: '3px 8px', letterSpacing: '0.08em' }}>step {activeStepNum} / 5</span>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{STEPS.find(s => s.id === activeSection)?.label}</span>
                  </div>
                  <div style={{ flex: 1, width: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                    <img src={activeImg} alt={`step ${activeStepNum}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', borderRadius: 6 }} />
                    {activeStepNum === 5 && result?.gcpData && (
                      <svg viewBox="0 0 640 640" style={{ position: 'absolute', maxWidth: '100%', maxHeight: '100%', aspectRatio: '1/1' }}>
                        {result.gcpData.map(gcp => (
                          <circle key={`all-${gcp.id}`} cx={gcp.dst[0]} cy={gcp.dst[1]} r={3} fill="red" />
                        ))}
                      </svg>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--text-muted)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" /></svg>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11 }}>no output for this step yet</span>
                </div>
              )}
            </div>
          )}

          {activeSection === 'gcp-table' && result && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>

              <div style={{ width: '55%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: 600 }}>gcp residual data</span>

                  <button
                    onClick={exportQgisPoints}
                    style={{
                      background: 'transparent', border: '1px solid var(--accent-blue)', color: 'var(--accent-cyan)',
                      padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    export qgis .points
                  </button>
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', zIndex: 10 }}>
                      <tr>
                        <th style={{ padding: '10px 12px' }}>id</th>
                        <th style={{ padding: '10px 8px' }}>src x (px)</th>
                        <th style={{ padding: '10px 8px' }}>src y (px)</th>
                        <th style={{ padding: '10px 8px' }}>dst x (px)</th>
                        <th style={{ padding: '10px 8px' }}>dst y (px)</th>
                        <th style={{ padding: '10px 8px' }}>dx</th>
                        <th style={{ padding: '10px 8px' }}>dy</th>
                        <th style={{ padding: '10px 12px' }}>residual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.gcpData.map((gcp) => {
                        const isSelected = selectedGcpId === gcp.id
                        return (
                          <tr
                            key={gcp.id}
                            onClick={() => setSelectedGcpId(isSelected ? null : gcp.id)}
                            style={{
                              cursor: 'pointer', background: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                              borderBottom: '1px solid rgba(255,255,255,0.04)', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'all 0.1s ease'
                            }}
                            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                          >
                            <td style={{ padding: '10px 12px', color: isSelected ? 'var(--accent-purple)' : 'var(--text-muted)' }}>{gcp.id}</td>
                            <td style={{ padding: '10px 8px' }}>{gcp.src[0].toFixed(2)}</td>
                            <td style={{ padding: '10px 8px' }}>{gcp.src[1].toFixed(2)}</td>
                            <td style={{ padding: '10px 8px' }}>{gcp.dst[0].toFixed(2)}</td>
                            <td style={{ padding: '10px 8px' }}>{gcp.dst[1].toFixed(2)}</td>
                            <td style={{ padding: '10px 8px', color: gcp.dx > 10 ? 'var(--accent-red)' : 'inherit' }}>{gcp.dx.toFixed(4)}</td>
                            <td style={{ padding: '10px 8px', color: gcp.dy > 10 ? 'var(--accent-red)' : 'inherit' }}>{gcp.dy.toFixed(4)}</td>
                            <td style={{ padding: '10px 12px', color: isSelected ? 'var(--accent-purple)' : 'inherit' }}>{gcp.residual.toFixed(4)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ width: '45%', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
                <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', zIndex: 10 }}>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, fontWeight: 500, marginRight: 'auto' }}>spatial verifier</span>
                  <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={() => handleZoom(0.5)}>zoom +</button>
                  <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={() => handleZoom(-0.5)}>zoom -</button>
                  <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={resetView}>reset</button>
                </div>

                <div
                  ref={containerRef}
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    position: 'relative',
                    cursor: isDragging ? 'grabbing' : 'grab'
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onDoubleClick={handleDoubleClick}
                  onWheel={handleWheel}
                >
                  <div style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomScale})`,
                    transformOrigin: 'center',
                    transition: isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.2, 0, 0, 1)'
                  }}>

                    <div style={{ position: 'relative', width: '100%', maxWidth: '640px', aspectRatio: '1/1' }}>

                      <img
                        src={stepImages[5]}
                        draggable={false}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
                      />

                      <svg viewBox="0 0 640 640" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                        {result.gcpData.map(gcp => {
                          const isSelected = selectedGcpId === gcp.id
                          return (
                            <g key={`gcp-${gcp.id}`}>
                              <circle
                                cx={gcp.dst[0]} cy={gcp.dst[1]}
                                r={isSelected ? (12 / zoomScale) : (3 / zoomScale)}
                                fill="rgba(168, 85, 247, 0.85)"
                                stroke={isSelected ? "white" : "transparent"}
                                strokeWidth={isSelected ? (2 / zoomScale) : 0}
                              />

                              {isSelected && (
                                <>
                                  <line
                                    x1={gcp.pred[0]} y1={gcp.pred[1]}
                                    x2={gcp.dst[0]} y2={gcp.dst[1]}
                                    stroke="red"
                                    strokeWidth={2.5 / zoomScale}
                                    strokeLinecap="round"
                                  />
                                  <circle
                                    cx={gcp.pred[0]} cy={gcp.pred[1]}
                                    r={4 / zoomScale}
                                    fill="red"
                                  />
                                </>
                              )}
                            </g>
                          )
                        })}
                      </svg>

                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'gcp-metrics' && result && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, width: '100%', maxWidth: 600 }}>
                <div className="card" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center', background: 'var(--bg-secondary)' }}>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, color: 'var(--text-muted)' }}>root mean square error (rmse)</span>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 36, fontWeight: 600, color: 'var(--accent-purple)' }}>{rmse.toFixed(3)}<span style={{ fontSize: 14, color: 'var(--text-muted)' }}> px</span></span>
                </div>

                <div className="card" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center', background: 'var(--bg-secondary)' }}>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, color: 'var(--text-muted)' }}>mean absolute error (mae)</span>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 36, fontWeight: 600, color: 'var(--accent-cyan)' }}>{mae.toFixed(3)}<span style={{ fontSize: 14, color: 'var(--text-muted)' }}> px</span></span>
                </div>

                <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', textAlign: 'center' }}>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, color: 'var(--text-muted)' }}>maximum outlier</span>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 24, fontWeight: 500, color: 'var(--accent-red)' }}>{maxErr.toFixed(3)}<span style={{ fontSize: 12 }}> px</span></span>
                </div>

                <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', textAlign: 'center' }}>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12, color: 'var(--text-muted)' }}>minimum inlier</span>
                  <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 24, fontWeight: 500, color: 'var(--accent-cyan)' }}>{minErr.toFixed(3)}<span style={{ fontSize: 12 }}> px</span></span>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}