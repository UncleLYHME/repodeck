import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { init } from './store'

document.documentElement.dataset.platform = window.repodeck?.platform ?? 'linux' // styles leave room for macOS window buttons
void init()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
