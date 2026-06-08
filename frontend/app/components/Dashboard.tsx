'use client'

import { useState, useCallback, useEffect } from 'react'
import dynamic from 'next/dynamic'
import ControlPanel from './ControlPanel'
import LogPanel from './LogPanel'
import ResultPanel from './ResultPanel'
import PipelineViewer from './PipelineViewer'

// Dynamically import MapPanel to prevent "window is not defined" error during Next.js build
const MapPanel = dynamic(() => import('./MapPanel'), {
  ssr: false,
  loading: () => (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'var(--bg-panel)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-muted)',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      fontSize: 12
    }}>
      initializing spatial canvas...
    </div>
  )
})

export type AppStage =
  | 'idle'
  | 'navigating'
  | 'captured'
  | 'uploading'
  | 'ready'
  | 'processing'
  | 'preview'
  | 'validated'

export interface MapViewport {
  lat: number
  lng: number
  zoom: number
}

export interface GCPData {
  id: number
  src: [number, number]
  dst: [number, number]
  pred: [number, number]
  dx: number
  dy: number
  residual: number
}

export interface ProcessingResult {
  stitchedUrl: string
  overlayBounds: {
    north: number
    south: number
    east: number
    west: number
  }
  geotiffUrl: string
  inlierCount: number
  matchScore: number
  gcpData: GCPData[]
}

export interface LogEntry {
  type: 'info' | 'ok' | 'warn' | 'error' | 'dim'
  msg: string
  ts: number
}

