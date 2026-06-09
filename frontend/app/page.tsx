'use client'

import { useState } from 'react'
import Dashboard from './components/Dashboard'
import ChangeDetectionDashboard from './components/ChangeDetectionDashboard'

export type ActiveTool = 'georef' | 'change-detection'

export default function Home() {
  const [activeTool, setActiveTool] = useState<ActiveTool>('georef')

  if (activeTool === 'change-detection') {
    return <ChangeDetectionDashboard onSwitchTool={() => setActiveTool('georef')} />
  }

  return <Dashboard onSwitchToChangeDet={() => setActiveTool('change-detection')} />
}
