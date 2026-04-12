import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App audit={window.__AUDIT__} status={window.__STATUS__} />
  </React.StrictMode>,
);
