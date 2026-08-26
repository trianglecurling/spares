import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post } from '../api/client';
import api, {
  clearAuthTokens,
  ensureAccessTokenResult,
  getAccessToken,
  getRefreshToken,
  storeAuthTokens,
} from '../utils/api';
import { getCachedMemberDisplayName, storeCachedMemberDisplayName } from '../utils/memberDisplayCache';
import { isPublicLightPath } from '../utils/publicLightPaths';
import { restoreAuthSession } from '../utils/restoreAuthSession';
import {
  clearDeveloperSessionStash,
  readDeveloperSessionStash,
  resolveDeveloperSession,
  writeDeveloperSessionStash,
  type DeveloperSessionInfo,
} from '../utils/developerSession';
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
  logout: (redirectTo?: string) => void;
  updateMember: (member: AuthenticatedMember) => void;
  isLoading: boolean;
  /** True once the initial session verify attempt has finished (or was skipped). */
  sessionSettled: boolean;
  /** True when verified member exists, or a stored token is awaiting verify. */
  isLikelyAuthenticated: boolean;
  /** Verified or cached member name for optimistic profile display. */
  memberDisplayName: string | null;
  actorMemberId: number | null;
  isImpersonating: boolean;
  accountSwitchOptions: AccountSwitchOption[];
  switchToMemberAccount: (targetMemberId: number) => Promise<void>;
  stopImpersonation: () => Promise<void>;
  developerSession: DeveloperSessionInfo | null;
  signInAsMember: (targetMemberId: number) => Promise<void>;
  returnFromDeveloperSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getInitialIsLoading(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  const currentPath = window.location.pathname;
  if (currentPath.startsWith('/install')) {
    return false;
  }
  return !isPublicLightPath(currentPath);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialToken = getAccessToken();
  const [member, setMember] = useState<AuthenticatedMember | null>(null);
  const [token, setToken] = useState<string | null>(initialToken);
  const [isLoading, setIsLoading] = useState(getInitialIsLoading);
  const [sessionSettled, setSessionSettled] = useState(() => !initialToken);
  const [actorMemberId, setActorMemberId] = useState<number | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [accountSwitchOptions, setAccountSwitchOptions] = useState<AccountSwitchOption[]>([]);
  const [developerSession, setDeveloperSession] = useState<DeveloperSessionInfo | null>(() => {
    const stash = readDeveloperSessionStash();
    if (!stash) return null;
    return {
      operatorMemberId: stash.operatorMemberId,
      operatorName: stash.operatorName,
      targetMemberId: stash.targetMemberId,
      targetName: stash.targetName,
    };
  });
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
    leagueManagerLeagueIds: value.leagueManagerLeagueIds ?? [],
    ownedEventIds: value.ownedEventIds ?? [],
  });

  const applySessionPayload = useCallback((data: SessionPayload) => {
    const normalizedMember = normalizeMember({
      ...data.member,
      themePreference: normalizeThemePreference(data.member.themePreference),
    } as AuthenticatedMember);
    setMember(normalizedMember);
    storeCachedMemberDisplayName(normalizedMember.name);
    setActorMemberId(data.actorMemberId);
    setIsImpersonating(data.isImpersonating);
    setAccountSwitchOptions(data.accountSwitchOptions);
    setDeveloperSession(resolveDeveloperSession(normalizedMember.id));
  }, []);

  const clearAccountSwitchState = useCallback(() => {
    setActorMemberId(null);
    setIsImpersonating(false);
    setAccountSwitchOptions([]);
  }, []);

  useEffect(() => {
    const abort = new AbortController();

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        if (abort.signal.aborted) {
          resolve();
          return;
        }
        const timeoutId = window.setTimeout(resolve, ms);
        abort.signal.addEventListener(
          'abort',
          () => {
            window.clearTimeout(timeoutId);
            resolve();
          },
          { once: true },
        );
      });

    const verifyToken = async () => {
      const currentPath = window.location.pathname;
      const hasStoredSession = Boolean(getAccessToken() || getRefreshToken());

      if (currentPath.startsWith('/install')) {
        setIsLoading(false);
        setSessionSettled(true);
        return;
      }

      const allowImmediateRender = isPublicLightPath(currentPath);
      if (allowImmediateRender) {
        setIsLoading(false);
      }

      if (hasStoredSession) {
        // Retry through brief API downtime (deploys) instead of treating it as logout.
        const result = await restoreAuthSession({
          ensureAccessToken: ensureAccessTokenResult,
          verify: async () => {
            const response = await get('/auth/verify');
            return {
              member: response.member as AuthenticatedMember,
              actorMemberId: response.actorMemberId,
              isImpersonating: response.isImpersonating,
              accountSwitchOptions: response.accountSwitchOptions,
            };
          },
          isCancelled: () => abort.signal.aborted,
          sleep,
        });

        if (abort.signal.aborted) {
          return;
        }

        if (result.status === 'success') {
          applySessionPayload(result.session);
          setToken(getAccessToken());
        } else if (result.status === 'unauthenticated') {
          clearAuthTokens();
          setToken(null);
          clearAccountSwitchState();
        }
      }

      if (abort.signal.aborted) {
        return;
      }

      setSessionSettled(true);

      if (!allowImmediateRender) {
        setIsLoading(false);
      }
    };

    void verifyToken();
    return () => abort.abort();
  }, [applySessionPayload, clearAccountSwitchState]);

  const login = async (
    accessToken: string,
    refreshToken: string,
    newMember: AuthenticatedMember,
    redirectTo?: string,
    options?: { suppressNavigation?: boolean },
  ) => {
    const previousStash = readDeveloperSessionStash();
    if (previousStash) {
      api.post('/auth/logout', { refreshToken: previousStash.refreshToken }).catch(() => {});
    }
    clearDeveloperSessionStash();
    setDeveloperSession(null);
    storeAuthTokens(accessToken, refreshToken);
    setToken(accessToken);
    const normalizedMember = normalizeMember(newMember);
    setMember(normalizedMember);
    storeCachedMemberDisplayName(normalizedMember.name);

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
      setDeveloperSession(null);
    }

    if (!options?.suppressNavigation) {
      navigate(redirectTo || '/dashboard');
    }
  };

  const logout = (redirectTo?: string) => {
    const refreshToken = getRefreshToken();
    const previousStash = readDeveloperSessionStash();
    api.post('/auth/logout', { refreshToken }).catch(() => {});
    if (previousStash) {
      api.post('/auth/logout', { refreshToken: previousStash.refreshToken }).catch(() => {});
    }
    clearDeveloperSessionStash();
    setDeveloperSession(null);
    clearAuthTokens();
    setToken(null);
    setMember(null);
    setSessionSettled(true);
    clearAccountSwitchState();
    navigate(redirectTo || '/login');
  };

  const updateMember = (updatedMember: AuthenticatedMember) => {
    const normalizedMember = normalizeMember(updatedMember);
    setMember(normalizedMember);
    storeCachedMemberDisplayName(normalizedMember.name);
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

  const signInAsMember = async (targetMemberId: number) => {
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    if (!member || !accessToken || !refreshToken) {
      throw new Error('Not signed in');
    }

    const response = await post('/auth/sign-in-as', { targetMemberId });
    const existing = readDeveloperSessionStash();
    if (existing) {
      writeDeveloperSessionStash({
        ...existing,
        targetMemberId: response.member.id,
        targetName: response.member.name,
      });
    } else {
      writeDeveloperSessionStash({
        accessToken,
        refreshToken,
        operatorMemberId: member.id,
        operatorName: member.name,
        targetMemberId: response.member.id,
        targetName: response.member.name,
      });
    }

    storeAuthTokens(response.accessToken, response.refreshToken);
    setToken(response.accessToken);
    applySessionPayload({
      member: response.member as AuthenticatedMember,
      actorMemberId: response.actorMemberId,
      isImpersonating: response.isImpersonating,
      accountSwitchOptions: response.accountSwitchOptions,
    });
    navigate('/dashboard');
  };

  const returnFromDeveloperSession = async () => {
    const stash = readDeveloperSessionStash();
    if (!stash) {
      throw new Error('No investigation session to return from');
    }

    const currentRefreshToken = getRefreshToken();
    api.post('/auth/logout', { refreshToken: currentRefreshToken }).catch(() => {});

    storeAuthTokens(stash.accessToken, stash.refreshToken);
    setToken(stash.accessToken);
    clearDeveloperSessionStash();
    setDeveloperSession(null);

    try {
      const session = await get('/auth/verify');
      applySessionPayload({
        member: session.member as AuthenticatedMember,
        actorMemberId: session.actorMemberId,
        isImpersonating: session.isImpersonating,
        accountSwitchOptions: session.accountSwitchOptions,
      });
      navigate('/admin/members');
    } catch (error) {
      clearAuthTokens();
      setToken(null);
      setMember(null);
      setSessionSettled(true);
      clearAccountSwitchState();
      navigate('/login');
      throw error;
    }
  };

  const isLikelyAuthenticated = Boolean(member || (token && !sessionSettled));
  const memberDisplayName =
    member?.name ?? (isLikelyAuthenticated ? getCachedMemberDisplayName() : null);

  return (
    <AuthContext.Provider
      value={{
        member,
        token,
        login,
        logout,
        updateMember,
        isLoading,
        sessionSettled,
        isLikelyAuthenticated,
        memberDisplayName,
        actorMemberId,
        isImpersonating,
        accountSwitchOptions,
        switchToMemberAccount,
        stopImpersonation,
        developerSession,
        signInAsMember,
        returnFromDeveloperSession,
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
