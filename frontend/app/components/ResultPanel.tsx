'use client'

import type { AppStage, ProcessingResult } from './Dashboard'

interface ResultPanelProps {
  stage: AppStage
  result: ProcessingResult | null
  onValidate: () => void
}

export default function ResultPanel({ stage, result, onValidate }: ResultPanelProps) {
  const handleDownload = () => {
    if (!result?.geotiffUrl) return
    const a = document.createElement('a')
    a.href = result.geotiffUrl
    a.download = `georef_${Date.now()}.tif`
    a.click()
  }

  const getMatchProfile = (count: number) => {
    if (count < 30) {
      return { label: 'Poor Match Quality', color: 'var(--accent-red)', pct: Math.min(100, (count / 30) * 100), fill: 'linear-gradient(90deg, #fc8181, #e53e3e)' }
    } else if (count >= 30 && count < 55) {
      return { label: 'Moderate Match Quality', color: 'var(--accent-amber)', pct: 50, fill: 'linear-gradient(90deg, #f6ad55, #ed8936)' }
    } else if (count >= 55 && count < 75) {
      return { label: 'Good Match Quality', color: 'var(--accent-blue)', pct: 75, fill: 'linear-gradient(90deg, #5a8a7a, #3d6b5f)' }
    } else {
      return { label: 'Excellent Match Quality', color: 'var(--accent-green)', pct: 100, fill: 'linear-gradient(90deg, #3d6b5f, #5a8a7a)' }
    }
  }

  const profile = result ? getMatchProfile(result.inlierCount) : null

  return (
    <div style={{ padding: '14px 16px', flexShrink: 0 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>result</div>

      {/* No result yet */}
      {!result && (
        <div style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontSize: 10,
          color: 'var(--text-muted)',
          padding: '8px 0',
        }}>
          awaiting pipeline...
        </div>
      )}

      {/* Stats */}
      {result && profile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Match quality bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: profile.color, fontFamily: 'monospace', fontWeight: 600, textTransform: 'lowercase' }}>
                {profile.label}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                {result.inlierCount} pts
              </span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{
                width: `${profile.pct}%`,
                background: profile.fill,
              }} />
            </div>
          </div>

          {/* Stats grid */}
          <div className="card" style={{ padding: '8px 10px' }}>
            {[
              ['inlier matches', String(result.inlierCount)],
              ['crs', 'EPSG:4326'],
              ['north', `${result.overlayBounds.north.toFixed(5)}°`],
              ['south', `${result.overlayBounds.south.toFixed(5)}°`],
              ['east', `${result.overlayBounds.east.toFixed(5)}°`],
              ['west', `${result.overlayBounds.west.toFixed(5)}°`],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{k}</span>
                <span style={{ fontSize: 10, color: 'var(--accent-cyan)', fontFamily: 'monospace' }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          {stage === 'preview' && (
            <button className="btn-validate" onClick={onValidate} style={{ width: '100%' }}>
              ✓ validate result
            </button>
          )}

          {stage === 'validated' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontSize: 10,
                color: 'var(--accent-green)',
                textAlign: 'center',
                padding: '4px 0',
              }}>
                ✓ validated — WGS84 / EPSG:4326
              </div>
              <button className="btn-download" onClick={handleDownload} style={{ width: '100%' }}>
                ↓ export geotiff
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}