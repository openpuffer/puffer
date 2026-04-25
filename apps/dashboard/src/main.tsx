import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeContext, useThemeProvider } from './hooks/useTheme';
import './index.css';

function Root() {
  const themeValue = useThemeProvider();
  return (
    <ThemeContext.Provider value={themeValue}>
      <App />
    </ThemeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
