import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// v000636
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
