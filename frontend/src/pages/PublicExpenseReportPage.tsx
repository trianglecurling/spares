import axios from 'axios';
import { FormEvent, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/Button';
import ExpenseReportForm, { type ExpenseFieldError, type ExpenseFormOptions } from '../components/ExpenseReportForm';
import FormField from '../components/FormField';
import PhysicalAddressCollect from '../components/PhysicalAddressCollect';
import PublicLayout from '../components/PublicLayout';
import PublicStateCard from '../components/PublicStateCard';
import SeoMeta from '../components/SeoMeta';
import { publicEventRegistrationInput } from '../components/eventRegistration/PublicRegistrationFieldInput';
import { useAlert } from '../contexts/AlertContext';
import { useAuth } from '../contexts/AuthContext';
import { post } from '../api/client';
import type { AuthenticatedMember } from '../../../backend/src/types.ts';
import api, { formatApiError } from '../utils/api';
import { fieldErrorsFromUnknown, postExpenseFormData } from '../utils/expenseReportSubmit';
import { emptyStructuredPostalAddress, type StructuredPostalAddress } from '../utils/structuredPostalAddress';

type MemberOption = { id: number; name: string };

type FormOptionsResponse = ExpenseFormOptions & {
  submitterPrefill?: {
    name: string;
    email: string | null;
    phone: string | null;
    mailingAddress: StructuredPostalAddress | null;
  } | null;
};

function isSelectionResponse(
  value: unknown
): value is { requiresSelection: true; tempToken: string; members: MemberOption[] } {
  return typeof value === 'object' && value !== null && (value as { requiresSelection?: boolean }).requiresSelection === true;
}

function isLoginSuccessResponse(
  value: unknown
): value is { accessToken: string; refreshToken: string; member: AuthenticatedMember } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accessToken' in value &&
    'refreshToken' in value &&
    'member' in value
  );
}

