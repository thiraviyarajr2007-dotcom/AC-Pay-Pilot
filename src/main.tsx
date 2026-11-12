import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { RoleProvider } from './context/RoleContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter>
      <RoleProvider>
        <App />
      </RoleProvider>
    </BrowserRouter>
  </ErrorBoundary>
);
