import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { resolveLegacyHashPath } from './utils/legacyHashRoute';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Rewrite any link still pointing at the old HashRouter shape
// (`/#/sachi-ojima/access`) to the real BrowserRouter path before the app
// ever mounts, so the router resolves the page the link meant instead of
// the homepage.
const legacyPath = resolveLegacyHashPath(window.location.href);
if (legacyPath !== null) {
  try {
    window.history.replaceState(null, '', legacyPath);
  } catch (error) {
    // A rewrite failure must never stop the app from mounting — the guest
    // just lands on the un-rewritten URL instead of the intended page.
    console.warn('Could not rewrite legacy hash route:', error);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    let hasUnregistered = false;
    for(let registration of registrations) {
      registration.unregister();
      hasUnregistered = true;
    }
    if (hasUnregistered) {
       console.log('Unregistered rogue service workers. Reloading...');
       window.location.reload();
    }
  });
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
