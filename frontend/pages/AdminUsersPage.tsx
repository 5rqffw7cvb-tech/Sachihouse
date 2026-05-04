import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Archive, Check, Eye, EyeOff, Loader2, Lock, Pencil, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { ApiUser } from '../services/api';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { TopNavBar } from '../components/TopNavBar';
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
import { getAllProperties } from '../services/storage';
import { PropertyData } from '../types';

const ROLE_OPTIONS: UserRole[] = ['ADMIN', 'HOST', 'GUEST'];

const AdminUsersPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [properties, setProperties] = useState<(PropertyData & { id: string })[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'HOST' as UserRole,
    canEditBlog: false,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [pendingRoleUserId, setPendingRoleUserId] = useState<number | null>(null);
  const [pendingProfileSaveUserId, setPendingProfileSaveUserId] = useState<number | null>(null);
  const [pendingArchiveUserId, setPendingArchiveUserId] = useState<number | null>(null);
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<number | null>(null);
  const [pendingBlogPermissionUserId, setPendingBlogPermissionUserId] = useState<number | null>(null);
  const [pendingAssignmentSaveUserId, setPendingAssignmentSaveUserId] = useState<number | null>(null);
  const [pendingResetUserId, setPendingResetUserId] = useState<number | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, string[]>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<number, string>>({});
  const [showPasswordDrafts, setShowPasswordDrafts] = useState<Record<number, boolean>>({});
  const [emailDrafts, setEmailDrafts] = useState<Record<number, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const [editingUserId, setEditingUserId] = useState<number | null>(null);

  const isAdmin = authUser?.role === 'ADMIN';

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
  }, [isAdmin]);

  const handleLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setIsCreating(true);

    try {
      await createUser(createForm);
      setCreateForm({ name: '', email: '', password: '', role: 'HOST', canEditBlog: false });
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

  const handleStartEditProfile = (user: ApiUser) => {
    setEditingUserId(user.id);
    setNameDrafts((prev) => ({
      ...prev,
      [user.id]: user.name,
    }));
    setEmailDrafts((prev) => ({
      ...prev,
      [user.id]: user.email,
    }));
  };

  const handleCancelEditProfile = () => {
    setEditingUserId(null);
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
      setEditingUserId(null);
      setInfoMsg(`User profile updated for ${user.email}.`);
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

  if (!isAuthenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 pt-20">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-200 w-full max-w-md">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-700">
              <Lock className="w-6 h-6" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">User Admin Access</h2>
          <p className="text-sm text-gray-500 text-center mb-6">Sign in with an admin account to manage users and host assignments.</p>
          {errorMsg && <p className="text-red-600 text-sm text-center mb-3">{errorMsg}</p>}
          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg"
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#fbf9fa]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[110px] pb-12">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-[#1b1c1d] mb-2">Admin role required</h1>
            <p className="text-[#44474c] mb-6">Your current account does not have permission to access user management.</p>
            <Link to="/" className="inline-flex items-center px-5 py-2.5 rounded-full border border-[#041627] text-[#041627] font-semibold hover:bg-[#efedef] transition-colors">
              Back to listings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbf9fa] text-[#1b1c1d]">
      <TopNavBar />
      <main className="max-w-[1280px] mx-auto px-3 md:px-6 pt-[110px] pb-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[28px] font-bold leading-tight">User Administration</h1>
            <p className="text-[#44474c]">Create accounts, control roles, and manage host property assignments.</p>
          </div>
          <button
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="self-start md:self-auto inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold hover:bg-[#efedef] disabled:opacity-60 transition-colors"
          >
            {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>

        {errorMsg && (
          <div className="mb-6 border border-red-200 bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div className="mb-6 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-xl px-4 py-3 text-sm">
            {infoMsg}
          </div>
        )}

        <section className="bg-white border border-[#e4e2e3] rounded-2xl p-5 md:p-6 shadow-sm mb-6">
          <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold mb-4">Create New User</h2>
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              type="text"
              placeholder="Full name"
              required
              value={createForm.name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              className="px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627]"
            />
            <input
              type="email"
              placeholder="email@sachihouse.com"
              required
              value={createForm.email}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
              className="md:col-span-2 px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627]"
            />
            <input
              type="password"
              placeholder="Password"
              required
              minLength={6}
              value={createForm.password}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
              className="px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627]"
            />
            <select
              value={createForm.role}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, role: event.target.value as UserRole }))}
              className="px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627]"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <label className="md:col-span-5 inline-flex items-center gap-2 text-sm font-medium text-[#44474c]">
              <input
                type="checkbox"
                checked={createForm.canEditBlog}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, canEditBlog: event.target.checked }))}
              />
              Grant blog editor permission
            </label>
            <div className="md:col-span-5">
              <button
                type="submit"
                disabled={isCreating}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#041627] text-white font-semibold hover:bg-[#041627]/90 disabled:opacity-60 transition-colors"
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create User
              </button>
            </div>
          </form>
        </section>

        <section className="bg-white border border-[#e4e2e3] rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 md:px-6 py-4 border-b border-[#e4e2e3] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#041627]" />
            <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold">Users</h2>
          </div>

          {isLoading ? (
            <div className="p-10 flex items-center justify-center text-[#44474c]">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading users...
            </div>
          ) : users.length === 0 ? (
            <div className="p-10 text-center text-[#44474c]">No users found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f5f3f4] text-[#44474c]">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Name / Email</th>
                    <th className="text-left px-4 py-3 font-semibold">Role</th>
                    <th className="text-left px-4 py-3 font-semibold">Blog Editor</th>
                    <th className="text-left px-4 py-3 font-semibold">Assigned Properties</th>
                    <th className="text-left px-4 py-3 font-semibold">Manage Assignments</th>
                    <th className="text-left px-4 py-3 font-semibold">Reset Password</th>
                    <th className="text-left px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-[#efedef] align-top">
                      <td className="px-4 py-4">
                        {editingUserId === user.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={nameDrafts[user.id] ?? user.name}
                              onChange={(event) => setNameDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
                              className="w-full px-3 py-1.5 border border-[#c4c6cd] rounded-lg bg-white text-[#1b1c1d]"
                              disabled={pendingProfileSaveUserId === user.id}
                            />
                            <input
                              type="email"
                              value={emailDrafts[user.id] ?? user.email}
                              onChange={(event) => setEmailDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
                              className="w-full px-3 py-1.5 border border-[#c4c6cd] rounded-lg bg-white text-[#1b1c1d]"
                              disabled={pendingProfileSaveUserId === user.id}
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSaveEditProfile(user)}
                                disabled={pendingProfileSaveUserId === user.id}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#041627] text-white text-xs font-semibold disabled:opacity-50"
                              >
                                {pendingProfileSaveUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                Save
                              </button>
                              <button
                                onClick={handleCancelEditProfile}
                                disabled={pendingProfileSaveUserId === user.id}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-[#c4c6cd] text-[#44474c] text-xs font-semibold disabled:opacity-50"
                              >
                                <X className="w-3.5 h-3.5" />
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="font-semibold text-[#1b1c1d]">{user.name}</div>
                            <div className="text-[#44474c]">{user.email}</div>
                            <div className="text-xs text-[#74777d]">ID: {user.id}</div>
                            {user.archivedAt && <div className="text-xs font-semibold text-amber-700 mt-1">Archived</div>}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <select
                          value={user.role}
                          disabled={pendingRoleUserId === user.id || user.id === authUser?.id}
                          onChange={(event) => handleRoleChange(user, event.target.value as UserRole)}
                          className="px-3 py-1.5 border border-[#c4c6cd] rounded-lg bg-white text-[#1b1c1d] disabled:bg-[#f5f3f4]"
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                        {pendingRoleUserId === user.id && <Loader2 className="w-4 h-4 animate-spin inline-block ml-2" />}
                        {user.id === authUser?.id && (
                          <div className="text-xs text-[#74777d] mt-1">Your role cannot be edited here.</div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <label className="inline-flex items-center gap-2 text-[#1b1c1d]">
                          <input
                            type="checkbox"
                            checked={user.canEditBlog}
                            disabled={pendingBlogPermissionUserId === user.id}
                            onChange={(event) => handleBlogPermissionChange(user, event.target.checked)}
                          />
                          <span>{user.canEditBlog ? 'Enabled' : 'Disabled'}</span>
                        </label>
                        {pendingBlogPermissionUserId === user.id && <Loader2 className="w-4 h-4 animate-spin inline-block ml-2" />}
                      </td>
                      <td className="px-4 py-4">
                        {user.assignedPropertyIds.length === 0 ? (
                          <span className="text-[#74777d]">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {user.assignedPropertyIds.map((propertyId) => (
                              <span key={propertyId} className="px-2 py-1 rounded-full bg-[#efedef] text-[#1b1c1d] text-xs font-semibold">
                                {propertyNameById.get(propertyId) || propertyId}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {user.role !== 'HOST' ? (
                          <span className="text-[#74777d]">Only HOST can be assigned.</span>
                        ) : properties.length === 0 ? (
                          <span className="text-[#74777d]">No properties available.</span>
                        ) : (
                          <div className="space-y-2">
                            {properties.map((property) => {
                              const draftAssigned = assignmentDrafts[user.id] ?? user.assignedPropertyIds;
                              const assigned = draftAssigned.includes(property.id);
                              return (
                                <label key={property.id} className="flex items-center gap-2 text-[#1b1c1d]">
                                  <input
                                    type="checkbox"
                                    checked={assigned}
                                    disabled={pendingAssignmentSaveUserId === user.id}
                                    onChange={() => handleAssignmentDraftToggle(user, property.id)}
                                  />
                                  <span>{property.name}</span>
                                </label>
                              );
                            })}
                            <div className="pt-1 flex items-center gap-2">
                              <button
                                onClick={() => handleSaveAssignments(user)}
                                disabled={!hasAssignmentChanges(user) || pendingAssignmentSaveUserId === user.id}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#041627] text-white text-xs font-semibold hover:bg-[#041627]/90 disabled:opacity-50"
                              >
                                {pendingAssignmentSaveUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                Save Assignments
                              </button>
                              {hasAssignmentChanges(user) && pendingAssignmentSaveUserId !== user.id && (
                                <span className="text-xs text-amber-700">Unsaved changes</span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <input
                            type={showPasswordDrafts[user.id] ? 'text' : 'password'}
                            placeholder="New password"
                            minLength={6}
                            value={passwordDrafts[user.id] ?? ''}
                            onChange={(event) => setPasswordDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
                            className="px-3 py-1.5 border border-[#c4c6cd] rounded-lg bg-white text-[#1b1c1d]"
                            disabled={pendingResetUserId === user.id}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPasswordDrafts((prev) => ({ ...prev, [user.id]: !prev[user.id] }))}
                            disabled={pendingResetUserId === user.id}
                            className="inline-flex items-center justify-center p-2 rounded-lg border border-[#c4c6cd] text-[#44474c] hover:bg-[#efedef] disabled:opacity-50"
                            title={showPasswordDrafts[user.id] ? 'Hide password' : 'Show password'}
                          >
                            {showPasswordDrafts[user.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleResetPassword(user)}
                            disabled={(passwordDrafts[user.id] ?? '').trim().length < 6 || pendingResetUserId === user.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-[#041627] text-[#041627] text-xs font-semibold hover:bg-[#efedef] disabled:opacity-50"
                          >
                            {pendingResetUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                            Reset
                          </button>
                        </div>
                        <div className="text-xs text-[#74777d] mt-1">Minimum 6 characters.</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleStartEditProfile(user)}
                            disabled={pendingArchiveUserId === user.id || pendingProfileSaveUserId === user.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-[#041627] text-[#041627] text-xs font-semibold hover:bg-[#efedef] disabled:opacity-50"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleArchiveUser(user, !user.archivedAt)}
                            disabled={pendingArchiveUserId === user.id || user.id === authUser?.id}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50 ${user.archivedAt ? 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'}`}
                          >
                            {pendingArchiveUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : user.archivedAt ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                            {user.archivedAt ? 'Restore' : 'Archive'}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user)}
                            disabled={pendingDeleteUserId === user.id || user.id === authUser?.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
                          >
                            {pendingDeleteUserId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Delete
                          </button>
                        </div>
                        {user.id === authUser?.id && (
                          <div className="text-xs text-[#74777d] mt-1">Your own account cannot be modified.</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default AdminUsersPage;
