import { useCallback, useEffect, useState } from 'react';
import api from '../utils/api';
import {
  PUBLIC_BOOTSTRAP_INVALIDATED_EVENT,
  publicBootstrapFetchConfig,
} from '../utils/publicBootstrapClient';

export interface SiteBranding {
  clubName: string | null;
  logoUrl: string | null;
  isPreviewDatabase: boolean;
}

let cachedBranding: SiteBranding | null = null;

export const SITE_BRANDING_SYNCED_EVENT = 'site-branding-synced';

function notifySiteBrandingSynced(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SITE_BRANDING_SYNCED_EVENT));
  }
}

export function syncSiteBrandingFromConfig(
  config: { clubName?: string | null; logoUrl?: string | null } | null | undefined,
): void {
  if (!config) return;
  cachedBranding = {
    clubName: config.clubName ?? null,
    logoUrl: config.logoUrl ?? null,
    isPreviewDatabase: cachedBranding?.isPreviewDatabase ?? false,
  };
}

export function syncSiteBrandingFromBootstrap(
  data:
    | {
        siteConfig?: { clubName?: string | null; logoUrl?: string | null } | null;
        isPreviewDatabase?: boolean;
      }
    | null
    | undefined,
): void {
  if (!data) return;
  cachedBranding = {
    clubName: data.siteConfig?.clubName ?? null,
    logoUrl: data.siteConfig?.logoUrl ?? null,
    isPreviewDatabase: data.isPreviewDatabase === true,
  };
  notifySiteBrandingSynced();
}

export function useSiteBranding(): { branding: SiteBranding | null; loading: boolean } {
  const [branding, setBranding] = useState<SiteBranding | null>(cachedBranding);
  const [loading, setLoading] = useState(!cachedBranding);

  const loadBranding = useCallback(() => {
    return api
      .get<{
        siteConfig?: { clubName?: string | null; logoUrl?: string | null } | null;
        isPreviewDatabase?: boolean;
      }>('/public/bootstrap', publicBootstrapFetchConfig)
      .then((response) => {
        syncSiteBrandingFromBootstrap(response.data);
        setBranding(cachedBranding);
        setLoading(false);
      })
      .catch(() => {
        if (!cachedBranding) {
          cachedBranding = { clubName: null, logoUrl: null, isPreviewDatabase: false };
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

  useEffect(() => {
    const onSynced = () => {
      if (cachedBranding) {
        setBranding(cachedBranding);
      }
    };
    window.addEventListener(SITE_BRANDING_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SITE_BRANDING_SYNCED_EVENT, onSynced);
  }, []);

  return { branding, loading };
}
