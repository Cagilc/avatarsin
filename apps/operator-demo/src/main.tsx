import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles.css';
import { App } from './App';
import { ConnectorsPage } from './ConnectorsPage';
import { StatesLab } from './StatesLab';

/** #estados opens the avatar test bench, #conectores the connector review; anything else the demo. */
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (hash === '#estados') return <StatesLab />;
  if (hash === '#conectores') return <ConnectorsPage />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
