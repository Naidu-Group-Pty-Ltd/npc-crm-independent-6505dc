import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installChunkFailureRecovery } from './lib/chunkRecovery'

// Must run before the first route chunk is requested: a dynamic import that
// fails with no listener rejects into nothing and leaves the page dead.
installChunkFailureRecovery()

// ── Service Worker Cleanup ──
// Remove any previously registered service workers EXCEPT our dedicated push SW
// (`/sw-push.js`), which is intentionally registered on production hosts only.
// Lovable's hosting + Vite content-hashing handle caching natively;
// any other custom SW only causes stale-content issues on the published site.
const PUSH_SW_PATH = '/sw-push.js'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      const swUrl =
        registration.active?.scriptURL ||
        registration.installing?.scriptURL ||
        registration.waiting?.scriptURL ||
        ''
      if (swUrl.endsWith(PUSH_SW_PATH)) {
        // Keep the push notification service worker
        continue
      }
      registration.unregister().then((success) => {
        if (success) {
          console.log('[SW Cleanup] Unregistered service worker:', registration.scope)
        }
      })
    }
  })
}

// Purge all caches left behind by the old service worker
if ('caches' in window) {
  caches.keys().then((names) => {
    for (const name of names) {
      caches.delete(name).then(() => {
        console.log('[Cache Cleanup] Deleted cache:', name)
      })
    }
  })
}

// v2.1 - Force republish for DNS propagation
createRoot(document.getElementById("root")!).render(<App />)
