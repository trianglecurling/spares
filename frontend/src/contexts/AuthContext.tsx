import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

interface Member {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  spareOnly?: boolean;
  isAdmin: boolean;
  isServerAdmin?: boolean;
  firstLoginCompleted: boolean;
  optedInSms: boolean;
  emailSubscribed: boolean;
  emailVisible: boolean;
  phoneVisible: boolean;
  themePreference?: 'light' | 'dark' | 'system';
}

interface AuthContextType {
  member: Member | null;
  token: string | null;
  login: (token: string, member: Member, redirectTo?: string) => void;
  logout: () => void;
  updateMember: (member: Member) => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('authToken'));
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // Check for token in URL (from email links)
    const urlToken = searchParams.get('token');
    if (urlToken) {
      localStorage.setItem('authToken', urlToken);
      setToken(urlToken);
      // Remove token from URL but preserve any other query params (e.g. requestId)
      const params = new URLSearchParams(window.location.search);
      params.delete('token');
      const newSearch = params.toString();
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (newSearch ? `?${newSearch}` : '')
      );
    }

    // Verify existing token
    const verifyToken = async () => {
      const currentToken = urlToken || token;
      
      // Skip verification if we're on the install page
      const currentPath = window.location.pathname;
      if (currentPath.startsWith('/install')) {
        setIsLoading(false);
        return;
      }
      
      if (currentToken) {
        try {
          const response = await api.get('/auth/verify', {
            headers: { Authorization: `Bearer ${currentToken}` },
          });
          setMember(response.data.member);
          
          // Redirect to first login if needed
          if (!response.data.member.firstLoginCompleted) {
            // Preserve where the user was trying to go so we can return after first-login setup.
            // Special-case spare accept links so we can restore the requestId flow reliably.
            const intendedPath = window.location.pathname + window.location.search;
            try {
              const currentPath = window.location.pathname;
              const currentSearch = window.location.search;
              const params = new URLSearchParams(currentSearch);

              if (currentPath === '/spare-request/respond') {
                const requestId = params.get('requestId');
                if (requestId) {
                  sessionStorage.setItem('pendingSpareAcceptRequestId', requestId);
                  sessionStorage.setItem('postFirstLoginSuggestAvailability', '1');
                }
              } else if (currentPath === '/spare-request/decline') {
                const requestId = params.get('requestId');
                if (requestId) {
                  sessionStorage.setItem('pendingSpareDeclineRequestId', requestId);
                  sessionStorage.setItem('postFirstLoginSuggestAvailability', '1');
                }
              } else if (currentPath !== '/first-login' && currentPath !== '/login') {
                // Avoid storing /first-login as the redirect target (that creates a loop back to dashboard).
                sessionStorage.setItem('postFirstLoginRedirect', intendedPath);
              }
            } catch {
              // ignore
            }
            navigate('/first-login', { replace: true });
          }
        } catch (error: any) {
          // If database is not configured (503), don't clear token - just fail silently
          if (error.response?.status === 503 && error.response?.data?.requiresInstallation) {
            // Database not configured - don't verify token, but don't clear it either
            // Intentionally silent: user may be on the install flow
          } else {
            console.error('Token verification failed:', error);
            localStorage.removeItem('authToken');
            setToken(null);
          }
        }
      }
      setIsLoading(false);
    };

    verifyToken();
  }, []);

  const login = (newToken: string, newMember: Member, redirectTo?: string) => {
    localStorage.setItem('authToken', newToken);
    setToken(newToken);
    setMember(newMember);
    
    if (!newMember.firstLoginCompleted) {
      try {
        if (redirectTo) {
          sessionStorage.setItem('postFirstLoginRedirect', redirectTo);
        }
      } catch {
        // ignore
      }
      navigate('/first-login', { replace: true });
    } else {
      // Use the redirect destination if provided, otherwise default to dashboard
      navigate(redirectTo || '/');
    }
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setToken(null);
    setMember(null);
    navigate('/login');
  };

  const updateMember = (updatedMember: Member) => {
    setMember(updatedMember);
  };

  return (
    <AuthContext.Provider value={{ member, token, login, logout, updateMember, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
