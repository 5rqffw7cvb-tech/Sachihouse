import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Archive, ChevronDown, Eye, EyeOff, Loader2, Lock, Plus, RefreshCw, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { ApiUser } from '../services/api';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import {
  assignHostToProperty,
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserArchived,
  updateUserEmail,
  updateUserCanEditBlog,
  updateUserName,
  unassignHostFromProperty,
  updateUserRole,
  UserRole,
} from '../services/admin';
import { DEFAULT_SITE_SETTINGS, getAllProperties, getSiteSettings } from '../services/storage';
import { PropertyData, SiteSettings } from '../types';


const ROLE_OPTIONS: UserRole[] = ['ADMIN', 'HOST', 'GUEST'];

type UserTab = 'profile' | 'access' | 'properties' | 'security' | 'danger';

const ROLE_BADGE: Record<UserRole, string> = {
  ADMIN: 'bg-[#041627] text-white',
  HOST: 'bg-[#e6f5ec] text-[#0f7a44]',
  GUEST: 'bg-[#efedef] text-[#44474c]',
};

const AVATAR_COLOR: Record<UserRole, string> = {
  ADMIN: 'bg-[#041627] text-white',
  HOST: 'bg-[#e6f5ec] text-[#0f7a44]',
  GUEST: 'bg-[#efedef] text-[#44474c]',
};

const AdminUsersPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [properties, setProperties] = useState<(PropertyData & { id: string })[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);

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

  // Drafts
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, string[]>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<number, string>>({});
  const [showPasswordDrafts, setShowPasswordDrafts] = useState<Record<number, boolean>>({});
  const [emailDrafts, setEmailDrafts] = useState<Record<number, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});

  const isAdmin = authUser?.role === 'ADMIN';

  const stats = useMemo(() => ({
    total: users.length,
    admins: users.filter(u => u.role === 'ADMIN').length,
    hosts: users.filter(u => u.role === 'HOST').length,
    archived: users.filter(u => u.archivedAt).length,
  }), [users]);

  const propertyNameById = useMemo(() => {
    const map = new Map<string, string>();
    properties.forEach((property) => {
      map.set(property.id, property.name || property.id);
    });
    return map;
  }, [properties]);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => {
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
      const [fetchedUsers, fetchedProperties] = await Promise.all([listUsers(), getAllProperties()]);
      setUsers(fetchedUsers);
      setProperties(fetchedProperties);
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

  const handleLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

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

  // Reusable class helpers
  const inputCls = 'w-full px-3.5 py-2.5 bg-[#f5f3f4] border border-[#e4e2e3] rounded-xl text-sm text-[#1b1c1d] focus:outline-none focus:ring-2 focus:ring-[#041627]/20 focus:border-[#041627] transition-colors disabled:opacity-60';
  const selectCls = inputCls + ' appearance-none';
  const tabBtnCls = (active: boolean) =>
    `text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${active ? 'bg-white text-[#041627] shadow-sm' : 'text-[#74777d] hover:text-[#041627]'}`;
  const primaryBtnCls = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#041627] text-white font-semibold text-xs hover:bg-[#041627]/90 disabled:opacity-50 transition-colors';
  const secondaryBtnCls = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold text-xs hover:bg-[#efedef] disabled:opacity-50 transition-colors';

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col">
        <TopNavBar />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-[#e4e2e3] w-full max-w-md text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-[#efedef] text-[#44474c] flex items-center justify-center">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-[22px] font-bold text-[#1b1c1d] mb-2">User Admin Access</h2>
            <p className="text-sm text-[#44474c] mb-6">Sign in with an admin account to manage users and host assignments.</p>
            {errorMsg && <p className="text-red-600 text-sm text-center mb-3">{errorMsg}</p>}
            <button onClick={handleLogin} className="w-full bg-[#041627] hover:bg-[#041627]/90 text-white font-bold py-3 px-4 rounded-full">Login</button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[110px] pb-12">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-[#1b1c1d] mb-2">Admin role required</h1>
            <p className="text-[#44474c] mb-6">Your current account does not have permission to access user management.</p>
            <Link to="/" className="inline-flex items-center px-5 py-2.5 rounded-full border border-[#041627] text-[#041627] font-semibold hover:bg-[#efedef] transition-colors">Back to listings</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e8e5e6] text-[#1b1c1d] flex flex-col">
      <TopNavBar />
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-3 md:px-6 pt-[110px] pb-28 md:pb-10">

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[28px] font-bold leading-tight">User Administration</h1>
            <p className="text-[#44474c] mt-1">Manage user accounts, roles, and property assignments.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => loadData(true)}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold hover:bg-[#efedef] disabled:opacity-60 transition-colors"
            >
              {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button
              onClick={() => setCreateFormOpen(v => !v)}
              className="inline-flex items-center gap-2 bg-[#041627] hover:bg-[#041627]/90 text-white px-4 py-2 rounded-full font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" /> New User
            </button>
          </div>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div className="mb-5 border border-red-200 bg-red-50 text-red-700 rounded-2xl px-4 py-3 text-sm flex items-center justify-between gap-3">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="flex-shrink-0 text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
          </div>
        )}
        {infoMsg && (
          <div className="mb-5 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-2xl px-4 py-3 text-sm flex items-center justify-between gap-3">
            <span>{infoMsg}</span>
            <button onClick={() => setInfoMsg(null)} className="flex-shrink-0 text-emerald-400 hover:text-emerald-600"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Stats */}
        {!isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-2xl border border-[#e4e2e3] px-5 py-4">
              <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-[#041627]">{stats.total}</div>
              <div className="text-xs font-medium text-[#74777d] mt-0.5">Total Users</div>
            </div>
            <div className="bg-white rounded-2xl border border-[#e4e2e3] px-5 py-4">
              <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-[#041627]">{stats.admins}</div>
              <div className="text-xs font-medium text-[#74777d] mt-0.5">Admins</div>
            </div>
            <div className="bg-white rounded-2xl border border-[#e4e2e3] px-5 py-4">
              <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-[#0f7a44]">{stats.hosts}</div>
              <div className="text-xs font-medium text-[#74777d] mt-0.5">Hosts</div>
            </div>
            <div className="bg-white rounded-2xl border border-[#e4e2e3] px-5 py-4">
              <div className="text-2xl font-['Plus_Jakarta_Sans'] font-bold text-[#74777d]">{stats.archived}</div>
              <div className="text-xs font-medium text-[#74777d] mt-0.5">Archived</div>
            </div>
          </div>
        )}

        {/* Create User card */}
        {createFormOpen && (
        <div className="bg-white rounded-2xl border border-[#e4e2e3] mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e4e2e3] bg-[#f5f3f4] flex items-center justify-between">
            <span className="text-sm font-semibold text-[#1b1c1d]">Create New User</span>
            <button type="button" onClick={() => setCreateFormOpen(false)} className="text-[#74777d] hover:text-[#1b1c1d]"><X className="w-4 h-4" /></button>
          </div>
          <form onSubmit={handleCreateUser} className="px-6 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Full Name</label>
                  <input type="text" required placeholder="e.g. Nguyen Van A"
                    value={createForm.name} onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Email Address</label>
                  <input type="email" required placeholder="user@sachihouse.com"
                    value={createForm.email} onChange={e => setCreateForm(prev => ({ ...prev, email: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Password</label>
                  <div className="relative">
                    <input type={showCreatePassword ? 'text' : 'password'} required minLength={6} placeholder="Min. 6 characters"
                      value={createForm.password} onChange={e => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
                      className={inputCls + ' pr-10'} />
                    <button type="button" onClick={() => setShowCreatePassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#74777d] hover:text-[#1b1c1d]">
                      {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Role</label>
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
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${createForm.canEditBlog ? 'bg-[#041627]' : 'bg-[#c4c6cd]'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${createForm.canEditBlog ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <div>
                    <div className="text-sm font-semibold text-[#1b1c1d]">Grant Blog Editor Access</div>
                    <div className="text-xs text-[#74777d]">Allow this user to create and manage blog posts</div>
                  </div>
                </label>
              </div>
              <div className="flex items-center gap-3 pt-4 border-t border-[#e4e2e3]">
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
          <div className="py-16 flex items-center justify-center text-[#44474c]">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-[#44474c]">No users found.</div>
        ) : (
          <div className="rounded-2xl border border-[#e4e2e3] bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e4e2e3] bg-[#f5f3f4] flex items-center justify-between">
              <span className="text-sm font-semibold">{users.length} {users.length === 1 ? 'user' : 'users'}</span>
            </div>
            <div className="divide-y divide-[#efedef]">
            {users.map(user => {
              const isExpanded = expandedUserIds.has(user.id);
              const activeTab = getActiveTab(user);
              const isSelf = user.id === authUser?.id;
              const avatarColor = user.archivedAt ? 'bg-[#efedef] text-[#74777d]' : (AVATAR_COLOR[user.role] ?? 'bg-[#efedef] text-[#44474c]');
              const avatarInitial = (user.name || user.email).charAt(0).toUpperCase();

              return (
                <div key={user.id} className={`overflow-hidden transition-colors ${user.archivedAt ? 'opacity-80' : ''}`}>

                  {/* Card Header */}
                  <div
                    className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors hover:bg-[#faf9f9]`}
                    onClick={() => toggleUserCard(user)}
                  >
                    <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-['Plus_Jakarta_Sans'] font-bold text-base ${avatarColor}`}>
                      {avatarInitial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`font-['Plus_Jakarta_Sans'] font-bold text-sm ${user.archivedAt ? 'text-[#74777d]' : 'text-[#041627]'}`}>{user.name}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${user.archivedAt ? 'bg-[#efedef] text-[#74777d]' : (ROLE_BADGE[user.role] ?? 'bg-[#efedef] text-[#44474c]')}`}>{user.role}</span>
                        {user.archivedAt
                          ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Archived</span>
                          : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#e6f5ec] text-[#0f7a44]">Active</span>
                        }
                        {user.canEditBlog && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#efedef] text-[#44474c]">Blog Editor</span>}
                        {isSelf && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">You</span>}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate">
                        {user.email} · ID: {user.id}
                        {user.role === 'HOST' && user.assignedPropertyIds.length > 0 && ` · ${user.assignedPropertyIds.length} ${user.assignedPropertyIds.length === 1 ? 'property' : 'properties'}`}
                      </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Card Body */}
                  {isExpanded && (
                    <div className="border-t border-[#e4e2e3]">
                      {/* Tabs */}
                      <div className="flex items-center gap-1 px-4 pt-3 pb-2 bg-[#f5f3f4] flex-wrap">
                        <button onClick={() => setActiveTab(user.id, 'profile')} className={tabBtnCls(activeTab === 'profile')}>Profile</button>
                        <button onClick={() => setActiveTab(user.id, 'access')} className={tabBtnCls(activeTab === 'access')}>Role & Access</button>
                        {user.role === 'HOST' && (
                          <button onClick={() => setActiveTab(user.id, 'properties')} className={tabBtnCls(activeTab === 'properties')}>Properties</button>
                        )}
                        <button onClick={() => setActiveTab(user.id, 'security')} className={tabBtnCls(activeTab === 'security')}>Security</button>
                        <button
                          onClick={() => setActiveTab(user.id, 'danger')}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${activeTab === 'danger' ? 'bg-white text-red-600 shadow-sm' : 'text-red-400 hover:text-red-600'}`}
                        >Danger Zone</button>
                      </div>

                      {/* Profile Tab */}
                      {activeTab === 'profile' && (
                        <div className="px-5 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Full Name</label>
                              <input type="text"
                                value={nameDrafts[user.id] ?? user.name}
                                onChange={e => setNameDrafts(prev => ({ ...prev, [user.id]: e.target.value }))}
                                disabled={pendingProfileSaveUserId === user.id}
                                className={inputCls} />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Email Address</label>
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
                              <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-2">Role</label>
                              <div className="flex items-center gap-2">
                                <select
                                  value={user.role}
                                  disabled={pendingRoleUserId === user.id || isSelf}
                                  onChange={e => handleRoleChange(user, e.target.value as UserRole)}
                                  className={selectCls + (isSelf ? ' opacity-60 cursor-not-allowed' : '')}
                                >
                                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                                {pendingRoleUserId === user.id && <Loader2 className="w-4 h-4 animate-spin text-[#74777d]" />}
                              </div>
                              {isSelf && <p className="text-xs text-[#74777d] mt-1.5">Your own role cannot be changed here.</p>}
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-2">Blog Editor Access</label>
                              <div className="flex items-center gap-3">
                                <button type="button"
                                  disabled={pendingBlogPermissionUserId === user.id}
                                  onClick={() => handleBlogPermissionChange(user, !user.canEditBlog)}
                                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${user.canEditBlog ? 'bg-[#041627]' : 'bg-[#c4c6cd]'}`}>
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${user.canEditBlog ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                </button>
                                <span className="text-sm font-medium text-[#1b1c1d]">{user.canEditBlog ? 'Enabled' : 'Disabled'}</span>
                                {pendingBlogPermissionUserId === user.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#74777d]" />}
                              </div>
                              <p className="text-xs text-[#74777d] mt-1.5">Can create and edit blog posts.</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Properties Tab */}
                      {activeTab === 'properties' && user.role === 'HOST' && (
                        <div className="px-5 py-4">
                          <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-3">Assigned Properties</label>
                          {properties.length === 0 ? (
                            <p className="text-sm text-[#74777d]">No properties available.</p>
                          ) : (
                            <div className="space-y-2 mb-4">
                              {properties.map(property => {
                                const draftAssigned = assignmentDrafts[user.id] ?? user.assignedPropertyIds;
                                const isAssigned = draftAssigned.includes(property.id);
                                return (
                                  <label key={property.id} className="flex items-center gap-3 p-3 rounded-xl border border-[#e4e2e3] cursor-pointer hover:bg-[#f5f3f4] transition-colors">
                                    <input type="checkbox" checked={isAssigned}
                                      disabled={pendingAssignmentSaveUserId === user.id}
                                      onChange={() => handleAssignmentDraftToggle(user, property.id)}
                                      className="w-4 h-4 accent-[#041627]" />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-semibold text-[#1b1c1d]">{property.name || property.id}</div>
                                      <div className="text-xs text-[#74777d]">{property.id}</div>
                                    </div>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isAssigned ? 'bg-[#e6f5ec] text-[#0f7a44]' : 'bg-[#efedef] text-[#74777d]'}`}>
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
                          <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-2">Reset Password</label>
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
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#74777d] hover:text-[#1b1c1d]">
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
                            <div className="bg-[#f5f3f4] rounded-xl p-4 border border-[#e4e2e3] text-center text-sm text-[#74777d]">
                              You cannot archive or delete your own account.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="p-4 rounded-xl border border-amber-100 bg-amber-50">
                                <div className="flex items-center gap-2 mb-1.5">
                                  {user.archivedAt ? <RotateCcw className="w-4 h-4 text-amber-600" /> : <Archive className="w-4 h-4 text-amber-600" />}
                                  <span className="text-sm font-semibold text-amber-800">{user.archivedAt ? 'Restore User' : 'Archive User'}</span>
                                </div>
                                <p className="text-xs text-amber-700 mb-3">
                                  {user.archivedAt ? 'Re-enables login access for this account.' : 'Disables login access while preserving all data. Can be restored anytime.'}
                                </p>
                                <button onClick={() => handleArchiveUser(user, !user.archivedAt)}
                                  disabled={pendingArchiveUserId === user.id}
                                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border bg-white font-semibold text-xs disabled:opacity-50 transition-colors ${user.archivedAt ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}>
                                  {pendingArchiveUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : user.archivedAt ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                                  {user.archivedAt ? 'Restore' : 'Archive'}
                                </button>
                              </div>
                              <div className="p-4 rounded-xl border border-red-100 bg-red-50">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                  <span className="text-sm font-semibold text-red-800">Delete User</span>
                                </div>
                                <p className="text-xs text-red-700 mb-3">Permanently removes this account and all associated data. Cannot be undone.</p>
                                <button onClick={() => handleDeleteUser(user)} disabled={pendingDeleteUserId === user.id}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-300 bg-white text-red-700 font-semibold text-xs hover:bg-red-50 disabled:opacity-50 transition-colors">
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
      </main>

      <footer className="bg-[#f5f3f4] text-[#1b1c1d] text-[12px] md:text-[14px] font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] w-full py-6 md:py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 pb-20 md:pb-8 mt-8">
        <div className="text-[16px] md:text-[18px] font-bold text-[#1b1c1d]">{siteSettings.footerTitle}</div>
        <div className="flex flex-wrap justify-center gap-3 md:gap-6">
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Privacy Policy</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Terms of Service</a>
        </div>
        <div className="text-[#44474c]">{siteSettings.footerCopyright}</div>
      </footer>

      <MobileBottomNav />
    </div>
  );
};

export default AdminUsersPage;
