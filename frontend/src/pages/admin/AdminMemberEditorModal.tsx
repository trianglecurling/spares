import { useEffect, useId, useMemo, useState } from 'react';
import { del, get, patch, post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';
import PageTabs from '../../components/PageTabs';
import PhysicalAddressCollect from '../../components/PhysicalAddressCollect';
import ProfilePaymentHistoryTab from '../../components/profile/ProfilePaymentHistoryTab';
import api, { formatApiError } from '../../utils/api';
import type { MemberSummary as Member } from '../../../../backend/src/types.ts';
import type { MemberProfileResponse, MemberSeasonMembershipResponse } from '../../../../backend/src/api/types.ts';
import {
  emptyMemberDemographicsForm,
  memberDemographicsFormFromProfile,
  type MemberDemographicsFormFields,
} from '../../utils/memberDemographicsForm';
import {
  emptyMemberGuardianForm,
  isMemberMinor,
  memberGuardianFormFromProfile,
  type MemberGuardianFormFields,
} from '../../utils/memberGuardianForm';
import {
  DEFAULT_REGISTRATION_MAILING_COUNTRY,
  DEFAULT_REGISTRATION_MAILING_STATE,
  serializeRegistrationMailingAddress,
} from '../../utils/registrationMailingAddress';

function memberNameParts(member: Pick<Member, 'name' | 'firstName' | 'lastName'>): {
  firstName: string;
  lastName: string;
} {
  const storedFirst = member.firstName?.trim() ?? '';
  const storedLast = member.lastName?.trim() ?? '';
  if (storedFirst || storedLast) {
    return { firstName: storedFirst, lastName: storedLast };
  }
  const parts = member.name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

type MemberUpdatePayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  mailingAddress: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emailVisible: boolean;
  phoneVisible: boolean;
  lifetimeMember?: boolean;
  isServerAdmin?: boolean;
  baselineOtherClubExperienceYears?: number;
  baselineClubExperienceYears?: number;
  guardianFirstName: string;
  guardianLastName: string;
  guardianEmail: string;
  guardianPhone: string;
};

type MemberCreatePayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  isServerAdmin?: boolean;
};

type RoleRule = {
  scope: string;
  effect: 'allow' | 'deny';
};

type RbacRole = {
  id: number;
  name: string;
  description: string | null;
  isAssignable: boolean;
  rules: RoleRule[];
};

type MemberAssignmentApi = {
  id?: number;
  roleId: number;
  roleName?: string;
  resourceType?: string | null;
  resourceId?: number | null;
};

type AssignmentDraft = {
  id: string;
  roleId: number;
  resourceType: string;
  resourceId: string;
};

type MemberModalTab = 'member' | 'details' | 'memberships' | 'permissions' | 'payment-history';

type SeasonOption = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
};

type MembershipType = 'regular' | 'social' | 'junior_recreational';

const MEMBERSHIP_TYPE_OPTIONS: ChoiceOption<MembershipType>[] = [
  { value: 'regular', label: 'Regular membership' },
  { value: 'social', label: 'Social membership' },
  { value: 'junior_recreational', label: 'Junior recreational membership' },
];

const MEMBERSHIP_TYPE_LABELS: Record<MembershipType, string> = {
  regular: 'Regular membership',
  social: 'Social membership',
  junior_recreational: 'Junior recreational membership',
};

function membershipTypeLabel(type: MembershipType): string {
  return MEMBERSHIP_TYPE_LABELS[type];
}

function membershipStatusLabel(status: MemberSeasonMembershipResponse['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'active':
      return 'Active';
    case 'cancelled':
      return 'Cancelled';
    case 'refunded':
      return 'Refunded';
    case 'expired':
      return 'Expired';
    default:
      return status;
  }
}

function formatMembershipDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString();
}

function makeAssignmentDraft(roleId: number): AssignmentDraft {
  return {
    id: crypto.randomUUID(),
    roleId,
    resourceType: '',
    resourceId: '',
  };
}

export type EditorAuthMember = {
  id: number;
  isServerAdmin?: boolean;
};

type Props = {
  isOpen: boolean;
  editingMember: Member | null;
  currentMember: EditorAuthMember | null;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh the roster. */
  onSaved: () => void | Promise<void>;
};

