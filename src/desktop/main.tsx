import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@/styles/app.css';
import '@/styles/desktop.css';
import { DesktopApp } from './DesktopApp';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
