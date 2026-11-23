import { Link } from 'react-router-dom';

type MemberEventNoticeProps = {
  message: string;
  loginHref?: string | null;
};

export default function MemberEventNotice({ message, loginHref }: MemberEventNoticeProps) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" role="status">
      <p>{message}</p>
      {loginHref ? (
        <div className="mt-3 space-y-3">
          <p>To register, log into your account.</p>
          <Link
            to={loginHref}
            className="inline-flex items-center justify-center rounded-lg bg-primary-teal-solid px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
          >
            Log in
          </Link>
        </div>
      ) : null}
    </div>
  );
}
