import React, { useEffect, useMemo, useState } from 'react';
import { Archive, Bell, Check, ChevronDown, Eye, EyeOff, Loader2, Plus, RefreshCw, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { AdminShell } from '../components/AdminShell';
import { Alert, Button } from '../components/ui';
import {
  assignHostToProperty,
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setHostLevel,
  setUserArchived,
  updateUserEmail,
  updateUserCanEditBlog,
  updateUserName,
  unassignHostFromProperty,
  updateUserRole,
  UserRole,
} from '../services/admin';
import { DEFAULT_SITE_SETTINGS, getAllProperties, getSiteSettings } from '../services/storage';
import { approveSubscriptionRequest, listSubscriptionRequests, rejectSubscriptionRequest } from '../services/subscriptions';
import { HostPlanCode, PLAN_TO_HOST_LEVEL, PropertyData, SiteSettings, SubscriptionRequest } from '../types';


const ROLE_OPTIONS: UserRole[] = ['ADMIN', 'HOST', 'GUEST'];

const PLAN_LABELS: Record<HostPlanCode, string> = { basic: 'Basic', plus: 'Plus', pro: 'Pro' };

type UserTab = 'profile' | 'access' | 'properties' | 'security' | 'danger';

const ROLE_BADGE: Record<UserRole, string> = {
  ADMIN: 'bg-brand text-white',
  HOST: 'bg-ok-tint text-ok',
  GUEST: 'bg-brand-tint text-ink-soft',
};

const AVATAR_COLOR: Record<UserRole, string> = {
  ADMIN: 'bg-brand text-white',
  HOST: 'bg-ok-tint text-ok',
  GUEST: 'bg-brand-tint text-ink-soft',
};

// A user counts as "online" if they made an authenticated request within this window.
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

const isUserOnline = (user: ApiUser, now: number): boolean =>
  !user.archivedAt && !!user.lastSeenAt && now - Number(user.lastSeenAt) < ONLINE_THRESHOLD_MS;

const formatLastSeen = (lastSeenAt: number | null | undefined, now: number): string => {
  if (!lastSeenAt) return 'Never signed in';
  const diff = now - Number(lastSeenAt);
  if (diff < 60 * 1000) return 'Active just now';
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Active ${days}d ago`;
};

const AdminUsersPage: React.FC = () => {
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [properties, setProperties] = useState<(PropertyData & { id: string })[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [upgradeRequests, setUpgradeRequests] = useState<SubscriptionRequest[]>([]);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);

  // Ticks forward periodically so "online" status and relative "last seen" labels stay fresh.
  const [now, setNow] = useState(() => Date.now());

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Create form
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'HOST' as UserRole,
    canEditBlog: false,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  // Card UI state
  const [expandedUserIds, setExpandedUserIds] = useState<Set<number>>(new Set());
  const [activeTabByUser, setActiveTabByUser] = useState<Record<number, UserTab>>({});

  // Pending states
  const [pendingRoleUserId, setPendingRoleUserId] = useState<number | null>(null);
  const [pendingProfileSaveUserId, setPendingProfileSaveUserId] = useState<number | null>(null);
  const [pendingArchiveUserId, setPendingArchiveUserId] = useState<number | null>(null);
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<number | null>(null);
  const [pendingBlogPermissionUserId, setPendingBlogPermissionUserId] = useState<number | null>(null);
  const [pendingAssignmentSaveUserId, setPendingAssignmentSaveUserId] = useState<number | null>(null);
  const [pendingResetUserId, setPendingResetUserId] = useState<number | null>(null);
  const [pendingHostLevelUserId, setPendingHostLevelUserId] = useState<number | null>(null);

  // Drafts
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, string[]>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<number, string>>({});
  const [showPasswordDrafts, setShowPasswordDrafts] = useState<Record<number, boolean>>({});
  const [emailDrafts, setEmailDrafts] = useState<Record<number, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});

  const isAdmin = authUser?.role === 'ADMIN';

  const stats = useMemo(() => ({
    total: users.length,
    online: users.filter(u => isUserOnline(u, now)).length,
    admins: users.filter(u => u.role === 'ADMIN').length,
    hosts: users.filter(u => u.role === 'HOST').length,
    archived: users.filter(u => u.archivedAt).length,
  }), [users, now]);

  const propertyNameById = useMemo(() => {
    const map = new Map<string, string>();
    properties.forEach((property) => {
      map.set(property.id, property.name || property.id);
    });
    return map;
  }, [properties]);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => {
      unsubscribe = unsub;
    });
    return () => unsubscribe();
  }, []);

  const buildAssignmentDrafts = (sourceUsers: ApiUser[]): Record<number, string[]> => {
    const next: Record<number, string[]> = {};
    sourceUsers.forEach((user) => {
      if (user.role === 'HOST') {
        next[user.id] = [...user.assignedPropertyIds];
      }
    });
    return next;
  };

  const loadData = async (refresh = false) => {
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }

    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const [fetchedUsers, fetchedProperties, fetchedRequests] = await Promise.all([
        listUsers(),
        getAllProperties(),
        listSubscriptionRequests('pending'),
      ]);
      setUsers(fetchedUsers);
      setProperties(fetchedProperties);
      setUpgradeRequests(fetchedRequests);
      setAssignmentDrafts(buildAssignmentDrafts(fetchedUsers));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load user admin data.';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
    getSiteSettings().then(setSiteSettings).catch(() => {});
  }, [isAdmin]);

  // Keep presence live: tick the clock and quietly re-fetch users so the
  // online dots reflect recent activity without disrupting the page state.
  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    const interval = window.setInterval(() => {
      setNow(Date.now());
      listUsers()
        .then((freshUsers) => setUsers(freshUsers))
        .catch(() => {});
      listSubscriptionRequests('pending')
        .then((freshRequests) => setUpgradeRequests(freshRequests))
        .catch(() => {});
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [isAdmin]);

  const initProfileDrafts = (user: ApiUser) => {
    setNameDrafts(prev => ({ ...prev, [user.id]: user.name }));
    setEmailDrafts(prev => ({ ...prev, [user.id]: user.email }));
  };

  const toggleUserCard = (user: ApiUser) => {
    setExpandedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(user.id)) {
        next.delete(user.id);
      } else {
        next.add(user.id);
        initProfileDrafts(user);
      }
      return next;
    });
  };

  const setActiveTab = (userId: number, tab: UserTab) => {
    setActiveTabByUser(prev => ({ ...prev, [userId]: tab }));
  };

  const getActiveTab = (user: ApiUser): UserTab => {
    return activeTabByUser[user.id] ?? 'profile';
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setIsCreating(true);

    try {
      await createUser(createForm);
      setCreateForm({ name: '', email: '', password: '', role: 'HOST', canEditBlog: false });
      setCreateFormOpen(false);
      await loadData(true);
      setInfoMsg('User created successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create user.';
      setErrorMsg(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRoleChange = async (user: ApiUser, role: UserRole) => {
    if (user.role === role) {
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setPendingRoleUserId(user.id);

    try {
      await updateUserRole(user.id, role);
      await loadData(true);
      setInfoMsg(`Role updated for ${user.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update role.';
      setErrorMsg(message);
    } finally {
      setPendingRoleUserId(null);
    }
  };

  const handleSaveEditProfile = async (user: ApiUser) => {
    const name = (nameDrafts[user.id] ?? '').trim();
    const email = (emailDrafts[user.id] ?? '').trim();
    if (!name) {
      setErrorMsg('Please enter a valid name.');
      return;
    }
    if (!email.includes('@')) {
      setErrorMsg('Please enter a valid email.');
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setPendingProfileSaveUserId(user.id);

    try {
      if (name !== user.name) {
        await updateUserName(user.id, name);
      }
      if (email !== user.email) {
        await updateUserEmail(user.id, email);
      }
      await loadData(true);
      setInfoMsg(`User profile updated for ${email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update user profile.';
      setErrorMsg(message);
    } finally {
      setPendingProfileSaveUserId(null);
    }
  };

  const handleDeleteUser = async (user: ApiUser) => {
    if (user.id === authUser?.id) {
      setErrorMsg('You cannot delete your own account.');
      return;
    }
    const confirmed = window.confirm(`Permanently delete user ${user.email}? This cannot be undone.`);
    if (!confirmed) return;
    setPendingDeleteUserId(user.id);
    try {
      await deleteUser(user.id);
      setUsers(prev => prev.filter(u => u.id !== user.id));
      setExpandedUserIds(prev => { const next = new Set(prev); next.delete(user.id); return next; });
      setInfoMsg(`User deleted: ${user.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete user.';
      setErrorMsg(message);
    } finally {
      setPendingDeleteUserId(null);
    }
  };

  const handleArchiveUser = async (user: ApiUser, archived: boolean) => {
    if (user.id === authUser?.id) {
      setErrorMsg('You cannot archive your own account.');
      return;
    }

    const confirmed = window.confirm(`${archived ? 'Archive' : 'Restore'} user ${user.email}?`);
    if (!confirmed) {
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setPendingArchiveUserId(user.id);

    try {
      await setUserArchived(user.id, archived);
      await loadData(true);
      setInfoMsg(archived ? `User archived: ${user.email}.` : `User restored: ${user.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update user archive state.';
      setErrorMsg(message);
    } finally {
      setPendingArchiveUserId(null);
    }
  };

  const handleBlogPermissionChange = async (user: ApiUser, canEditBlog: boolean) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingBlogPermissionUserId(user.id);

    try {
      await updateUserCanEditBlog(user.id, canEditBlog);
      await loadData(true);
      setInfoMsg(`Blog editor access updated for ${user.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update blog editor access.';
      setErrorMsg(message);
    } finally {
      setPendingBlogPermissionUserId(null);
    }
  };

  const handleSetHostLevel = async (user: ApiUser, level: 1 | 2 | 3 | 4 | null) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingHostLevelUserId(user.id);
    try {
      await setHostLevel(user.id, level);
      await loadData(true);
      setInfoMsg(`Host level updated for ${user.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update host level.';
      setErrorMsg(message);
    } finally {
      setPendingHostLevelUserId(null);
    }
  };

  const handleAssignmentDraftToggle = (user: ApiUser, propertyId: string) => {
    const existing = assignmentDrafts[user.id] ?? [...user.assignedPropertyIds];
    const next = existing.includes(propertyId)
      ? existing.filter((id) => id !== propertyId)
      : [...existing, propertyId];

    setAssignmentDrafts((prev) => ({
      ...prev,
      [user.id]: next,
    }));
  };

  const hasAssignmentChanges = (user: ApiUser): boolean => {
    if (user.role !== 'HOST') {
      return false;
    }
    const draft = assignmentDrafts[user.id] ?? user.assignedPropertyIds;
    const current = user.assignedPropertyIds;
    if (draft.length !== current.length) {
      return true;
    }
    const currentSet = new Set(current);
    return draft.some((propertyId) => !currentSet.has(propertyId));
  };

  const handleSaveAssignments = async (user: ApiUser) => {
    if (user.role !== 'HOST') {
      return;
    }

    const draft = assignmentDrafts[user.id] ?? user.assignedPropertyIds;
    const current = user.assignedPropertyIds;
    const currentSet = new Set(current);
    const draftSet = new Set(draft);
    const toAssign = draft.filter((propertyId) => !currentSet.has(propertyId));
    const toUnassign = current.filter((propertyId) => !draftSet.has(propertyId));

    if (toAssign.length === 0 && toUnassign.length === 0) {
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setPendingAssignmentSaveUserId(user.id);

    try {
      for (const propertyId of toAssign) {
        await assignHostToProperty(propertyId, user.id);
      }
      for (const propertyId of toUnassign) {
        await unassignHostFromProperty(propertyId, user.id);
      }

      const updatedUsers = await listUsers();
      setUsers(updatedUsers);
      setAssignmentDrafts(buildAssignmentDrafts(updatedUsers));
      setInfoMsg(`Assignments saved for ${user.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update host assignment.';
      setErrorMsg(message);
    } finally {
      setPendingAssignmentSaveUserId(null);
    }
  };

  const handleResetPassword = async (user: ApiUser) => {
    const password = (passwordDrafts[user.id] ?? '').trim();
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    const confirmed = window.confirm(`Reset password for ${user.email}?`);
    if (!confirmed) {
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setPendingResetUserId(user.id);

    try {
      await resetUserPassword(user.id, password);
      setPasswordDrafts((prev) => ({ ...prev, [user.id]: '' }));
      setInfoMsg(`Password reset for ${user.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset password.';
      setErrorMsg(message);
    } finally {
      setPendingResetUserId(null);
    }
  };

  const handleUpgradeDecision = async (request: SubscriptionRequest, approve: boolean) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingRequestId(request.id);
    try {
      if (approve) {
        await approveSubscriptionRequest(request.id);
      } else {
        await rejectSubscriptionRequest(request.id);
      }
      // Refresh users (host levels change on approval) and the pending list.
      await loadData(true);
      setInfoMsg(approve
        ? `Approved — ${request.userEmail} is now host level ${PLAN_TO_HOST_LEVEL[request.planCode]}.`
        : `Rejected upgrade request from ${request.userEmail}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update the upgrade request.';
      setErrorMsg(message);
    } finally {
      setPendingRequestId(null);
    }
  };

  // Reusable class helpers
  const inputCls = 'w-full px-3.5 py-2.5 bg-subtle border border-line rounded-control text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[#041627]/20 focus:border-brand transition-colors disabled:opacity-60';
  const selectCls = inputCls + ' appearance-none';
  const tabBtnCls = (active: boolean) =>
    `text-xs font-semibold px-3 py-1.5 rounded-control transition-all ${active ? 'bg-surface text-brand shadow-sm' : 'text-ink-muted hover:text-brand'}`;
  const primaryBtnCls = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white font-semibold text-xs hover:bg-brand/90 disabled:opacity-50 transition-colors';
  const secondaryBtnCls = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-line-strong bg-surface text-ink font-semibold text-xs hover:bg-brand-tint disabled:opacity-50 transition-colors';

  return (
    <AdminShell
      title="User Administration"
      subtitle="Manage user accounts, roles, and property assignments."
      access="admin"
      activeKey="users"
      signInTitle="User Admin Access"
      signInMessage="Sign in with an admin account to manage users and host assignments."
      deniedTitle="Admin role required"
      deniedMessage="Your current account does not have permission to access user management."
      actions={(
        <>
          <Button icon={RefreshCw} loading={isRefreshing} onClick={() => loadData(true)}>Refresh</Button>
          <Button variant="primary" icon={Plus} onClick={() => setCreateFormOpen(v => !v)}>New user</Button>
        </>
      )}
    >
        {/* Alerts */}
        {errorMsg && <Alert tone="danger" onDismiss={() => setErrorMsg(null)}>{errorMsg}</Alert>}
        {infoMsg && <Alert tone="ok" onDismiss={() => setInfoMsg(null)}>{infoMsg}</Alert>}

        {/* Pending upgrade requests */}
        {upgradeRequests.length > 0 && (
          <div className="mb-6 bg-surface border border-amber-200 rounded-card overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-5 py-3 bg-amber-50 border-b border-amber-200">
              <Bell className="w-4 h-4 text-amber-600" />
              <span className="font-semibold text-amber-800 text-sm">
                {upgradeRequests.length} pending upgrade {upgradeRequests.length === 1 ? 'request' : 'requests'}
              </span>
            </div>
            <div className="divide-y divide-[#e4e2e3]">
              {upgradeRequests.map((request) => (
                <div key={request.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{request.userName || request.userEmail}</p>
                    <p className="text-xs text-ink-muted truncate">{request.userEmail}</p>
                    <p className="text-sm text-ink-soft mt-1">
                      Wants <span className="font-semibold">{PLAN_LABELS[request.planCode]}</span> · {request.billingCycle}
                      <span className="text-ink-muted"> → host level {PLAN_TO_HOST_LEVEL[request.planCode]}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleUpgradeDecision(request, true)}
                      disabled={pendingRequestId === request.id}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {pendingRequestId === request.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
                    </button>
                    <button
                      onClick={() => handleUpgradeDecision(request, false)}
                      disabled={pendingRequestId === request.id}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-line-strong bg-surface text-ink font-semibold text-xs hover:bg-brand-tint disabled:opacity-50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        {!isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <div className="bg-surface rounded-card border border-line px-5 py-4">
              <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-brand">{stats.total}</div>
              <div className="text-xs font-medium text-ink-muted mt-0.5">Total Users</div>
            </div>
            <div className="bg-surface rounded-card border border-line px-5 py-4">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${stats.online > 0 ? 'bg-ok' : 'bg-page'}`} />
                <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-ok">{stats.online}</div>
              </div>
              <div className="text-xs font-medium text-ink-muted mt-0.5">Online Now</div>
            </div>
            <div className="bg-surface rounded-card border border-line px-5 py-4">
              <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-brand">{stats.admins}</div>
              <div className="text-xs font-medium text-ink-muted mt-0.5">Admins</div>
            </div>
            <div className="bg-surface rounded-card border border-line px-5 py-4">
              <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-ok">{stats.hosts}</div>
              <div className="text-xs font-medium text-ink-muted mt-0.5">Hosts</div>
            </div>
            <div className="bg-surface rounded-card border border-line px-5 py-4">
              <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-ink-muted">{stats.archived}</div>
              <div className="text-xs font-medium text-ink-muted mt-0.5">Archived</div>
            </div>
          </div>
        )}

        {/* Create User card */}
        {createFormOpen && (
        <div className="bg-surface rounded-card border border-line mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-subtle flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Create New User</span>
            <button type="button" onClick={() => setCreateFormOpen(false)} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleCreateUser} className="px-6 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Full Name</label>
                  <input type="text" required placeholder="e.g. Nguyen Van A"
                    value={createForm.name} onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Email Address</label>
                  <input type="email" required placeholder="user@sachihouse.com"
                    value={createForm.email} onChange={e => setCreateForm(prev => ({ ...prev, email: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Password</label>
                  <div className="relative">
                    <input type={showCreatePassword ? 'text' : 'password'} required minLength={6} placeholder="Min. 6 characters"
                      value={createForm.password} onChange={e => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
                      className={inputCls + ' pr-10'} />
                    <button type="button" onClick={() => setShowCreatePassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
                      {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Role</label>
                  <select value={createForm.role} onChange={e => setCreateForm(prev => ({ ...prev, role: e.target.value as UserRole }))}
                    className={selectCls}>
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="mb-5">
                <label className="inline-flex items-center gap-3 cursor-pointer">
                  <button type="button"
                    onClick={() => setCreateForm(prev => ({ ...prev, canEditBlog: !prev.canEditBlog }))}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${createForm.canEditBlog ? 'bg-brand' : 'bg-page'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform ${createForm.canEditBlog ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <div>
                    <div className="text-sm font-semibold text-ink">Grant Blog Editor Access</div>
                    <div className="text-xs text-ink-muted">Allow this user to create and manage blog posts</div>
                  </div>
                </label>
              </div>
              <div className="flex items-center gap-3 pt-4 border-t border-line">
                <button type="submit" disabled={isCreating} className={primaryBtnCls + ' px-5 py-2.5 text-sm'}>
                  {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create User
                </button>
                <button type="button" onClick={() => setCreateFormOpen(false)} className={secondaryBtnCls + ' px-4 py-2.5 text-sm'}>Cancel</button>
              </div>
            </form>
        </div>
        )}

        {/* Users List */}
        {isLoading ? (
          <div className="py-16 flex items-center justify-center text-ink-soft">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-ink-soft">No users found.</div>
        ) : (
          <div className="rounded-card border border-line bg-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-line bg-subtle flex items-center justify-between">
              <span className="text-sm font-semibold">{users.length} {users.length === 1 ? 'user' : 'users'}</span>
            </div>
            <div className="divide-y divide-[#efedef]">
            {users.map(user => {
              const isExpanded = expandedUserIds.has(user.id);
              const activeTab = getActiveTab(user);
              const isSelf = user.id === authUser?.id;
              const avatarColor = user.archivedAt ? 'bg-brand-tint text-ink-muted' : (AVATAR_COLOR[user.role] ?? 'bg-brand-tint text-ink-soft');
              const avatarInitial = (user.name || user.email).charAt(0).toUpperCase();
              const online = isUserOnline(user, now);

              return (
                <div key={user.id} className={`overflow-hidden transition-colors ${user.archivedAt ? 'opacity-80' : ''}`}>

                  {/* Card Header */}
                  <div
                    className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors hover:bg-subtle`}
                    onClick={() => toggleUserCard(user)}
                  >
                    <div className="relative flex-shrink-0">
                      <div className={`w-10 h-10 rounded-control flex items-center justify-center font-['Plus_Jakarta_Sans'] font-bold text-base ${avatarColor}`}>
                        {avatarInitial}
                      </div>
                      {!user.archivedAt && (
                        <span
                          title={online ? 'Online' : formatLastSeen(user.lastSeenAt, now)}
                          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${online ? 'bg-ok' : 'bg-page'}`}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`font-['Plus_Jakarta_Sans'] font-bold text-sm ${user.archivedAt ? 'text-ink-muted' : 'text-brand'}`}>{user.name}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${user.archivedAt ? 'bg-brand-tint text-ink-muted' : (ROLE_BADGE[user.role] ?? 'bg-brand-tint text-ink-soft')}`}>{user.role}</span>
                        {user.archivedAt
                          ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Archived</span>
                          : online
                            ? <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-ok-tint text-ok"><span className="w-1.5 h-1.5 rounded-full bg-ok" />Online</span>
                            : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-tint text-ink-muted">Offline</span>
                        }
                        {user.canEditBlog && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-tint text-ink-soft">Blog Editor</span>}
                        {user.role === 'HOST' && (() => {
                          const lvl = user.hostLevel;
                          if (!lvl) return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-tint text-ink-muted">No Level</span>;
                          const levelColors: Record<number, string> = { 1: 'bg-subtle text-ink-soft', 2: 'bg-orange-100 text-orange-700', 3: 'bg-ok-tint text-ok', 4: 'bg-indigo-100 text-indigo-700' };
                          return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${levelColors[lvl]}`}>Level {lvl}</span>;
                        })()}
                        {isSelf && <span className="text-xs px-2 py-0.5 rounded-full bg-subtle text-ink-muted">You</span>}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5 truncate">
                        {user.email} · ID: {user.id}
                        {user.role === 'HOST' && user.assignedPropertyIds.length > 0 && ` · ${user.assignedPropertyIds.length} ${user.assignedPropertyIds.length === 1 ? 'property' : 'properties'}`}
                        {!user.archivedAt && !online && ` · ${formatLastSeen(user.lastSeenAt, now)}`}
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 flex-shrink-0 text-ink-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Card Body */}
                  {isExpanded && (
                    <div className="border-t border-line">
                      {/* Tabs */}
                      <div className="flex items-center gap-1 px-4 pt-3 pb-2 bg-subtle flex-wrap">
                        <button onClick={() => setActiveTab(user.id, 'profile')} className={tabBtnCls(activeTab === 'profile')}>Profile</button>
                        <button onClick={() => setActiveTab(user.id, 'access')} className={tabBtnCls(activeTab === 'access')}>Role & Access</button>
                        {user.role === 'HOST' && (
                          <button onClick={() => setActiveTab(user.id, 'properties')} className={tabBtnCls(activeTab === 'properties')}>Properties</button>
                        )}
                        <button onClick={() => setActiveTab(user.id, 'security')} className={tabBtnCls(activeTab === 'security')}>Security</button>
                        <button
                          onClick={() => setActiveTab(user.id, 'danger')}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-control transition-all ${activeTab === 'danger' ? 'bg-surface text-red-600 shadow-sm' : 'text-red-400 hover:text-red-600'}`}
                        >Danger Zone</button>
                      </div>

                      {/* Profile Tab */}
                      {activeTab === 'profile' && (
                        <div className="px-5 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Full Name</label>
                              <input type="text"
                                value={nameDrafts[user.id] ?? user.name}
                                onChange={e => setNameDrafts(prev => ({ ...prev, [user.id]: e.target.value }))}
                                disabled={pendingProfileSaveUserId === user.id}
                                className={inputCls} />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Email Address</label>
                              <input type="email"
                                value={emailDrafts[user.id] ?? user.email}
                                onChange={e => setEmailDrafts(prev => ({ ...prev, [user.id]: e.target.value }))}
                                disabled={pendingProfileSaveUserId === user.id}
                                className={inputCls} />
                            </div>
                          </div>
                          <div className="mt-4 flex gap-2">
                            <button onClick={() => handleSaveEditProfile(user)} disabled={pendingProfileSaveUserId === user.id} className={primaryBtnCls}>
                              {pendingProfileSaveUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              Save Changes
                            </button>
                            <button onClick={() => initProfileDrafts(user)} disabled={pendingProfileSaveUserId === user.id} className={secondaryBtnCls}>
                              <X className="w-3.5 h-3.5" />
                              Reset
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Role & Access Tab */}
                      {activeTab === 'access' && (
                        <div className="px-5 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Role</label>
                              <div className="flex items-center gap-2">
                                <select
                                  value={user.role}
                                  disabled={pendingRoleUserId === user.id || isSelf}
                                  onChange={e => handleRoleChange(user, e.target.value as UserRole)}
                                  className={selectCls + (isSelf ? ' opacity-60 cursor-not-allowed' : '')}
                                >
                                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                                {pendingRoleUserId === user.id && <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />}
                              </div>
                              {isSelf && <p className="text-xs text-ink-muted mt-1.5">Your own role cannot be changed here.</p>}
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Blog Editor Access</label>
                              <div className="flex items-center gap-3">
                                <button type="button"
                                  disabled={pendingBlogPermissionUserId === user.id}
                                  onClick={() => handleBlogPermissionChange(user, !user.canEditBlog)}
                                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${user.canEditBlog ? 'bg-brand' : 'bg-page'}`}>
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform ${user.canEditBlog ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                </button>
                                <span className="text-sm font-medium text-ink">{user.canEditBlog ? 'Enabled' : 'Disabled'}</span>
                                {pendingBlogPermissionUserId === user.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-muted" />}
                              </div>
                              <p className="text-xs text-ink-muted mt-1.5">Can create and edit blog posts.</p>
                            </div>
                          </div>
                          {user.role === 'HOST' && (
                            <div className="mt-5 pt-5 border-t border-line">
                              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">Host Level</label>
                              <p className="text-xs text-ink-muted mb-3">Level 1: view properties · Level 2: view + edit properties · Level 3: view + edit + check-in management · Level 4: Level 3 + finance</p>
                              <div className="flex flex-col gap-2">
                                {([null, 1, 2, 3, 4] as (1 | 2 | 3 | 4 | null)[]).map((lvl) => {
                                  const labels: Record<string, string> = {
                                    'null': 'No level (view only, no edit)',
                                    '1': 'Level 1 — View properties only',
                                    '2': 'Level 2 — View + edit assigned properties',
                                    '3': 'Level 3 — View + edit + check-in management',
                                    '4': 'Level 4 — Level 3 + finance access',
                                  };
                                  const key = String(lvl);
                                  const isActive = user.hostLevel === lvl;
                                  const isPending = pendingHostLevelUserId === user.id;
                                  return (
                                    <button
                                      key={key}
                                      disabled={isPending || isActive}
                                      onClick={() => handleSetHostLevel(user, lvl)}
                                      className={`flex items-center gap-3 px-4 py-2.5 rounded-control border text-sm font-medium transition-all text-left ${isActive ? 'bg-brand text-white border-brand' : 'bg-surface text-ink border-line hover:border-brand hover:bg-subtle'} disabled:opacity-60`}
                                    >
                                      {isPending && isActive ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${isActive ? 'border-white bg-surface' : 'border-line-strong'}`} />}
                                      {labels[key]}
                                    </button>
                                  );
                                })}
                              </div>
                              {pendingHostLevelUserId === user.id && <p className="text-xs text-ink-muted mt-2 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</p>}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Properties Tab */}
                      {activeTab === 'properties' && user.role === 'HOST' && (
                        <div className="px-5 py-4">
                          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-3">Assigned Properties</label>
                          {properties.length === 0 ? (
                            <p className="text-sm text-ink-muted">No properties available.</p>
                          ) : (
                            <div className="space-y-2 mb-4">
                              {properties.map(property => {
                                const draftAssigned = assignmentDrafts[user.id] ?? user.assignedPropertyIds;
                                const isAssigned = draftAssigned.includes(property.id);
                                return (
                                  <label key={property.id} className="flex items-center gap-3 p-3 rounded-control border border-line cursor-pointer hover:bg-subtle transition-colors">
                                    <input type="checkbox" checked={isAssigned}
                                      disabled={pendingAssignmentSaveUserId === user.id}
                                      onChange={() => handleAssignmentDraftToggle(user, property.id)}
                                      className="w-4 h-4 accent-[#041627]" />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-semibold text-ink">{property.name || property.id}</div>
                                      <div className="text-xs text-ink-muted">{property.id}</div>
                                    </div>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isAssigned ? 'bg-ok-tint text-ok' : 'bg-brand-tint text-ink-muted'}`}>
                                      {isAssigned ? 'Assigned' : 'Unassigned'}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <button onClick={() => handleSaveAssignments(user)}
                              disabled={!hasAssignmentChanges(user) || pendingAssignmentSaveUserId === user.id}
                              className={primaryBtnCls}>
                              {pendingAssignmentSaveUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              Save Assignments
                            </button>
                            {hasAssignmentChanges(user) && pendingAssignmentSaveUserId !== user.id && (
                              <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Security Tab */}
                      {activeTab === 'security' && (
                        <div className="px-5 py-4">
                          <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Reset Password</label>
                          <div className="flex items-center gap-2 max-w-sm">
                            <div className="relative flex-1">
                              <input
                                type={showPasswordDrafts[user.id] ? 'text' : 'password'}
                                placeholder="New password (min. 6 chars)" minLength={6}
                                value={passwordDrafts[user.id] ?? ''}
                                onChange={e => setPasswordDrafts(prev => ({ ...prev, [user.id]: e.target.value }))}
                                disabled={pendingResetUserId === user.id}
                                className={inputCls + ' pr-10'} />
                              <button type="button"
                                onClick={() => setShowPasswordDrafts(prev => ({ ...prev, [user.id]: !prev[user.id] }))}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
                                {showPasswordDrafts[user.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            <button onClick={() => handleResetPassword(user)}
                              disabled={(passwordDrafts[user.id] ?? '').trim().length < 6 || pendingResetUserId === user.id}
                              className={primaryBtnCls + ' py-2.5 whitespace-nowrap'}>
                              {pendingResetUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                              Reset
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Danger Zone Tab */}
                      {activeTab === 'danger' && (
                        <div className="px-5 py-4">
                          {isSelf ? (
                            <div className="bg-subtle rounded-control p-4 border border-line text-center text-sm text-ink-muted">
                              You cannot archive or delete your own account.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="p-4 rounded-control border border-amber-100 bg-amber-50">
                                <div className="flex items-center gap-2 mb-1.5">
                                  {user.archivedAt ? <RotateCcw className="w-4 h-4 text-amber-600" /> : <Archive className="w-4 h-4 text-amber-600" />}
                                  <span className="text-sm font-semibold text-amber-800">{user.archivedAt ? 'Restore User' : 'Archive User'}</span>
                                </div>
                                <p className="text-xs text-amber-700 mb-3">
                                  {user.archivedAt ? 'Re-enables login access for this account.' : 'Disables login access while preserving all data. Can be restored anytime.'}
                                </p>
                                <button onClick={() => handleArchiveUser(user, !user.archivedAt)}
                                  disabled={pendingArchiveUserId === user.id}
                                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-control border bg-surface font-semibold text-xs disabled:opacity-50 transition-colors ${user.archivedAt ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}>
                                  {pendingArchiveUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : user.archivedAt ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                                  {user.archivedAt ? 'Restore' : 'Archive'}
                                </button>
                              </div>
                              <div className="p-4 rounded-control border border-red-100 bg-red-50">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                  <span className="text-sm font-semibold text-red-800">Delete User</span>
                                </div>
                                <p className="text-xs text-red-700 mb-3">Permanently removes this account and all associated data. Cannot be undone.</p>
                                <button onClick={() => handleDeleteUser(user)} disabled={pendingDeleteUserId === user.id}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control border border-red-300 bg-surface text-red-700 font-semibold text-xs hover:bg-red-50 disabled:opacity-50 transition-colors">
                                  {pendingDeleteUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                  Delete Permanently
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        )}
    </AdminShell>
  );
};

export default AdminUsersPage;