export default function PublicExpenseReportPage() {
  const { member, login } = useAuth();
  const { showAlert } = useAlert();
  const emailId = useId();
  const codeId = useId();
  const nameId = useId();
  const phoneId = useId();
  const [options, setOptions] = useState<FormOptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'email' | 'code' | 'select' | 'guest' | 'form' | 'success'>(
    member ? 'form' : 'email'
  );
  const [email, setEmail] = useState(member?.email ?? '');
  const [code, setCode] = useState('');
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestAddress, setGuestAddress] = useState(emptyStructuredPostalAddress());
  const [multipleMembers, setMultipleMembers] = useState<MemberOption[]>([]);
  const [tempToken, setTempToken] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ExpenseFieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);

  const loadOptions = async () => {
    setLoading(true);
    try {
      const response = await api.get<FormOptionsResponse>('/public/expenses/form-options');
      setOptions(response.data);
      if (response.data.submitterPrefill) {
        setEmail(response.data.submitterPrefill.email ?? email);
        setGuestName(response.data.submitterPrefill.name);
        setGuestPhone(response.data.submitterPrefill.phone ?? '');
        if (response.data.submitterPrefill.mailingAddress) {
          setGuestAddress(response.data.submitterPrefill.mailingAddress);
        }
      }
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load expense form'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOptions();
  }, [member?.id]);

  useEffect(() => {
    if (member) {
      setStep('form');
      setEmail(member.email ?? '');
      setGuestName(member.name);
      setGuestPhone(member.phone ?? '');
    }
  }, [member]);

  const identity = {
    name: member?.name || guestName,
    email: member?.email || email,
    phone: member?.phone || guestPhone,
    mailingAddress:
      options?.submitterPrefill?.mailingAddress ??
      guestAddress,
  };

  const handleRequestCode = async (event: FormEvent) => {
    event.preventDefault();
    setIdentityError(null);
    setIdentityLoading(true);
    try {
      const response = await post('/auth/request-code', { contact: email.trim() });
      if (isLoginSuccessResponse(response)) {
        await login(response.accessToken, response.refreshToken, response.member, undefined, {
          suppressNavigation: true,
        });
        setStep('form');
        return;
      }
      if (isSelectionResponse(response)) {
        setMultipleMembers(response.members);
        setTempToken(response.tempToken);
        setStep('select');
        return;
      }
      setStep('code');
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setStep('guest');
      } else {
        setIdentityError(formatApiError(err, 'Failed to send a login code.'));
      }
    } finally {
      setIdentityLoading(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setIdentityError(null);
    setIdentityLoading(true);
    try {
      const response = await post('/auth/verify-code', { contact: email.trim(), code });
      if (isSelectionResponse(response)) {
        setMultipleMembers(response.members);
        setTempToken(response.tempToken);
        setStep('select');
        return;
      }
      if (isLoginSuccessResponse(response)) {
        await login(response.accessToken, response.refreshToken, response.member, undefined, {
          suppressNavigation: true,
        });
        setStep('form');
      }
    } catch (err) {
      setIdentityError(formatApiError(err, 'Invalid code.'));
    } finally {
      setIdentityLoading(false);
    }
  };

  const handleSelectMember = async (memberId: number) => {
    setIdentityError(null);
    setIdentityLoading(true);
    try {
      const response = await post('/auth/select-member', { memberId, tempToken });
      if (isLoginSuccessResponse(response)) {
        await login(response.accessToken, response.refreshToken, response.member, undefined, {
          suppressNavigation: true,
        });
        setStep('form');
      }
    } catch (err) {
      setIdentityError(formatApiError(err, 'Failed to sign in.'));
    } finally {
      setIdentityLoading(false);
    }
  };

  const handleGuestContinue = (event: FormEvent) => {
    event.preventDefault();
    if (!guestName.trim()) {
      setIdentityError('Enter your name.');
      return;
    }
    setIdentityError(null);
    setStep('form');
  };

  const handleSubmit = async (input: {
    payload: Record<string, unknown>;
    files: Array<{ index: number; file: File }>;
  }) => {
    setSubmitting(true);
    setFieldErrors([]);
    try {
      await postExpenseFormData('/public/expenses', input.payload, input.files);
      setStep('success');
    } catch (err) {
      const fields = fieldErrorsFromUnknown(err);
      setFieldErrors(fields);
      showAlert(formatApiError(err, 'Could not submit the expense report.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <SeoMeta title="Submit an expense report" />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight text-gray-900">Submit an expense report</h1>
        <p className="mb-8 text-sm leading-relaxed text-gray-600">
          Volunteers can request expense or mileage reimbursement. A confirmation email with a private link will be
          sent after you submit.
        </p>

        {loading || !options ? (
          <PublicStateCard title="Loading" description="Loading the expense form." />
        ) : step === 'success' ? (
          <PublicStateCard
            tone="success"
            title="Report submitted"
            description="A confirmation email is on the way, including a private link to view or update this report."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                {member ? (
                  <Link to="/expenses" className="text-primary-teal-link hover:underline">
                    View your expense reports
                  </Link>
                ) : null}
                <Button
                  type="button"
                  onClick={() => {
                    setFieldErrors([]);
                    setFormResetKey((key) => key + 1);
                    setStep(member ? 'form' : 'email');
                  }}
                >
                  Submit another expense
                </Button>
              </div>
            }
          />
        ) : step === 'email' ? (
          <form onSubmit={handleRequestCode} className="public-card space-y-4 p-6 sm:p-7">
            <FormField label="Email" htmlFor={emailId} required tone="public" error={identityError}>
              <input
                id={emailId}
                type="email"
                autoComplete="email"
                className={publicEventRegistrationInput}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </FormField>
            <Button type="submit" disabled={identityLoading}>
              {identityLoading ? 'Checking…' : 'Continue'}
            </Button>
          </form>
        ) : step === 'code' ? (
          <form onSubmit={handleVerifyCode} className="public-card space-y-4 p-6 sm:p-7">
            <FormField
              label="Enter the 6-digit code"
              htmlFor={codeId}
              required
              tone="public"
              helperText={`Code sent to ${email}`}
              error={identityError}
            >
              <input
                id={codeId}
                className={publicEventRegistrationInput}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
              />
            </FormField>
            <Button type="submit" disabled={identityLoading}>
              {identityLoading ? 'Verifying…' : 'Verify and continue'}
            </Button>
          </form>
        ) : step === 'select' ? (
          <div className="public-card space-y-4 p-6 sm:p-7">
            <p className="text-sm text-gray-600">More than one member uses this contact. Choose your account.</p>
            {identityError ? <p className="text-sm text-red-600">{identityError}</p> : null}
            <div className="space-y-2">
              {multipleMembers.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={identityLoading}
                  onClick={() => void handleSelectMember(option.id)}
                >
                  {option.name}
                </Button>
              ))}
            </div>
          </div>
        ) : step === 'guest' ? (
          <form onSubmit={handleGuestContinue} className="public-card space-y-4 p-6 sm:p-7">
            <p className="text-sm text-gray-600">We don’t have a member account for {email}. Enter your contact details to continue.</p>
            <FormField label="Name" htmlFor={nameId} required tone="public" error={identityError}>
              <input
                id={nameId}
                className={publicEventRegistrationInput}
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Phone" htmlFor={phoneId} required tone="public">
              <input
                id={phoneId}
                className={publicEventRegistrationInput}
                value={guestPhone}
                onChange={(event) => setGuestPhone(event.target.value)}
                required
              />
            </FormField>
            <PhysicalAddressCollect
              tone="public"
              required
              value={guestAddress}
              onChange={setGuestAddress}
              sectionTitle="Mailing address"
            />
            <Button type="submit">Continue</Button>
          </form>
        ) : (
          <div className="public-card p-6 sm:p-7">
            <ExpenseReportForm
              key={formResetKey}
              tone="public"
              formOptions={options}
              identity={identity}
              fieldErrors={fieldErrors}
              submitting={submitting}
              onSubmit={handleSubmit}
            />
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

export type { FormOptionsResponse };
