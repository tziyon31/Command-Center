import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { runCollectionDueBackfillPreview } from '@/lib/collectionDueBackfillPreview'
import { runCollectionDueBackfill } from '@/lib/collectionDueBackfillExecutor'
import { runCollectionDuePostBackfillValidation } from '@/lib/collectionDuePostBackfillValidation'

if (typeof window !== 'undefined') {
  window.runCollectionDueBackfillPreview = runCollectionDueBackfillPreview
  window.runCollectionDueBackfill = runCollectionDueBackfill
  window.runCollectionDuePostBackfillValidation = runCollectionDuePostBackfillValidation
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
