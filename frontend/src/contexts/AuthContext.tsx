import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { get, post } from '../api/client';
import api, { clearAuthTokens, getAccessToken, getRefreshToken, storeAuthTokens } from '../utils/api';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';

export type AccountSwitchOption = { id: number; name: string };

type SessionPayload = {
  member: AuthenticatedMember;
  actorMemberId: number;
  isImpersonating: boolean;
  accountSwitchOptions: AccountSwitchOption[];
};

interface AuthContextType {
  member: AuthenticatedMember | null;
  token: string | null;
  login: (
    accessToken: string,
    refreshToken: string,
    newMember: AuthenticatedMember,
    redirectTo?: string,
    options?: { suppressNavigation?: boolean },
  ) => Promise<void>;
  logout: () => void;
  updateMember: (member: AuthenticatedMember) => void;
  isLoading: boolean;
  actorMemberId: number | null;
  isImpersonating: boolean;
  accountSwitchOptions: AccountSwitchOption[];
  switchToMemberAccount: (targetMemberId: number) => Promise<void>;
  stopImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<AuthenticatedMember | null>(null);
  const [token, setToken] = useState<string | null>(getAccessToken());
  const [isLoading, setIsLoading] = useState(true);
  const [actorMemberId, setActorMemberId] = useState<number | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [accountSwitchOptions, setAccountSwitchOptions] = useState<AccountSwitchOption[]>([]);
  const navigate = useNavigate();

  const normalizeThemePreference = (
    value: string | null | undefined
  ): AuthenticatedMember['themePreference'] => {
    if (value === 'light' || value === 'dark' || value === 'system') {
      return value;
    }
    return 'system';
  };

  const normalizeMember = (value: AuthenticatedMember): AuthenticatedMember => ({
    ...value,
    themePreference: normalizeThemePreference(value.themePreference),
    roleCodes: value.roleCodes ?? [],
    roleNames: value.roleNames ?? [],
    scopeRules: value.scopeRules ?? [],
  });

  const applySessionPayload = useCallback((data: SessionPayload) => {
    setMember(
      normalizeMember({
        ...data.member,
        themePreference: normalizeThemePreference(data.member.themePreference),
      } as AuthenticatedMember)
    );
    setActorMemberId(data.actorMemberId);
    setIsImpersonating(data.isImpersonating);
    setAccountSwitchOptions(data.accountSwitchOptions);
  }, []);

  const clearAccountSwitchState = useCallback(() => {
    setActorMemberId(null);
    setIsImpersonating(false);
    setAccountSwitchOptions([]);
  }, []);

  useEffect(() => {
    // Verify existing token
    const verifyToken = async () => {
      const currentToken = getAccessToken();

      // Skip verification if we're on the install page
      const currentPath = window.location.pathname;
      if (currentPath.startsWith('/install')) {
        setIsLoading(false);
        return;
      }

      if (currentToken) {
        try {
          const response = await get('/auth/verify');
          applySessionPayload({
            member: response.member as AuthenticatedMember,
            actorMemberId: response.actorMemberId,
            isImpersonating: response.isImpersonating,
            accountSwitchOptions: response.accountSwitchOptions,
          });
          setToken(getAccessToken());

          // Redirect to first login if needed
          if (!response.member.firstLoginCompleted) {
            // Preserve where the user was trying to go so we can return after first-login setup.
            // Special-case spare accept links so we can restore the requestId flow reliably.
            const intendedPath = window.location.pathname + window.location.search;
            try {
              const currentPathInner = window.location.pathname;
              const currentSearch = window.location.search;
              const params = new URLSearchParams(currentSearch);

              if (currentPathInner === '/spare-request/respond') {
                const requestId = params.get('requestId');
                if (requestId) {
                  sessionStorage.setItem('pendingSpareAcceptRequestId', requestId);
                  sessionStorage.setItem('postFirstLoginSuggestAvailability', '1');
                }
              } else if (currentPathInner === '/spare-request/decline') {
                const requestId = params.get('requestId');
                if (requestId) {
                  sessionStorage.setItem('pendingSpareDeclineRequestId', requestId);
                  sessionStorage.setItem('postFirstLoginSuggestAvailability', '1');
                }
              } else if (currentPathInner !== '/first-login' && currentPathInner !== '/login') {
                // Avoid storing /first-login as the redirect target (that creates a loop back to dashboard).
                sessionStorage.setItem('postFirstLoginRedirect', intendedPath);
              }
            } catch {
              // ignore
            }
            navigate('/first-login', { replace: true });
          }
        } catch (error: unknown) {
          // If database is not configured (503), don't clear token - just fail silently
          if (
            axios.isAxiosError(error) &&
            error.response?.status === 503 &&
            error.response?.data?.requiresInstallation
          ) {
            // Database not configured - don't verify token, but don't clear it either
            // Intentionally silent: user may be on the install flow
          } else {
            console.error('Token verification failed:', error);
            clearAuthTokens();
            setToken(null);
            clearAccountSwitchState();
          }
        }
      }
      setIsLoading(false);
    };

    verifyToken();
  }, []);

