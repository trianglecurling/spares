import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { FaFacebookF, FaInstagram, FaYoutube } from 'react-icons/fa';
import { FaXTwitter } from 'react-icons/fa6';
import FormField from '../components/FormField';
import ChoiceInput from '../components/ChoiceInput';
import InlineStateMessage from '../components/InlineStateMessage';
import Modal from '../components/Modal';
import PublicLayout from '../components/PublicLayout';
import SeoMeta from '../components/SeoMeta';
import {
  isKnownContactRecipientSlug,
  resolveContactRecipientSlug,
  toContactRecipientChoiceOptions,
} from '../constants/contactRecipients';
import { usePublicContactRecipients } from '../hooks/usePublicContactRecipients';
import api, { formatApiError } from '../utils/api';

const facilityDetails: Array<{ title: string; body: string }> = [
  { title: 'Bar', body: 'Beer, wine, cider, soda, juice, sports beverages, water, seltzers (NA & alcoholic). Four-tap draft unit.' },
  { title: 'Ice shed', body: 'Concrete base, Marco hacks, filtered+deionized water, speaker system, full Wi-Fi coverage.' },
  { title: 'Live streaming', body: 'Capable of streaming any sheet, audio and video.' },
  { title: 'Outdoors', body: 'Grill, bike rack, bench, night lighting, Wi-Fi coverage.' },
  { title: 'PA/Presentations', body: 'Wireless mic, speakers, projector+screen, additional presentation screens.' },
  { title: 'Parking', body: 'Free, ample, Wi-Fi coverage.' },
  { title: 'Restrooms/Changing Rooms', body: "Men's, Womens. All-Gender changing room also available." },
  { title: 'Season', body: 'Typically Mid-September through Early May.' },
  { title: 'Security', body: 'Full exterior and interior CCTV camera coverage, IR night vision, license plate cameras, professionally monitored alarm system.' },
  { title: 'Stones', body: 'Kays of Scotland - Common Green w/ Blue Hone inserts (purchased 2019). Red & Yellow handles.' },
  { title: 'Viewing', body: 'Monitors with house views above each sheet. One row of stadium seating for each sheet.' },
  { title: 'Warm Room', body: 'Approx 2,300 sqft, ample seating, warming kitchen (ovens, microwave, utensils), TV lounge, stretching bar.' },
  { title: 'Wi-Fi', body: 'Available for members & guests. SSID and password are posted in the warm room.' },
];

