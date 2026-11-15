// React mount. The only thing this module does is set the initial theme on
// the document element and hand off to App. All drawing, all layout, all
// attention state live below; main.jsx never renders anything.
//
// The document element gets `data-theme` from `prefers-color-scheme` at
// mount (via a matchMedia listener so a system theme change is picked up
// without a reload). A manual override in a future stage would set the
// same attribute; the generated `attention.css` keys its per-theme rules
// on `:root[data-theme="light|dark"]`.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

function setTheme() {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  document.documentElement.setAttribute('data-theme', mql.matches ? 'dark' : 'light');
  mql.addEventListener('change', (e) => {
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
  });
}
setTheme();

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
