import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

import './index.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