  const login = async (
    accessToken: string,
    refreshToken: string,
    newMember: AuthenticatedMember,
    redirectTo?: string,
    options?: { suppressNavigation?: boolean },
  ) => {
    storeAuthTokens(accessToken, refreshToken);
    setToken(accessToken);
    setMember(normalizeMember(newMember));

    try {
      const session = await get('/auth/verify');
      applySessionPayload({
        member: session.member as AuthenticatedMember,
        actorMemberId: session.actorMemberId,
        isImpersonating: session.isImpersonating,
        accountSwitchOptions: session.accountSwitchOptions,
      });
    } catch {
      setActorMemberId(newMember.id);
      setIsImpersonating(false);
      setAccountSwitchOptions([]);
    }

    if (!newMember.firstLoginCompleted) {
      try {
        if (redirectTo) {
          sessionStorage.setItem('postFirstLoginRedirect', redirectTo);
        }
      } catch {
        // ignore
      }
      navigate('/first-login', { replace: true });
      return;
    }
    if (!options?.suppressNavigation) {
      navigate(redirectTo || '/dashboard');
    }
  };

  const logout = () => {
    const refreshToken = getRefreshToken();
    api.post('/auth/logout', { refreshToken }).catch(() => {});
    clearAuthTokens();
    setToken(null);
    setMember(null);
    clearAccountSwitchState();
    navigate('/login');
  };

  const updateMember = (updatedMember: AuthenticatedMember) => {
    setMember(normalizeMember(updatedMember));
  };

  const switchToMemberAccount = async (targetMemberId: number) => {
    const response = await post('/auth/impersonate', { targetMemberId });
    storeAuthTokens(response.accessToken, response.refreshToken);
    setToken(response.accessToken);
    applySessionPayload({
      member: response.member as AuthenticatedMember,
      actorMemberId: response.actorMemberId,
      isImpersonating: response.isImpersonating,
      accountSwitchOptions: response.accountSwitchOptions,
    });
  };

  const stopImpersonation = async () => {
    const { data } = await api.post<SessionPayload & { accessToken: string; refreshToken: string }>('/auth/stop-impersonation');
    storeAuthTokens(data.accessToken, data.refreshToken);
    setToken(data.accessToken);
    applySessionPayload({
      member: data.member as AuthenticatedMember,
      actorMemberId: data.actorMemberId,
      isImpersonating: data.isImpersonating,
      accountSwitchOptions: data.accountSwitchOptions,
    });
  };

  return (
    <AuthContext.Provider
      value={{
        member,
        token,
        login,
        logout,
        updateMember,
        isLoading,
        actorMemberId,
        isImpersonating,
        accountSwitchOptions,
        switchToMemberAccount,
        stopImpersonation,
      }}
    >
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
