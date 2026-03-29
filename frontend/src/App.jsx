import React from 'react';
import { AppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import enTranslations from '@shopify/polaris/locales/en.json';
import Dashboard from './pages/Dashboard.jsx';

export default function App() {
  return (
    <AppProvider i18n={enTranslations}>
      <Dashboard />
    </AppProvider>
  );
}
