import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { MobileUploadApp } from './MobileUploadApp';
import '../../src/styles/fonts.css';
import '../../src/styles/tokens.css';
import './mobile.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Muse could not find the phone upload root.');
}

createRoot(rootElement).render(
  <StrictMode>
    <MobileUploadApp />
  </StrictMode>,
);
