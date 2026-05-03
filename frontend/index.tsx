import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
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
