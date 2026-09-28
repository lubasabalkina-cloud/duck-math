import React, { createContext, useContext, useMemo, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isLoadingAuth] = useState(false);
  const [isLoadingPublicSettings] = useState(false);
  const [authError] = useState(null);

  const value = useMemo(() => ({
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    navigateToLogin: () => {
      window.location.href = '/';
    },
  }), [isLoadingAuth, isLoadingPublicSettings, authError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    return {
      isLoadingAuth: false,
      isLoadingPublicSettings: false,
      authError: null,
      navigateToLogin: () => {},
    };
  }
  return context;
}
