import { useCallback, useEffect, useState } from 'react';
import api from '../utils/api';
import {
  PUBLIC_BOOTSTRAP_INVALIDATED_EVENT,
  publicBootstrapFetchConfig,
} from '../utils/publicBootstrapClient';

export interface SiteBranding {
  clubName: string | null;
  logoUrl: string | null;
}

let cachedBranding: SiteBranding | null = null;

export function syncSiteBrandingFromConfig(
  config: { clubName?: string | null; logoUrl?: string | null } | null | undefined,
): void {
  if (!config) return;
  cachedBranding = {
    clubName: config.clubName ?? null,
    logoUrl: config.logoUrl ?? null,
  };
}

export function useSiteBranding(): { branding: SiteBranding | null; loading: boolean } {
  const [branding, setBranding] = useState<SiteBranding | null>(cachedBranding);
  const [loading, setLoading] = useState(!cachedBranding);

  const loadBranding = useCallback(() => {
    return api
      .get<{ siteConfig?: { clubName?: string | null; logoUrl?: string | null } | null }>(
        '/public/bootstrap',
        publicBootstrapFetchConfig,
      )
      .then((response) => {
        const config = response.data?.siteConfig ?? null;
        syncSiteBrandingFromConfig(config);
        setBranding(cachedBranding);
        setLoading(false);
      })
      .catch(() => {
        if (!cachedBranding) {
          cachedBranding = { clubName: null, logoUrl: null };
        }
        setBranding(cachedBranding);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (cachedBranding) {
      setBranding(cachedBranding);
      setLoading(false);
      return;
    }
    void loadBranding();
  }, [loadBranding]);

  useEffect(() => {
    const onInvalidated = () => {
      cachedBranding = null;
      setLoading(true);
      void loadBranding();
    };
    window.addEventListener(PUBLIC_BOOTSTRAP_INVALIDATED_EVENT, onInvalidated);
    return () => window.removeEventListener(PUBLIC_BOOTSTRAP_INVALIDATED_EVENT, onInvalidated);
  }, [loadBranding]);

  return { branding, loading };
}
