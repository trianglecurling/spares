import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { patch } from '../api/client';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'themePreference';

const isTheme = (value: unknown): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system';

const getStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

const resolveTheme = (themePreference: Theme): ResolvedTheme => {
  if (themePreference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return themePreference;
};

// Apply theme to the document. Defensive: remove stray `.dark` anywhere (e.g. if it ever
// got added to <body> or #root), then only add it back to <html> for dark mode.
const applyResolvedTheme = (resolved: ResolvedTheme) => {
  // Remove any lingering `dark` class anywhere in the DOM (except we may re-add to <html>)
  document.querySelectorAll('.dark').forEach((el) => el.classList.remove('dark'));

  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  }

  // Keep native form controls in sync too
  root.style.colorScheme = resolved;
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { member, updateMember } = useAuth();
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getStoredTheme())
  );

  // When the member loads/changes, treat the backend preference as the source of truth.
  useEffect(() => {
    if (!member?.themePreference) return;
    if (!isTheme(member.themePreference)) return;

    setThemeState(member.themePreference);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, member.themePreference);
    } catch {
      // ignore
    }
  }, [member?.themePreference]);

  // Apply theme whenever it changes.
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
  }, [theme]);

  // If we're following system, react to changes in OS/browser theme.
  useEffect(() => {
    if (theme !== 'system') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const resolved = resolveTheme('system');
      setResolvedTheme(resolved);
      applyResolvedTheme(resolved);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = async (newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // ignore
    }
    
    // Save to backend if user is logged in
    if (member) {
      try {
        const response = await patch('/members/me', {
          themePreference: newTheme,
        });
        updateMember({
          ...response,
          themePreference: isTheme(response.themePreference) ? response.themePreference : 'system',
        });
      } catch (error) {
        console.error('Failed to update theme preference:', error);
      }
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

