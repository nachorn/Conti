import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { initLogCapture } from './lib/reportBug'
import App from './App'
import './index.css'
import { registerInstallableApp } from './lib/installApp'

initLogCapture()
registerInstallableApp()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
  <BrowserRouter>
    <App />
  </BrowserRouter>
  </React.StrictMode>,
)
