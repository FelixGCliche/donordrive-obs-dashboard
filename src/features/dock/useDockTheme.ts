import { createContext, useContext, useSyncExternalStore } from 'react'

import type { DockTheme } from './dockSearch'

const DARK_QUERY = '(prefers-color-scheme: dark)'

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const prefersDark = () => window.matchMedia(DARK_QUERY).matches

/** Whether the dock renders dark, following the OS for `system`. */
export const useIsDarkDock = (theme: DockTheme): boolean => {
  const systemDark = useSyncExternalStore(subscribe, prefersDark, () => true)
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/** Lets portaled content (tooltips) match the dock theme. */
export const DockDarkContext = createContext(true)

export const useDockDark = (): boolean => useContext(DockDarkContext)
