type VolunteerHourLogSignupAlertProps = {
  className?: string;
};

export default function VolunteerHourLogSignupAlert({ className }: VolunteerHourLogSignupAlertProps) {
  return (
    <div
      className={`app-alert border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100${
        className ? ` ${className}` : ''
      }`}
      role="status"
    >
      <p className="font-medium">Website signups are logged automatically.</p>
      <p className="mt-1">
        Do not also log those hours as self-reported time.
      </p>
    </div>
  );
}
