'use client'

import { useState } from 'react'

interface PipelineViewerProps {
  stepImages: Record<number, string>
  onClose: () => void
}

const STEPS = [
  { num: 1, label: 'preprocessing', sub: 'clahe + bilateral' },
  { num: 2, label: 'keypoint detection', sub: 'sift grid bucketing' },
  { num: 3, label: 'ransac inliers', sub: 'affine consensus' },
  { num: 4, label: 'warp + mask', sub: 'alpha boundary' },
  { num: 5, label: 'clean mosaic', sub: 'final overlay' },
]

export default function PipelineViewer({ stepImages, onClose }: PipelineViewerProps) {
  const [activeStep, setActiveStep] = useState<number>(
    // Default to first available step
    STEPS.find(s => stepImages[s.num]) ? (STEPS.find(s => stepImages[s.num])!.num) : 1
  )
  const [hoveredStep, setHoveredStep] = useState<number | null>(null)

  const activeImg = stepImages[activeStep]

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        gap: 16,
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-active)'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-blue)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
            ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15,18 9,12 15,6" />
          </svg>
          back
        </button>

        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

        <span style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>pipeline inspector</span>

        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: 'var(--text-muted)',
        }}>
          {Object.keys(stepImages).length} / 5 steps complete
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left nav — 20% */}
        <div style={{
          width: '20%',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0',
          gap: 2,
          background: 'var(--bg-panel)',
        }}>
          <div style={{
            padding: '0 20px 12px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            steps
          </div>

          {STEPS.map(step => {
            const isActive = activeStep === step.num
            const isHovered = hoveredStep === step.num
            const hasImage = !!stepImages[step.num]

            return (
              <div
                key={step.num}
                onClick={() => hasImage && setActiveStep(step.num)}
                onMouseEnter={() => setHoveredStep(step.num)}
                onMouseLeave={() => setHoveredStep(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 20px',
                  cursor: hasImage ? 'pointer' : 'default',
                  opacity: hasImage ? 1 : 0.35,
                  background: isActive
                    ? 'rgba(99,179,237,0.08)'
                    : isHovered && hasImage
                    ? 'rgba(255,255,255,0.03)'
                    : 'transparent',
                  borderLeft: isActive
                    ? '2px solid var(--accent-blue)'
                    : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 9,
                      color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                      letterSpacing: '0.05em',
                      minWidth: 16,
                    }}>
                      {hasImage ? '✓' : `0${step.num}`}
                    </span>
                    <span style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive
                        ? 'var(--text-primary)'
                        : isHovered && hasImage
                        ? 'rgba(240,240,240,0.9)'
                        : 'var(--text-secondary)',
                      transition: 'color 0.15s ease',
                    }}>
                      {step.label}
                    </span>
                  </div>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    paddingLeft: 24,
                  }}>
                    {step.sub}
                  </span>
                </div>

                {/* Arrow — visible on hover or active */}
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                  opacity: (isActive || (isHovered && hasImage)) ? 1 : 0,
                  transition: 'opacity 0.15s ease',
                }}>
                  ›
                </span>
              </div>
            )
          })}
        </div>

        {/* Right display — 80% */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          background: 'var(--bg-primary)',
          overflow: 'hidden',
        }}>
          {activeImg ? (
            <>
              {/* Step label */}
              <div style={{
                alignSelf: 'flex-start',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: 'var(--accent-blue)',
                  background: 'rgba(99,179,237,0.1)',
                  border: '1px solid rgba(99,179,237,0.25)',
                  borderRadius: 4,
                  padding: '3px 8px',
                  letterSpacing: '0.08em',
                }}>
                  step {activeStep} / 5
                </span>
                <span style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                }}>
                  {STEPS.find(s => s.num === activeStep)?.label}
                </span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: 'var(--text-muted)',
                }}>
                  — {STEPS.find(s => s.num === activeStep)?.sub}
                </span>
              </div>

              {/* Image */}
              <div style={{
                flex: 1,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
              }}>
                <img
                  key={activeStep}
                  src={activeImg}
                  alt={`step ${activeStep}`}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    display: 'block',
                    borderRadius: 6,
                  }}
                />
              </div>
            </>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              color: 'var(--text-muted)',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21,15 16,10 5,21" />
              </svg>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                {Object.keys(stepImages).length === 0
                  ? 'run the pipeline to see step outputs'
                  : 'no output for this step yet'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
