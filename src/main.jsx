import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
// TEMP: remove after one-time test CollectionDue cleanup is confirmed
import {
  cleanupOneTestCollectionDueByFingerprint,
  cleanupOneTestCollectionDueById,
  previewCollectionDueCleanupCandidates,
} from '@/lib/oneTimeCleanupCollectionDue'

if (typeof window !== 'undefined') {
  window.cleanupOneTestCollectionDueById = cleanupOneTestCollectionDueById
  window.previewCollectionDueCleanupCandidates = previewCollectionDueCleanupCandidates
  window.cleanupOneTestCollectionDueByFingerprint = cleanupOneTestCollectionDueByFingerprint
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
