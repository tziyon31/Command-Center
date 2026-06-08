import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { runCollectionDueBackfillPreview } from '@/lib/collectionDueBackfillPreview'
import { runCollectionDueBackfill } from '@/lib/collectionDueBackfillExecutor'

if (typeof window !== 'undefined') {
  window.runCollectionDueBackfillPreview = runCollectionDueBackfillPreview
  window.runCollectionDueBackfill = runCollectionDueBackfill
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
