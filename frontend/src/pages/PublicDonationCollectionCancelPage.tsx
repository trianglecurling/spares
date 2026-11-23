import { Link, useParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';

export default function PublicDonationCollectionCancelPage() {
  const { slug = '' } = useParams<{ slug: string }>();

  return (
    <PublicLayout>
      <SeoMeta
        title="Donation canceled | Triangle Curling Club"
        description="Your donation checkout was canceled."
        canonicalPath={slug ? `/donations/${slug}/cancel` : '/donations'}
      />
      <div className="public-container public-section">
        <section className="public-card mx-auto max-w-2xl space-y-4 p-7 sm:p-9">
          <div className="public-page-title-rule">
            <h1 className="public-heading">Donation canceled</h1>
          </div>
          <p className="text-sm text-gray-700">No payment was collected. You can return to the donation page and try again.</p>
          <Link to={`/donations/${slug}`} className="inline-flex text-sm font-semibold text-emerald-800 hover:underline">
            Back to the donation page
          </Link>
        </section>
      </div>
    </PublicLayout>
  );
}