export default function Dashboard() {
  const [stage, setStage] = useState<AppStage>('idle')
  const [viewport, setViewport] = useState<MapViewport>({ lat: 28.6139, lng: 77.209, zoom: 14 })
  const [capturedProxy, setCapturedProxy] = useState<string | null>(null)
  const [referenceFile, setReferenceFile] = useState<File | null>(null)
  const [referencePreview, setReferencePreview] = useState<string | null>(null)
  const [result, setResult] = useState<ProcessingResult | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [imageType, setImageType] = useState<'sharp' | 'medium' | 'blurry' | null>(null)

  const [flipHorizontal, setFlipHorizontal] = useState(false)
  const [flipVertical, setFlipVertical] = useState(false)

  const [stepImages, setStepImages] = useState<Record<number, string>>({})
  const [viewerOpen, setViewerOpen] = useState(false)

  useEffect(() => {
    setLogs([
      { type: 'dim', msg: 'georef studio v1.0 — ready', ts: Date.now() },
      { type: 'dim', msg: 'navigate map → capture proxy → upload reference → run', ts: Date.now() },
    ])
  }, [])

  const addLog = useCallback((type: LogEntry['type'], msg: string) => {
    setLogs(prev => [...prev, { type, msg, ts: Date.now() }])
  }, [])

  const handleViewportChange = useCallback((vp: MapViewport) => {
    setViewport(vp)
    if (stage === 'idle') setStage('navigating')
  }, [stage])

  const handleCapture = useCallback(async () => {
    addLog('info', `capturing proxy @ [${viewport.lat.toFixed(5)}, ${viewport.lng.toFixed(5)}] z${viewport.zoom}`)
    const mpp = 156543.03392 * Math.cos(viewport.lat * Math.PI / 180) / Math.pow(2, viewport.zoom)
    const dLat = (320 * mpp) / 111320
    const dLng = (320 * mpp) / (111320 * Math.cos(viewport.lat * Math.PI / 180))
    const bbox = `${viewport.lng - dLng},${viewport.lat - dLat},${viewport.lng + dLng},${viewport.lat + dLat}`
    const staticUrl = `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&size=640,640&format=jpg&f=image`

    setCapturedProxy(staticUrl)
    setStage('captured')
    addLog('ok', `proxy image locked — 640×640px satellite`)
    addLog('dim', `pixel resolution: ${mpp.toFixed(3)} m/px`)
  }, [viewport, addLog])

  const handleReferenceUpload = useCallback((file: File) => {
    setStage('uploading')
    setReferenceFile(file)
    setTimeout(() => {
      const url = URL.createObjectURL(file)
      setReferencePreview(url)
      setStage('ready')
      addLog('ok', `reference loaded — ${file.name} (${(file.size / 1024).toFixed(0)} KB)`)
    }, 450)
  }, [addLog])

  const handleProcess = useCallback(async () => {
    if (!referenceFile || !capturedProxy || !imageType) return
    setStage('processing')
    setResult(null)
    setStepImages({})
    addLog('info', 'dispatching to python pipeline...')

    try {
      const formData = new FormData()
      formData.append('reference_image', referenceFile)
      formData.append('proxy_url', capturedProxy)
      formData.append('center_lat', String(viewport.lat))
      formData.append('center_lng', String(viewport.lng))
      formData.append('zoom', String(viewport.zoom))
      formData.append('image_type', imageType)
      formData.append('map_width', '640')
      formData.append('map_height', '640')
      formData.append('flip_h', String(flipHorizontal))
      formData.append('flip_v', String(flipVertical))

      // Reads target environment URL set in Vercel settings, drops back to local fallback if offline
      const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

      const resp = await fetch(`${baseURL}/process`, {
        method: 'POST',
        body: formData,
      })

      if (!resp.ok) throw new Error('pipeline network error')

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('no response stream received')

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
            setResult(payload.data)
            setStage('preview')
            addLog('ok', `pipeline complete — ${payload.data.inlierCount} inlier matches`)
            addLog('ok', `match score: ${(payload.data.matchScore * 100).toFixed(1)}%`)
            addLog('info', 'preview ready — validate to unlock geotiff export')
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      addLog('error', `pipeline failed: ${message}`)
      setStage('ready')
    }
  }, [referenceFile, capturedProxy, viewport, imageType, flipHorizontal, flipVertical, addLog])

  const handleValidate = useCallback(() => {
    setStage('validated')
    addLog('ok', 'result validated ✓')
    addLog('info', 'geotiff export unlocked — wgs84 / epsg:4326')
  }, [addLog])

  const handleReset = useCallback(() => {
    setStage('idle')
    setCapturedProxy(null)
    setReferenceFile(null)
    setReferencePreview(null)
    setResult(null)
    setStepImages({})
    setViewerOpen(false)
    setFlipHorizontal(false)
    setFlipVertical(false)
    setLogs([
      { type: 'dim', msg: 'session reset', ts: Date.now() },
      { type: 'dim', msg: 'navigate map → capture proxy → upload reference → run', ts: Date.now() },
    ])
  }, [])

  return (
    <>
      {viewerOpen && (
        <PipelineViewer
          stepImages={stepImages}
          result={result}
          onClose={() => setViewerOpen(false)}
        />
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr 280px',
        gridTemplateRows: '48px 1fr',
        height: '100vh',
        background: 'var(--bg-primary)',
        gap: 0,
      }}>
        <header style={{
          gridColumn: '1 / -1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          zIndex: 10,
        }}>
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
            <span style={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
            }}>GeoRef Studio</span>
            <span style={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: 10,
              color: 'var(--text-muted)',
              letterSpacing: '0.1em',
            }}>v1.0</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <StageIndicator stage={stage} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CoordDisplay viewport={viewport} />
            </div>
            <button className="btn-ghost" onClick={handleReset} style={{ fontSize: 10, padding: '5px 12px' }}>
              reset session
            </button>
          </div>
        </header>

        <aside style={{
          borderRight: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel)',
        }}>
          <ControlPanel
            stage={stage}
            viewport={viewport}
            capturedProxy={capturedProxy}
            referencePreview={referencePreview}
            referenceFile={referenceFile}
            imageType={imageType}
            setImageType={setImageType}
            flipHorizontal={flipHorizontal}
            setFlipHorizontal={setFlipHorizontal}
            flipVertical={flipVertical}
            setFlipVertical={setFlipVertical}
            onCapture={handleCapture}
            onUpload={handleReferenceUpload}
            onProcess={handleProcess}
          />
        </aside>

        <main style={{ position: 'relative', overflow: 'hidden' }}>
          <MapPanel
            stage={stage}
            viewport={viewport}
            result={result}
            onViewportChange={handleViewportChange}
          />
        </main>

        <aside style={{
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel)',
          overflow: 'hidden',
        }}>
          <ResultPanel
            stage={stage}
            result={result}
            onValidate={handleValidate}
          />
          <hr className="sep" />
          <LogPanel
            logs={logs}
            stepImages={stepImages}
            onOpenViewer={() => setViewerOpen(true)}
          />
        </aside>
      </div>
    </>
  )
}

function StageIndicator({ stage }: { stage: AppStage }) {
  const config: Record<AppStage, { label: string; cls: string }> = {
    idle: { label: 'idle', cls: 'badge-idle' },
    navigating: { label: 'navigating', cls: 'badge-ready' },
    captured: { label: 'captured', cls: 'badge-ready' },
    uploading: { label: 'uploading', cls: 'badge-running' },
    ready: { label: 'ready', cls: 'badge-ready' },
    processing: { label: 'processing', cls: 'badge-running' },
    preview: { label: 'preview', cls: 'badge-ready' },
    validated: { label: 'validated', cls: 'badge-done' },
  }
  const { label, cls } = config[stage]
  return (
    <span className={`badge ${cls}`} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {stage === 'processing' && (
        <span className="pulse-dot" style={{
          display: 'inline-block', width: 5, height: 5,
          borderRadius: '50%', background: 'var(--accent-amber)',
        }} />
      )}
      {label}
    </span>
  )
}

function CoordDisplay({ viewport }: { viewport: MapViewport }) {
  return (
    <span className="coord-pill">
      {viewport.lat.toFixed(4)}°n, {viewport.lng.toFixed(4)}°e  z{viewport.zoom}
    </span>
  )
}