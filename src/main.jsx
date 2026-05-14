import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// v233112
import App from './App.jsx'
import { logError } from './lib/logger.js'

// Capture globale des erreurs JS non gérées
window.onerror = (msg, src, line, col, err) => {
  logError('window.onerror', err || { message: msg }, { src, line, col })
  return false
}
window.addEventListener('unhandledrejection', (e) => {
  logError('unhandledrejection', e.reason)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
