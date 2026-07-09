import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';

/**
 * `/go/:slug` (except `/go/:slug/info`) is handled by the backend as an HTTP redirect
 * with permalink hit tracking. Client-side React Router navigations never hit that
 * handler, so this route forces a full document load of the current URL.
 */
export default function PublicGoPermalinkRedirect() {
  const location = useLocation();

  useEffect(() => {
    window.location.replace(`${location.pathname}${location.search}${location.hash}`);
  }, [location.pathname, location.search, location.hash]);

  return (
    <PublicLayout>
      <div className="public-container public-section">
        <PublicStateCard title="Redirecting" description="Please wait…" />
      </div>
    </PublicLayout>
  );
}