export default function PublicContactPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const recipientParam = searchParams.get('recipient');
  const { recipients, loading: recipientsLoading, error: recipientsError } = usePublicContactRecipients({
    includeRecipient: recipientParam,
  });
  const recipientOptions = useMemo(() => toContactRecipientChoiceOptions(recipients), [recipients]);
  const [recipient, setRecipient] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [emailNextStepModalOpen, setEmailNextStepModalOpen] = useState(false);

  const canSubmit =
    recipient.trim().length > 0 &&
    email.trim().length > 0 &&
    subject.trim().length >= 2 &&
    body.trim().length >= 10 &&
    !submitting &&
    !recipientsLoading;

  const scrollToMessageForm = () => {
    const target = document.getElementById('send-message');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (recipients.length === 0) return;
    const param = searchParams.get('recipient');
    setRecipient(resolveContactRecipientSlug(param, recipients));
  }, [recipients, searchParams]);

  useEffect(() => {
    if (location.hash !== '#send-message') return;
    scrollToMessageForm();
  }, [location.hash, searchParams]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setInlineError(null);
    setEmailNextStepModalOpen(false);

    try {
      await api.post('/public/contact/request', {
        recipient,
        email: email.trim(),
        subject: subject.trim(),
        body: body.trim(),
        website: website.trim(),
      });

      setEmailNextStepModalOpen(true);
      setSubject('');
      setBody('');
      setWebsite('');
    } catch (error: unknown) {
      setInlineError(formatApiError(error, 'Unable to submit contact form'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <Modal
        isOpen={emailNextStepModalOpen}
        onClose={() => setEmailNextStepModalOpen(false)}
        title="Check your email"
        size="md"
        verticalAlign="start"
      >
        <p className="text-sm leading-relaxed text-gray-700">
          Check your email for a confirmation message. Click the &quot;Send now&quot; button there to deliver your
          message.
        </p>
        <div className="mt-6 flex justify-end border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => setEmailNextStepModalOpen(false)}
            className="rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2"
          >
            OK
          </button>
        </div>
      </Modal>

      <SeoMeta
        title="Facility & Contact Info"
        description="Get in touch with Triangle Curling Club by email, review facility details, and connect through our social media channels."
        canonicalPath="/contact"
      />

      <div className="public-container public-section space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-teal-100 bg-gradient-to-br from-sky-50 via-white to-teal-50 p-6 sm:p-8 lg:p-10 shadow-sm">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-teal-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-24 bottom-0 h-52 w-52 rounded-full bg-sky-200/50 blur-3xl" />
          <div className="relative space-y-4">
            <div className="public-page-title-rule">
              <h1 className="public-heading text-balance">Facility & contact info</h1>
            </div>
            <p className="public-body max-w-3xl text-base sm:text-lg">
              The best way to reach us is via email using the form below. General inquiries can also be sent to
              info@trianglecurling.com. As our team is staffed exclusively by volunteers, please allow up to 48 hours for
              a response.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={scrollToMessageForm}
                className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Contact us now
              </button>
              <Link
                to="/"
                className="rounded-md border border-teal-200 bg-white px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50"
              >
                Back to homepage
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="public-card p-6 sm:p-7">
            <h2 className="public-subheading">Address</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <article className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Mailing Address</h3>
                <p className="mt-2 text-base font-medium text-gray-900">P.O. Box 14628</p>
                <p className="text-gray-700">Durham, NC 27709</p>
              </article>
              <article className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Physical Address</h3>
                <p className="mt-2 text-base font-medium text-gray-900">2310 So Hi Drive</p>
                <p className="text-gray-700">Durham, NC 27703</p>
              </article>
            </div>
          </div>

          <div className="public-card p-6 sm:p-7">
            <h2 className="public-subheading">Social media</h2>
            <div className="mt-5 grid gap-3">
              <a
                href="https://www.facebook.com/trianglecurling/"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800 hover:bg-blue-100 flex items-center gap-2"
              >
                <FaFacebookF className="h-4 w-4" aria-hidden />
                Facebook
              </a>
              <a
                href="https://x.com/trianglecurling"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-gray-300 bg-gray-100 px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-200 flex items-center gap-2"
              >
                <FaXTwitter className="h-4 w-4" aria-hidden />
                X (Twitter)
              </a>
              <a
                href="https://www.instagram.com/trianglecurling/"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-sm font-medium text-pink-800 hover:bg-pink-100 flex items-center gap-2"
              >
                <FaInstagram className="h-4 w-4" aria-hidden />
                Instagram
              </a>
              <a
                href="https://www.youtube.com/@TriangleCurling"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 hover:bg-red-100 flex items-center gap-2"
              >
                <FaYoutube className="h-4 w-4" aria-hidden />
                YouTube
              </a>
            </div>
          </div>
        </section>

        <section className="public-card p-6 sm:p-7">
          <h2 className="public-subheading">Why we don't have a phone number</h2>
          <div className="mt-4 space-y-4 text-gray-700 leading-relaxed">
            <p>
              Triangle Curling Club is a 501(c)(3) non-profit organization run exclusively by volunteers. Event hosts,
              bartenders, instructors, league coordinators, and facility managers are all unpaid, volunteering in the name
              of the mission of Triangle Curling: to promote the Olympic sport of curling to the residents of North Carolina
              and to develop and support amateur athletes for participating in national and international curling competitions.
            </p>
            <p>
              Because we do not have any full-time staff, we cannot guarantee availability of someone to answer a phone.
              In almost all cases, email is the best way to get in touch with us. We will try our best to be prompt with
              our response.
            </p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
          <div id="send-message" className="public-card scroll-mt-28 p-6 sm:p-7">
            <h2 className="public-subheading">Send a message</h2>
            <p className="mt-2 text-sm text-gray-600">
              After you submit this form, you will receive an email with a <strong>Send now</strong> button.
              Click that button to deliver your message.
            </p>

            {inlineError ? (
              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {inlineError}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <FormField tone="public" label="Recipient" htmlFor="recipient" labelClassName="font-semibold">
                {recipientsLoading ? (
                  <InlineStateMessage title="Loading contact options..." />
                ) : recipientsError ? (
                  <InlineStateMessage title={recipientsError} tone="error" />
                ) : recipientOptions.length === 0 ? (
                  <InlineStateMessage title="No contact options are available right now." />
                ) : (
                  <ChoiceInput<string>
                    inputId="recipient"
                    options={recipientOptions}
                    value={isKnownContactRecipientSlug(recipient, recipients) ? recipient : null}
                    onChange={(next) => {
                      if (next != null && !Array.isArray(next)) setRecipient(next);
                    }}
                    placeholder="Choose a recipient"
                    listboxLabel="Recipient"
                    inputClassName="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                  />
                )}
              </FormField>

              <FormField tone="public" label="Your email" htmlFor="email" required labelClassName="font-semibold">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                />
              </FormField>

              <FormField tone="public" label="Subject" htmlFor="subject" required labelClassName="font-semibold">
                <input
                  id="subject"
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  required
                  maxLength={160}
                  placeholder="How can we help?"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                />
              </FormField>

              <FormField tone="public" label="Message" htmlFor="body" required labelClassName="font-semibold">
                <textarea
                  id="body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  required
                  rows={8}
                  maxLength={8000}
                  placeholder="Share as much detail as possible."
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                />
              </FormField>

              <div className="hidden">
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  type="text"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  autoComplete="off"
                  tabIndex={-1}
                />
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Submitting...' : 'Send confirmation email'}
                </button>
              </div>
            </form>
          </div>

          <aside className="public-card p-6 sm:p-7">
            <h2 className="public-subheading">Facility info</h2>
            <p className="mt-3 text-sm text-gray-700 leading-relaxed">
              Triangle Curling Club is a four-sheet dedicated curling facility located in the Raleigh-Durham metro area
              of North Carolina (known as the Triangle), 12 minutes from Raleigh-Durham International Airport (RDU).
              Triangle Curling is a 501(c)(3) nonprofit organization and exists to promote the Olympic sport of curling
              to the residents of North Carolina.
            </p>

            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {facilityDetails.map((item) => (
                <li key={item.title} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="font-semibold text-gray-900">{item.title}: </span>
                  <span>{item.body}</span>
                </li>
              ))}
            </ul>
          </aside>
        </section>
      </div>
    </PublicLayout>
  );
}