export default function AdminMemberEditorModal({
  isOpen,
  editingMember,
  currentMember,
  onClose,
  onSaved,
}: Props) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const firstNameInputId = useId();
  const lastNameInputId = useId();
  const emailInputId = useId();
  const phoneInputId = useId();
  const dateOfBirthInputId = useId();
  const emergencyContactNameInputId = useId();
  const emergencyContactPhoneInputId = useId();
  const baselineOtherClubExperienceInputId = useId();
  const baselineClubExperienceInputId = useId();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    lifetimeMember: false,
    isServerAdmin: false,
    emailVisible: false,
    phoneVisible: false,
    baselineOtherClubExperienceYears: '0',
    baselineClubExperienceYears: '0',
  });
  const [submitting, setSubmitting] = useState(false);
  const [assignableRoles, setAssignableRoles] = useState<RbacRole[]>([]);
  const [memberAssignments, setMemberAssignments] = useState<AssignmentDraft[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [activeMemberModalTab, setActiveMemberModalTab] = useState<MemberModalTab>('member');
  const [seasonMemberships, setSeasonMemberships] = useState<MemberSeasonMembershipResponse[]>([]);
  const [seasonMembershipsLoading, setSeasonMembershipsLoading] = useState(false);
  const [seasonMembershipsError, setSeasonMembershipsError] = useState<string | null>(null);
  const [seasonOptions, setSeasonOptions] = useState<SeasonOption[]>([]);
  const [seasonOptionsLoading, setSeasonOptionsLoading] = useState(false);
  const [newMembershipSeasonId, setNewMembershipSeasonId] = useState<number | null>(null);
  const [newMembershipType, setNewMembershipType] = useState<MembershipType>('regular');
  const [membershipActionSubmitting, setMembershipActionSubmitting] = useState(false);
  const addMembershipSeasonInputId = useId();
  const addMembershipTypeInputId = useId();
  const [demographics, setDemographics] = useState<MemberDemographicsFormFields>(emptyMemberDemographicsForm);
  const [guardian, setGuardian] = useState<MemberGuardianFormFields>(emptyMemberGuardianForm);
  const [profileLoading, setProfileLoading] = useState(false);

  const resetFormClosed = () => {
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      lifetimeMember: false,
      isServerAdmin: false,
      emailVisible: false,
      phoneVisible: false,
      baselineOtherClubExperienceYears: '0',
      baselineClubExperienceYears: '0',
    });
    setAssignableRoles([]);
    setMemberAssignments([]);
    setAssignmentsError(null);
    setActiveMemberModalTab('member');
    setSeasonMemberships([]);
    setSeasonMembershipsError(null);
    setSeasonMembershipsLoading(false);
    setSeasonOptions([]);
    setSeasonOptionsLoading(false);
    setNewMembershipSeasonId(null);
    setNewMembershipType('regular');
    setMembershipActionSubmitting(false);
    setDemographics(emptyMemberDemographicsForm());
    setGuardian(emptyMemberGuardianForm());
    setProfileLoading(false);
  };

  useEffect(() => {
    if (!isOpen) {
      resetFormClosed();
      return;
    }

    setAssignmentsError(null);
    setActiveMemberModalTab('member');

    if (editingMember) {
      const isServerAdmin = editingMember.isServerAdmin || false;
      const { firstName, lastName } = memberNameParts(editingMember);
      setFormData({
        firstName,
        lastName,
        email: editingMember.email || '',
        phone: editingMember.phone || '',
        lifetimeMember: Boolean(editingMember.lifetimeMember),
        isServerAdmin: isServerAdmin,
        emailVisible: editingMember.emailVisible,
        phoneVisible: editingMember.phoneVisible,
        baselineOtherClubExperienceYears: String(editingMember.baselineOtherClubExperienceYears ?? 0),
        baselineClubExperienceYears: String(editingMember.baselineClubExperienceYears ?? 0),
      });
      setAssignmentsError(null);
      setAssignableRoles([]);
      setMemberAssignments([]);
      if (currentMember?.isServerAdmin) {
        setAssignmentsLoading(true);
      } else {
        setAssignmentsLoading(false);
      }
    } else {
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        lifetimeMember: false,
        isServerAdmin: false,
        emailVisible: false,
        phoneVisible: false,
        baselineOtherClubExperienceYears: '0',
        baselineClubExperienceYears: '0',
      });
      setAssignableRoles([]);
      setMemberAssignments([]);
    }
  }, [isOpen, editingMember?.id, currentMember?.isServerAdmin]);

  useEffect(() => {
    const memberId = editingMember?.id;
    if (!isOpen || memberId === undefined) return;
    let cancelled = false;
    async function fetchProfile() {
      setProfileLoading(true);
      try {
        const profile = await api.get<MemberProfileResponse>(`/members/${memberId}/profile`);
        if (cancelled) return;
        setDemographics(memberDemographicsFormFromProfile(profile.data));
        setGuardian(memberGuardianFormFromProfile(profile.data));
      } catch {
        if (!cancelled) {
          setDemographics(emptyMemberDemographicsForm());
          setGuardian(emptyMemberGuardianForm());
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }
    void fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [isOpen, editingMember?.id]);

  useEffect(() => {
    const memberId = editingMember?.id;
    if (!isOpen || memberId === undefined || !currentMember?.isServerAdmin) return;

    let cancelled = false;
    async function fetchAssignments() {
      setAssignmentsLoading(true);
      setAssignmentsError(null);
      try {
        const [rolesResponse, assignmentsResponse] = await Promise.all([
          api.get<RbacRole[]>('/rbac/roles'),
          api.get<MemberAssignmentApi[]>(`/rbac/members/${memberId}/assignments`),
        ]);
        if (cancelled) return;
        const roles = rolesResponse.data.filter((role) => role.isAssignable);
        const firstRoleId = roles[0]?.id ?? 0;
        setAssignableRoles(roles);
        setMemberAssignments(
          assignmentsResponse.data.map((assignment) => ({
            id: crypto.randomUUID(),
            roleId: assignment.roleId || firstRoleId,
            resourceType: assignment.resourceType ?? '',
            resourceId:
              assignment.resourceId === null || assignment.resourceId === undefined
                ? ''
                : String(assignment.resourceId),
          }))
        );
      } catch (error: unknown) {
        if (!cancelled) {
          setAssignableRoles([]);
          setMemberAssignments([]);
          setAssignmentsError(formatApiError(error, 'Failed to load roles and assignments'));
        }
      } finally {
        if (!cancelled) setAssignmentsLoading(false);
      }
    }
    void fetchAssignments();
    return () => {
      cancelled = true;
    };
  }, [isOpen, editingMember?.id, currentMember?.isServerAdmin]);

  useEffect(() => {
    const memberId = editingMember?.id;
    if (!isOpen || memberId === undefined || activeMemberModalTab !== 'memberships') return;
    if (formData.lifetimeMember) {
      setSeasonMemberships([]);
      setSeasonMembershipsLoading(false);
      setSeasonMembershipsError(null);
      return;
    }

    let cancelled = false;
    async function fetchSeasonMemberships() {
      setSeasonMembershipsLoading(true);
      setSeasonMembershipsError(null);
      try {
        const memberships = await get('/members/{id}/season-memberships', undefined, { id: String(memberId) });
        if (!cancelled) setSeasonMemberships(memberships);
      } catch (error: unknown) {
        if (!cancelled) {
          setSeasonMemberships([]);
          setSeasonMembershipsError(formatApiError(error, 'Failed to load memberships'));
        }
      } finally {
        if (!cancelled) setSeasonMembershipsLoading(false);
      }
    }

    void fetchSeasonMemberships();
    return () => {
      cancelled = true;
    };
  }, [isOpen, editingMember?.id, activeMemberModalTab, formData.lifetimeMember]);

  useEffect(() => {
    if (!isOpen || activeMemberModalTab !== 'memberships') return;

    let cancelled = false;
    async function fetchSeasonOptions() {
      setSeasonOptionsLoading(true);
      try {
        const seasons = await get('/registration-config/seasons');
        if (!cancelled) {
          setSeasonOptions(
            seasons.map((season) => ({
              id: season.id,
              name: season.name,
              startDate: season.startDate,
              endDate: season.endDate,
            }))
          );
        }
      } catch {
        if (!cancelled) setSeasonOptions([]);
      } finally {
        if (!cancelled) setSeasonOptionsLoading(false);
      }
    }

    void fetchSeasonOptions();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeMemberModalTab]);

  const availableSeasonOptions = useMemo(() => {
    const blockedSeasonIds = new Set(
      seasonMemberships
        .filter((membership) => membership.status === 'pending' || membership.status === 'active')
        .map((membership) => membership.seasonId)
    );
    return seasonOptions
      .filter((season) => !blockedSeasonIds.has(season.id))
      .map((season) => ({
        value: season.id,
        label: season.name,
      }));
  }, [seasonMemberships, seasonOptions]);

  useEffect(() => {
    if (availableSeasonOptions.length === 0) {
      setNewMembershipSeasonId(null);
      return;
    }
    if (
      newMembershipSeasonId == null ||
      !availableSeasonOptions.some((option) => option.value === newMembershipSeasonId)
    ) {
      setNewMembershipSeasonId(availableSeasonOptions[0].value);
    }
  }, [availableSeasonOptions, newMembershipSeasonId]);

  const handleAddSeasonMembership = async () => {
    const selectedSeasonId = newMembershipSeasonId ?? availableSeasonOptions[0]?.value ?? null;
    if (!editingMember || selectedSeasonId == null) return;

    setMembershipActionSubmitting(true);
    try {
      const createdMembership = await post(
        '/members/{id}/season-memberships',
        {
          seasonId: selectedSeasonId,
          membershipType: newMembershipType,
        },
        { id: String(editingMember.id) }
      );
      setSeasonMemberships((current) =>
        [...current, createdMembership].sort((left, right) => right.endsAt.localeCompare(left.endsAt))
      );
      setNewMembershipSeasonId(null);
      setNewMembershipType('regular');
      showAlert('Membership added.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to add membership'), 'error');
    } finally {
      setMembershipActionSubmitting(false);
    }
  };

  const handleDeleteSeasonMembership = async (membership: MemberSeasonMembershipResponse) => {
    if (!editingMember) return;

    const confirmed = await confirm({
      title: 'Delete membership',
      message: `Remove the ${membershipTypeLabel(membership.membershipType).toLowerCase()} for ${membership.seasonName}?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;

    setMembershipActionSubmitting(true);
    try {
      await del(
        '/members/{id}/season-memberships/{membershipId}',
        undefined,
        { id: String(editingMember.id), membershipId: String(membership.id) }
      );
      setSeasonMemberships((current) => current.filter((row) => row.id !== membership.id));
      showAlert('Membership deleted.', 'success');
    } catch (error: unknown) {
      showAlert(formatApiError(error, 'Failed to delete membership'), 'error');
    } finally {
      setMembershipActionSubmitting(false);
    }
  };

  const addAssignmentDraft = () => {
    const defaultRoleId = assignableRoles[0]?.id;
    if (!defaultRoleId) return;
    setMemberAssignments((current) => [...current, makeAssignmentDraft(defaultRoleId)]);
  };

  const updateAssignmentDraft = (id: string, patchIn: Partial<AssignmentDraft>) => {
    setMemberAssignments((current) =>
      current.map((assignment) => (assignment.id === id ? { ...assignment, ...patchIn } : assignment))
    );
  };

  const removeAssignmentDraft = (id: string) => {
    setMemberAssignments((current) => current.filter((assignment) => assignment.id !== id));
  };

  const canEditRoleAccess = Boolean(
    currentMember?.isServerAdmin &&
      editingMember &&
      currentMember &&
      editingMember.id !== currentMember.id
  );
  const canEditLifetimeMembership = Boolean(currentMember?.isServerAdmin && editingMember);
  const savedLifetimeMember = Boolean(editingMember?.lifetimeMember);
  const lifetimeMembershipDirty =
    canEditLifetimeMembership && formData.lifetimeMember !== savedLifetimeMember;
  const detailsIsMinor = isMemberMinor(demographics.dateOfBirth);
  const mailingStructuredAddress = useMemo(
    () => ({
      addressLine1: demographics.mailingAddressLine1,
      addressLine2: demographics.mailingAddressLine2,
      city: demographics.mailingCity,
      state: demographics.mailingState,
      country: demographics.mailingCountry,
      postalCode: demographics.mailingPostalCode,
    }),
    [
      demographics.mailingAddressLine1,
      demographics.mailingAddressLine2,
      demographics.mailingCity,
      demographics.mailingState,
      demographics.mailingCountry,
      demographics.mailingPostalCode,
    ],
  );

  const revertLifetimeMembershipDraft = () => {
    setFormData((current) => ({ ...current, lifetimeMember: savedLifetimeMember }));
  };

  const handleCloseModal = () => {
    resetFormClosed();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (editingMember) {
        const updateData: MemberUpdatePayload = {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          dateOfBirth: demographics.dateOfBirth.trim(),
          mailingAddress: serializeRegistrationMailingAddress(demographics),
          emailVisible: formData.emailVisible,
          phoneVisible: formData.phoneVisible,
          guardianFirstName: guardian.guardianFirstName.trim(),
          guardianLastName: guardian.guardianLastName.trim(),
          guardianEmail: guardian.guardianEmail.trim(),
          guardianPhone: guardian.guardianPhone.trim(),
        };

        if (!detailsIsMinor) {
          updateData.emergencyContactName = demographics.emergencyContactName.trim();
          updateData.emergencyContactPhone = demographics.emergencyContactPhone.trim();
        }

        if (currentMember?.isServerAdmin) {
          updateData.lifetimeMember = Boolean(formData.lifetimeMember);
        }
        if (currentMember?.isServerAdmin && editingMember?.id !== currentMember?.id) {
          updateData.isServerAdmin = formData.isServerAdmin;
        }

        updateData.baselineOtherClubExperienceYears = Number(formData.baselineOtherClubExperienceYears) || 0;
        updateData.baselineClubExperienceYears = Number(formData.baselineClubExperienceYears) || 0;

        await patch('/members/{id}', updateData, { id: String(editingMember.id) });

        if (currentMember?.isServerAdmin && editingMember?.id !== currentMember?.id) {
          const normalizedAssignments = memberAssignments.map((assignment) => {
            const resourceType = assignment.resourceType.trim();
            const resourceIdRaw = assignment.resourceId.trim();
            if (!assignment.roleId) {
              throw new Error('Each assignment requires a role.');
            }
            if (resourceIdRaw && !/^\d+$/.test(resourceIdRaw)) {
              throw new Error('Resource ID must be a whole number.');
            }
            return {
              roleId: assignment.roleId,
              resourceType: resourceType || null,
              resourceId: resourceIdRaw ? Number(resourceIdRaw) : null,
            };
          });

          await api.put(`/rbac/members/${editingMember.id}/assignments`, {
            assignments: normalizedAssignments,
          });
        }
      } else {
        const createData: MemberCreatePayload = {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email,
          phone: formData.phone || undefined,
        };

        if (currentMember?.isServerAdmin) {
          createData.isServerAdmin = formData.isServerAdmin;
        }

        await post('/members', createData);
      }

      await onSaved();
      handleCloseModal();
    } catch (error) {
      console.error('Failed to save member:', error);
      showAlert(formatApiError(error, 'Failed to save member'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (!submitting) handleCloseModal();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title={editingMember ? 'Edit member' : 'Add member'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {editingMember && (
          <PageTabs
            className="mb-4"
            items={[
              {
                key: 'member',
                label: 'Member',
                isActive: activeMemberModalTab === 'member',
                onClick: () => setActiveMemberModalTab('member'),
              },
              {
                key: 'details',
                label: 'Details',
                isActive: activeMemberModalTab === 'details',
                onClick: () => setActiveMemberModalTab('details'),
              },
              {
                key: 'memberships',
                label: 'Memberships',
                isActive: activeMemberModalTab === 'memberships',
                onClick: () => setActiveMemberModalTab('memberships'),
              },
              {
                key: 'permissions',
                label: 'Permissions',
                isActive: activeMemberModalTab === 'permissions',
                onClick: () => setActiveMemberModalTab('permissions'),
              },
              {
                key: 'payment-history',
                label: 'Payment history',
                isActive: activeMemberModalTab === 'payment-history',
                onClick: () => setActiveMemberModalTab('payment-history'),
              },
            ]}
          />
        )}

        {(!editingMember || activeMemberModalTab === 'member') && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="First name" htmlFor={firstNameInputId} required>
                <input
                  type="text"
                  id={firstNameInputId}
                  autoComplete="given-name"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="app-input"
                  required
                />
              </FormField>
              <FormField label="Last name" htmlFor={lastNameInputId} required>
                <input
                  type="text"
                  id={lastNameInputId}
                  autoComplete="family-name"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="app-input"
                  required
                />
              </FormField>
            </div>

            <FormField label="Email" htmlFor={emailInputId} required={!editingMember}>
              <input
                type="email"
                id={emailInputId}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="app-input"
                required={!editingMember}
              />
            </FormField>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="emailVisible"
                checked={formData.emailVisible}
                onChange={(e) => setFormData({ ...formData, emailVisible: e.target.checked })}
                className="mr-2"
              />
              <label htmlFor="emailVisible" className="text-sm text-gray-600 dark:text-gray-400">
                Email publicly visible
              </label>
            </div>

            <FormField label="Phone" htmlFor={phoneInputId}>
              <input
                type="tel"
                id={phoneInputId}
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="app-input"
              />
            </FormField>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="phoneVisible"
                checked={formData.phoneVisible}
                onChange={(e) => setFormData({ ...formData, phoneVisible: e.target.checked })}
                className="mr-2"
              />
              <label htmlFor="phoneVisible" className="text-sm text-gray-600 dark:text-gray-400">
                Phone publicly visible
              </label>
            </div>

            {editingMember ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Years at another club"
                  htmlFor={baselineOtherClubExperienceInputId}
                  helperText="Baseline experience from other curling clubs before joining Triangle Curling."
                >
                  <input
                    type="number"
                    id={baselineOtherClubExperienceInputId}
                    min={0}
                    max={99.5}
                    step={0.5}
                    value={formData.baselineOtherClubExperienceYears}
                    onChange={(event) =>
                      setFormData({ ...formData, baselineOtherClubExperienceYears: event.target.value })
                    }
                    className="app-input"
                  />
                </FormField>
                <FormField
                  label="Baseline years at this club"
                  htmlFor={baselineClubExperienceInputId}
                  helperText="Pre-app club experience. Computed session years are added on top of this baseline."
                >
                  <input
                    type="number"
                    id={baselineClubExperienceInputId}
                    min={0}
                    max={99.5}
                    step={0.5}
                    value={formData.baselineClubExperienceYears}
                    onChange={(event) =>
                      setFormData({ ...formData, baselineClubExperienceYears: event.target.value })
                    }
                    className="app-input"
                  />
                </FormField>
              </div>
            ) : null}
          </>
        )}

        {editingMember && activeMemberModalTab === 'details' ? (
          profileLoading ? (
            <InlineStateMessage title="Loading member details…" />
          ) : (
            <div className="space-y-4">
              <FormField label="Date of birth" htmlFor={dateOfBirthInputId}>
                <input
                  type="date"
                  id={dateOfBirthInputId}
                  value={demographics.dateOfBirth}
                  onChange={(event) =>
                    setDemographics((current) => ({ ...current, dateOfBirth: event.target.value }))
                  }
                  autoComplete="bday"
                  className="app-input"
                />
              </FormField>

              <PhysicalAddressCollect
                value={mailingStructuredAddress}
                onChange={(structured) =>
                  setDemographics((current) => ({
                    ...current,
                    mailingAddressLine1: structured.addressLine1,
                    mailingAddressLine2: structured.addressLine2,
                    mailingCity: structured.city,
                    mailingState: structured.state,
                    mailingCountry: structured.country,
                    mailingPostalCode: structured.postalCode,
                  }))
                }
                fillWhenEmpty={{
                  state: DEFAULT_REGISTRATION_MAILING_STATE,
                  country: DEFAULT_REGISTRATION_MAILING_COUNTRY,
                }}
                entryMode="auto"
                required={false}
                tone="app"
                nominatimContext="admin member editor"
              />

              {detailsIsMinor ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/30">
                  <h3 className="app-section-title mb-3">Parent information</h3>
                  <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                    Parent or guardian contact for this member under 18. Also used as the emergency contact.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(
                      [
                        ['guardianFirstName', 'First name'],
                        ['guardianLastName', 'Last name'],
                        ['guardianEmail', 'Email address'],
                        ['guardianPhone', 'Phone number'],
                      ] as const
                    ).map(([field, label]) => (
                      <FormField key={field} label={label} htmlFor={`admin-guardian-${field}`}>
                        <input
                          id={`admin-guardian-${field}`}
                          type={field === 'guardianEmail' ? 'email' : field === 'guardianPhone' ? 'tel' : 'text'}
                          value={guardian[field]}
                          onChange={(event) =>
                            setGuardian((current) => ({ ...current, [field]: event.target.value }))
                          }
                          className="app-input"
                        />
                      </FormField>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Emergency contact name" htmlFor={emergencyContactNameInputId}>
                    <input
                      id={emergencyContactNameInputId}
                      type="text"
                      value={demographics.emergencyContactName}
                      onChange={(event) =>
                        setDemographics((current) => ({
                          ...current,
                          emergencyContactName: event.target.value,
                        }))
                      }
                      autoComplete="name"
                      className="app-input"
                    />
                  </FormField>
                  <FormField label="Emergency contact phone" htmlFor={emergencyContactPhoneInputId}>
                    <input
                      id={emergencyContactPhoneInputId}
                      type="tel"
                      value={demographics.emergencyContactPhone}
                      onChange={(event) =>
                        setDemographics((current) => ({
                          ...current,
                          emergencyContactPhone: event.target.value,
                        }))
                      }
                      autoComplete="tel"
                      className="app-input"
                    />
                  </FormField>
                </div>
              )}
            </div>
          )
        ) : null}

        {editingMember && activeMemberModalTab === 'memberships' ? (
          <div className="space-y-4 border-t border-gray-200 pt-4 dark:border-gray-700">
            {canEditLifetimeMembership ? (
              <div className="flex items-start rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/30">
                <input
                  type="checkbox"
                  id="lifetimeMember"
                  checked={formData.lifetimeMember}
                  onChange={(e) => setFormData({ ...formData, lifetimeMember: e.target.checked })}
                  className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal"
                />
                <label htmlFor="lifetimeMember" className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Lifetime member</span>
                  <div className="text-gray-600 dark:text-gray-400">
                    Member forever: no annual membership or registration league fees during registration.
                  </div>
                </label>
              </div>
            ) : null}

            {formData.lifetimeMember ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
                This member has a lifetime membership. Season memberships are not required and are hidden here.
              </p>
            ) : (
              <>
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Season memberships</h3>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                Memberships are tied to a curling season and can be regular, social, or junior recreational.
              </p>
            </div>

            {seasonMembershipsLoading ? (
              <InlineStateMessage title="Loading memberships…" />
            ) : seasonMembershipsError ? (
              <InlineStateMessage title={seasonMembershipsError} tone="error" />
            ) : seasonMemberships.length === 0 ? (
              <InlineStateMessage title="No season memberships yet." />
            ) : (
              <div className="space-y-2">
                {seasonMemberships.map((membership) => (
                  <div
                    key={membership.id}
                    className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{membership.seasonName}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {membershipTypeLabel(membership.membershipType)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatMembershipDate(membership.startsAt)} – {formatMembershipDate(membership.endsAt)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Status: {membershipStatusLabel(membership.status)}
                          {membership.sourceRegistrationId != null
                            ? ` · Registration #${membership.sourceRegistrationId}`
                            : ''}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => void handleDeleteSeasonMembership(membership)}
                        disabled={membershipActionSubmitting}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3 dark:border-gray-700 dark:bg-gray-900/30">
              <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">Add membership</h4>
              {seasonOptionsLoading ? (
                <InlineStateMessage title="Loading seasons…" />
              ) : availableSeasonOptions.length === 0 ? (
                <InlineStateMessage
                  title="No seasons available."
                  description="Every configured season already has an active or pending membership for this member."
                />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Season" htmlFor={addMembershipSeasonInputId} required>
                      <ChoiceInput<number>
                        options={availableSeasonOptions}
                        value={newMembershipSeasonId ?? availableSeasonOptions[0]?.value ?? null}
                        onChange={(next) => {
                          if (next != null && !Array.isArray(next)) setNewMembershipSeasonId(next);
                        }}
                        inputId={addMembershipSeasonInputId}
                        ariaLabel="Season"
                        listboxLabel="Season"
                        inputClassName="app-input"
                        disabled={membershipActionSubmitting}
                      />
                    </FormField>
                    <FormField label="Membership type" htmlFor={addMembershipTypeInputId} required>
                      <ChoiceInput<MembershipType>
                        options={MEMBERSHIP_TYPE_OPTIONS}
                        value={newMembershipType}
                        onChange={(next) => {
                          if (next != null && !Array.isArray(next)) setNewMembershipType(next);
                        }}
                        inputId={addMembershipTypeInputId}
                        ariaLabel="Membership type"
                        listboxLabel="Membership type"
                        inputClassName="app-input"
                        disabled={membershipActionSubmitting}
                      />
                    </FormField>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleAddSeasonMembership()}
                      disabled={
                        membershipActionSubmitting ||
                        (newMembershipSeasonId ?? availableSeasonOptions[0]?.value ?? null) == null
                      }
                    >
                      {membershipActionSubmitting ? 'Saving…' : 'Add membership'}
                    </Button>
                  </div>
                </>
              )}
            </div>
              </>
            )}
          </div>
        ) : null}

        {editingMember && activeMemberModalTab === 'permissions' ? (
          currentMember?.isServerAdmin ? (
            <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Roles & access</h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Assign one or more roles to this member. Optional context fields scope a role to a specific resource
                  (example: <code className="px-1 rounded bg-gray-100 dark:bg-gray-700">league / 42</code>).
                </p>
              </div>

              {editingMember.isLastServerAdmin && (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
                  This is the last server admin. At least one server admin is required, so this status
                  cannot be removed and this member cannot be deleted.
                </div>
              )}

              <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/30">
                <input
                  type="checkbox"
                  id="isServerAdmin"
                  checked={formData.isServerAdmin}
                  onChange={(e) => setFormData({ ...formData, isServerAdmin: e.target.checked })}
                  disabled={!canEditRoleAccess || editingMember.isLastServerAdmin}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal disabled:opacity-60"
                />
                <label htmlFor="isServerAdmin" className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Server admin override</span>
                  <div className="text-gray-600 dark:text-gray-400">
                    Grants unrestricted access regardless of assigned roles.
                  </div>
                </label>
              </div>

              {assignmentsLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading role assignments…</div>
              ) : assignmentsError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
                  {assignmentsError}
                </div>
              ) : (
                <div className="space-y-2">
                  {memberAssignments.map((assignment) => {
                    const selectedRole = assignableRoles.find((role) => role.id === assignment.roleId);
                    return (
                      <div
                        key={assignment.id}
                        className="rounded-lg border border-gray-200 bg-white p-3 space-y-2 dark:border-gray-700 dark:bg-gray-800"
                      >
                        <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
                          <ChoiceInput<number>
                            options={assignableRoles.map((role) => ({
                              value: role.id,
                              label: role.name,
                            }))}
                            value={assignment.roleId}
                            onChange={(next) => {
                              if (next != null && !Array.isArray(next))
                                updateAssignmentDraft(assignment.id, { roleId: next });
                            }}
                            ariaLabel={`Role for assignment ${assignment.id}`}
                            listboxLabel="Role"
                            disabled={!canEditRoleAccess}
                            inputClassName="app-input disabled:opacity-60"
                          />
                          <input
                            type="text"
                            value={assignment.resourceType}
                            onChange={(e) =>
                              updateAssignmentDraft(assignment.id, { resourceType: e.target.value })
                            }
                            disabled={!canEditRoleAccess}
                            placeholder="resourceType"
                            className="app-input disabled:opacity-60"
                          />
                          <input
                            type="text"
                            value={assignment.resourceId}
                            onChange={(e) =>
                              updateAssignmentDraft(assignment.id, {
                                resourceId: e.target.value.replace(/[^\d]/g, ''),
                              })
                            }
                            disabled={!canEditRoleAccess}
                            placeholder="resourceId"
                            className="app-input disabled:opacity-60"
                          />
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => removeAssignmentDraft(assignment.id)}
                            disabled={!canEditRoleAccess}
                          >
                            Remove
                          </Button>
                        </div>
                        {selectedRole?.description && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">{selectedRole.description}</p>
                        )}
                      </div>
                    );
                  })}

                  {memberAssignments.length === 0 && (
                    <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
                      No explicit role assignments yet.
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addAssignmentDraft}
                      disabled={!canEditRoleAccess || assignableRoles.length === 0}
                    >
                      Add role assignment
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-300">
              Role assignments are managed in this dialog by server admins.
            </div>
          )
        ) : null}

        {editingMember && activeMemberModalTab === 'payment-history' ? (
          <ProfilePaymentHistoryTab memberId={editingMember.id} />
        ) : null}

        {activeMemberModalTab !== 'memberships' && activeMemberModalTab !== 'payment-history' ? (
          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Saving...' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={submitting} className="flex-1">
              Cancel
            </Button>
          </div>
        ) : lifetimeMembershipDirty ? (
          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting || membershipActionSubmitting} className="flex-1">
              {submitting ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={revertLifetimeMembershipDraft}
              disabled={submitting || membershipActionSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={membershipActionSubmitting}
              className="flex-1"
            >
              Close
            </Button>
          </div>
        )}
      </form>
    </Modal>
  );
}
