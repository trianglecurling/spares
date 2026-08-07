import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';

/**
 * Legacy confirmation URL from the old email double-opt-in contact flow.
 * Messages are now sent directly after solving a CAPTCHA on /contact.
 */
export default function PublicContactConfirmPage() {
  return (
    <PublicLayout>
      <SeoMeta
        title="Contact Confirmation | Triangle Curling Club"
        description="Contact confirmation for Triangle Curling Club."
        canonicalPath="/contact/confirm"
      />

      <div className="public-container public-section">
        <div className="mx-auto max-w-2xl">
          <section className="public-card p-7 sm:p-9">
            <div className="public-page-title-rule">
              <h1 className="public-heading">Confirmation no longer required</h1>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-gray-700">
              Contact messages are now sent directly from the contact form after a short CAPTCHA check. If you still have
              an older confirmation email, you can ignore it and submit a new message from the contact page.
            </p>
            <div className="mt-6">
              <Link
                to="/contact#send-message"
                className="inline-flex items-center rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2"
              >
                Go to contact form
              </Link>
            </div>
          </section>
        </div>
      </div>
    </PublicLayout>
  );
}
