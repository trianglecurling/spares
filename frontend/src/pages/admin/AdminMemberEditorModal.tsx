import { useEffect, useState } from 'react';
import { patch, post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import Modal from '../../components/Modal';
import api, { formatApiError } from '../../utils/api';
import type { MemberSummary as Member } from '../../../../backend/src/types.ts';

type MemberUpdatePayload = {
  name: string;
  email?: string;
  phone?: string;
  emailVisible: boolean;
  phoneVisible: boolean;
  validThrough?: string | null;
  spareOnly?: boolean;
  socialMember?: boolean;
  isServerAdmin?: boolean;
};

type MemberCreatePayload = {
  name: string;
  email: string;
  phone?: string;
  validThrough: string | null;
  spareOnly: boolean;
  socialMember: boolean;
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
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    validThrough: '',
    spareOnly: false,
    socialMember: false,
    isServerAdmin: false,
    emailVisible: false,
    phoneVisible: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [assignableRoles, setAssignableRoles] = useState<RbacRole[]>([]);
  const [memberAssignments, setMemberAssignments] = useState<AssignmentDraft[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);
  const [activeMemberModalTab, setActiveMemberModalTab] = useState<'details' | 'permissions'>('details');

  const resetFormClosed = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      validThrough: '',
      spareOnly: false,
      socialMember: false,
      isServerAdmin: false,
      emailVisible: false,
      phoneVisible: false,
    });
    setAssignableRoles([]);
    setMemberAssignments([]);
    setAssignmentsError(null);
    setActiveMemberModalTab('details');
  };

  useEffect(() => {
    if (!isOpen) {
      resetFormClosed();
      return;
    }

    setAssignmentsError(null);
    setActiveMemberModalTab('details');

    if (editingMember) {
      const isServerAdmin = editingMember.isInServerAdminsList ? true : editingMember.isServerAdmin || false;
      setFormData({
        name: editingMember.name,
        email: editingMember.email || '',
        phone: editingMember.phone || '',
        validThrough: editingMember.validThrough || '',
        spareOnly: Boolean(editingMember.spareOnly),
        socialMember: Boolean(editingMember.socialMember),
        isServerAdmin: isServerAdmin,
        emailVisible: editingMember.emailVisible,
        phoneVisible: editingMember.phoneVisible,
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
        name: '',
        email: '',
        phone: '',
        validThrough: '',
        spareOnly: false,
        socialMember: false,
        isServerAdmin: false,
        emailVisible: false,
        phoneVisible: false,
      });
      setAssignableRoles([]);
      setMemberAssignments([]);
    }
  }, [isOpen, editingMember?.id, currentMember?.isServerAdmin]);

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
          name: formData.name,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          emailVisible: formData.emailVisible,
          phoneVisible: formData.phoneVisible,
        };

        if (editingMember?.id !== currentMember?.id) {
          updateData.validThrough = formData.validThrough ? formData.validThrough : null;
          updateData.spareOnly = Boolean(formData.spareOnly);
          updateData.socialMember = Boolean(formData.socialMember);
        }

        if (currentMember?.isServerAdmin && editingMember?.id !== currentMember?.id) {
          if (editingMember?.isInServerAdminsList) {
            updateData.isServerAdmin = true;
          } else {
            updateData.isServerAdmin = formData.isServerAdmin;
          }
        }

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
          name: formData.name,
          email: formData.email,
          phone: formData.phone || undefined,
          validThrough: formData.validThrough ? formData.validThrough : null,
          spareOnly: Boolean(formData.spareOnly),
          socialMember: Boolean(formData.socialMember),
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
          <div className="rounded-lg border border-gray-200 p-1 dark:border-gray-700">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setActiveMemberModalTab('details')}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeMemberModalTab === 'details'
                    ? 'bg-primary-teal text-white'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                Details
              </button>
              <button
                type="button"
                onClick={() => setActiveMemberModalTab('permissions')}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeMemberModalTab === 'permissions'
                    ? 'bg-primary-teal text-white'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                Permissions
              </button>
            </div>
          </div>
        )}

        {(!editingMember || activeMemberModalTab === 'details') && (
          <>
            <div>
              <label htmlFor="name" className="app-label">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="app-input"
                required
              />
            </div>

            <div>
              <label htmlFor="email" className="app-label">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="app-input"
                required
              />
              <div className="mt-2 flex items-center">
                <input
                  type="checkbox"
                  id="emailVisible"
                  checked={formData.emailVisible}
                  onChange={(e) => setFormData({ ...formData, emailVisible: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="emailVisible" className="text-sm text-gray-600 dark:text-gray-400">
                  Publicly visible
                </label>
              </div>
            </div>

            <div>
              <label htmlFor="phone" className="app-label">
                Phone
              </label>
              <input
                type="tel"
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="app-input"
              />
              <div className="mt-2 flex items-center">
                <input
                  type="checkbox"
                  id="phoneVisible"
                  checked={formData.phoneVisible}
                  onChange={(e) => setFormData({ ...formData, phoneVisible: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="phoneVisible" className="text-sm text-gray-600 dark:text-gray-400">
                  Publicly visible
                </label>
              </div>
            </div>

            <div>
              <label htmlFor="validThrough" className="app-label">
                Valid through (optional)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  id="validThrough"
                  value={formData.validThrough}
                  onChange={(e) => setFormData({ ...formData, validThrough: e.target.value })}
                  disabled={Boolean(editingMember && currentMember && editingMember.id === currentMember.id)}
                  className="flex-1 app-input disabled:opacity-60"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setFormData({ ...formData, validThrough: '' })}
                  disabled={Boolean(editingMember && currentMember && editingMember.id === currentMember.id)}
                >
                  Clear
                </Button>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Leave empty for perpetual access. Admin/server admin users are always valid regardless of this date.
                {editingMember && currentMember && editingMember.id === currentMember.id
                  ? ' You cannot change your own date.'
                  : ''}
              </p>
            </div>

            <div className="flex items-start">
              <input
                type="checkbox"
                id="spareOnly"
                checked={formData.spareOnly}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    spareOnly: e.target.checked,
                    socialMember: e.target.checked ? false : formData.socialMember,
                  })
                }
                disabled={Boolean(editingMember && currentMember && editingMember.id === currentMember.id)}
                className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal disabled:opacity-60"
              />
              <label htmlFor="spareOnly" className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Spare-only member</span>
                <div className="text-gray-600 dark:text-gray-400">
                  Can sign up to spare, but cannot create spare requests.
                  {editingMember && currentMember && editingMember.id === currentMember.id
                    ? ' You cannot change your own status.'
                    : ''}
                </div>
              </label>
            </div>

            <div className="flex items-start">
              <input
                type="checkbox"
                id="socialMember"
                checked={formData.socialMember}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    socialMember: e.target.checked,
                    spareOnly: e.target.checked ? false : formData.spareOnly,
                  })
                }
                disabled={Boolean(editingMember && currentMember && editingMember.id === currentMember.id)}
                className="mt-1 mr-3 rounded border-gray-300 dark:border-gray-600 text-primary-teal focus:ring-primary-teal disabled:opacity-60"
              />
              <label htmlFor="socialMember" className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Social member</span>
                <div className="text-gray-600 dark:text-gray-400">
                  Member without ice privileges: cannot spare, request spares, or be on a league roster.
                  {editingMember && currentMember && editingMember.id === currentMember.id
                    ? ' You cannot change your own status.'
                    : ''}
                </div>
              </label>
            </div>
          </>
        )}

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

              {editingMember.isInServerAdminsList && (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
                  This member is managed by <code>SERVER_ADMINS</code> and must remain a server admin.
                </div>
              )}

              <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/30">
                <input
                  type="checkbox"
                  id="isServerAdmin"
                  checked={formData.isServerAdmin}
                  onChange={(e) => setFormData({ ...formData, isServerAdmin: e.target.checked })}
                  disabled={!canEditRoleAccess || editingMember.isInServerAdminsList}
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

        <div className="flex space-x-3">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? 'Saving...' : 'Save'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleCancel} disabled={submitting} className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
