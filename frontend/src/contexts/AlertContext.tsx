import React, { createContext, useContext, useState, useCallback } from 'react';
import AlertDialog from '../components/AlertDialog';

interface AlertContextType {
  showAlert: (message: string, variant?: 'info' | 'success' | 'warning' | 'error', title?: string) => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [alert, setAlert] = useState<{
    message: string;
    variant: 'info' | 'success' | 'warning' | 'error';
    title?: string;
  } | null>(null);

  const showAlert = useCallback((
    message: string,
    variant: 'info' | 'success' | 'warning' | 'error' = 'info',
    title?: string
  ) => {
    setAlert({ message, variant, title });
  }, []);

  const closeAlert = useCallback(() => {
    setAlert(null);
  }, []);

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      {alert && (
        <AlertDialog
          isOpen={!!alert}
          message={alert.message}
          variant={alert.variant}
          title={alert.title}
          onClose={closeAlert}
        />
      )}
    </AlertContext.Provider>
  );
}

export function useAlert() {
  const context = useContext(AlertContext);
  if (context === undefined) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
}





