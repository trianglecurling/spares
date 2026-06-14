import PublicStateCard from './PublicStateCard';

export default function RouteLoadingFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center px-4 py-12">
      <PublicStateCard title="Loading…" tone="neutral" />
    </div>
  );
}
