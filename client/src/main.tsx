import React from 'react'
import ReactDOM from 'react-dom/client'
import { initLogCapture } from './lib/reportBug'
import App from './App'
import './index.css'

initLogCapture()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
