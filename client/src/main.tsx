import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { initLogCapture } from './lib/reportBug'
import App from './App'
import './index.css'

initLogCapture()

// Preload bull back image so it is ready before first deal.
if (typeof window !== 'undefined') {
  const img = new Image()
  img.src = '/bull-back.png'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
