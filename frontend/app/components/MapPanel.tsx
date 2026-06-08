'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, ImageOverlay, useMapEvents, LayersControl } from 'react-leaflet'
import MapSearchBox from './MapSearchBox'
import type { AppStage, MapViewport, ProcessingResult } from './Dashboard'

interface MapPanelProps {
  stage: AppStage
  viewport: MapViewport
  result: ProcessingResult | null
  onViewportChange: (vp: MapViewport) => void
}

function MapEvents({ onViewportChange }: { onViewportChange: (vp: MapViewport) => void }) {
  useMapEvents({
    moveend: (e) => {
      const map = e.target
      const center = map.getCenter()
      onViewportChange({
        lat: center.lat,
        lng: center.lng,
        zoom: map.getZoom(),
      })
    }
  })
  return null
}

export default function MapPanel({ stage, viewport, result, onViewportChange }: MapPanelProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={[viewport.lat, viewport.lng]}
        zoom={viewport.zoom}
        style={{ width: '100%', height: '100%', zIndex: 0 }}
        zoomControl={false}
        zoomSnap={0.001}
        zoomDelta={0.001}
        wheelPxPerZoomLevel={20}
        scrollWheelZoom={true}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite View">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="&copy; Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EAP, and the GIS User Community"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Terrain View">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}"
              attribution="&copy; Esri, USGS, NOAA"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        <MapEvents onViewportChange={onViewportChange} />
        <MapSearchBox />

        {result && (stage === 'preview' || stage === 'validated') && (
          <ImageOverlay
            url={result.stitchedUrl}
            bounds={[
              [result.overlayBounds.south, result.overlayBounds.west],
              [result.overlayBounds.north, result.overlayBounds.east]
            ]}
          />
        )}
      </MapContainer>

      {(stage === 'navigating' || stage === 'captured' || stage === 'ready') && (
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          pointerEvents: 'none'
        }}>
          <Crosshair captured={stage === 'captured' || stage === 'ready'} />
        </div>
      )}

      <MapHUD stage={stage} viewport={viewport} />
    </div>
  )
}

function Crosshair({ captured }: { captured: boolean }) {
  return (
    <div style={{ position: 'relative', width: 0, height: 0 }}>
      <div style={{
        position: 'absolute', width: captured ? 80 : 64, height: captured ? 80 : 64,
        border: `1.5px solid ${captured ? 'rgba(90,138,122,0.85)' : 'rgba(61,107,95,0.65)'}`,
        borderRadius: '50%', top: captured ? -40 : -32, left: captured ? -40 : -32,
        transition: 'all 0.3s ease',
      }} />
      <div style={{
        position: 'absolute', width: 6, height: 6, borderRadius: '50%',
        background: captured ? '#3d6b5f' : '#5a8a7a', top: -3, left: -3,
        boxShadow: `0 0 8px ${captured ? '#3d6b5f' : '#5a8a7a'}`,
      }} />
      <div style={{ position: 'absolute', width: 20, height: 1, background: captured ? 'rgba(90,138,122,0.7)' : 'rgba(61,107,95,0.65)', top: 0, left: -25 }} />
      <div style={{ position: 'absolute', width: 20, height: 1, background: captured ? 'rgba(90,138,122,0.7)' : 'rgba(61,107,95,0.65)', top: 0, left: 5 }} />
      <div style={{ position: 'absolute', width: 1, height: 20, background: captured ? 'rgba(90,138,122,0.7)' : 'rgba(61,107,95,0.65)', top: -25, left: 0 }} />
      <div style={{ position: 'absolute', width: 1, height: 20, background: captured ? 'rgba(90,138,122,0.7)' : 'rgba(61,107,95,0.65)', top: 5, left: 0 }} />
    </div>
  )
}

function MapHUD({ stage, viewport }: { stage: AppStage; viewport: MapViewport }) {
  const metersPerPx = 156543.03392 * Math.cos(viewport.lat * Math.PI / 180) / Math.pow(2, viewport.zoom)
  const coverageM = metersPerPx * 640

  return (
    <>
      <div style={{
        position: 'absolute', bottom: 28, left: 12, display: 'flex', gap: 8, alignItems: 'center', pointerEvents: 'none', zIndex: 10
      }}>
        <div className="card" style={{
          padding: '5px 10px', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 10, color: 'var(--text-secondary)', display: 'flex', gap: 12,
        }}>
          <span>res: <span style={{ color: 'var(--accent-cyan)' }}>{metersPerPx.toFixed(2)} m/px</span></span>
          <span>cov: <span style={{ color: 'var(--accent-cyan)' }}>{(coverageM / 1000).toFixed(2)} km²</span></span>
        </div>
      </div>

      {stage === 'idle' && (
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 10 }}>
          <div className="card" style={{
            padding: '8px 16px', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center',
          }}>
            navigate to the area of your reference image
          </div>
        </div>
      )}

      {stage === 'processing' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 10 }}>
          <div style={{
            position: 'absolute', left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(61,107,95,0.65), transparent)',
            animation: 'scan 2s ease-in-out infinite',
          }} />
        </div>
      )}

      {stage === 'validated' && (
        <div style={{ position: 'absolute', top: 16, right: 16, pointerEvents: 'none', zIndex: 10 }}>
          <div style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.15em',
            color: '#3d6b5f', border: '2px solid rgba(90,138,122,0.55)', borderRadius: 4, padding: '6px 14px',
            background: 'rgba(90,138,122,0.1)', textTransform: 'uppercase',
          }}>
            ✓ georeferenced
          </div>
        </div>
      )}
    </>
  )
}