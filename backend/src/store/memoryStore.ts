import bcrypt from 'bcryptjs';
import { blogPostsSeed, blockedDatesSeed, createUserSeed, propertiesSeed, siteSettingsSeed } from './seed.js';
import {
  AuthUser,
  BlogPost,
  BookingConfirmation,
  BookingConfirmationInput,
  BookingConfirmationListFilters,
  BookingConfirmationPatch,
  generateConfirmationNo,
  CheckInGuest,
  CheckInListFilters,
  CheckInSubmission,
  CheckInSubmissionInput,
  DataStore,
  FinancialTransaction,
  FinancialTransactionInput,
  PendingTransaction,
  PendingTransactionInput,
  IngestRule,
  PropertyData,
  SiteSettings,
  StoredUser,
  SubscriptionRequest,
  SubscriptionRequestStatus,
  HostPlanCode,
  BillingCycle,
} from './types.js';
import { Role } from '../types/domain.js';

interface MemoryState {
  users: StoredUser[];
  properties: Array<PropertyData & { id: string }>;
  siteSettings: SiteSettings;
  blogPosts: BlogPost[];
  blockedDates: Record<string, string[]>;
  checkIns: CheckInSubmission[];
  bookingConfirmations: BookingConfirmation[];
  financialTransactions: FinancialTransaction[];
  pendingTransactions: PendingTransaction[];
  subscriptionRequests: SubscriptionRequest[];
  ingestRules: IngestRule[];
}

export class MemoryStore implements DataStore {
  private state: MemoryState | null = null;

  async init(): Promise<void> {
    if (this.state) {
      return;
    }

    this.state = {
      users: await createUserSeed(),
      properties: structuredClone(propertiesSeed),
      siteSettings: structuredClone(siteSettingsSeed),
      blogPosts: structuredClone(blogPostsSeed),
      blockedDates: structuredClone(blockedDatesSeed),
      checkIns: [],
      bookingConfirmations: [],
      financialTransactions: [],
      pendingTransactions: [],
      subscriptionRequests: [],
      ingestRules: [],
    };
  }

  private assertState(): MemoryState {
    if (!this.state) {
      throw new Error('Memory store not initialized.');
    }
    return this.state;
  }

  private toAuthUser(user: StoredUser): AuthUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      canEditBlog: user.canEditBlog,
      archivedAt: user.archivedAt ?? null,
      assignedPropertyIds: [...user.assignedPropertyIds],
      hostLevel: user.hostLevel ?? null,
      lastSeenAt: user.lastSeenAt ?? null,
    };
  }

  async touchUserLastSeen(userId: number, timestamp: number): Promise<void> {
    const user = this.assertState().users.find((candidate) => candidate.id === userId);
    if (user) {
      user.lastSeenAt = timestamp;
    }
  }

  async authenticate(email: string, password: string): Promise<AuthUser | null> {
    const state = this.assertState();
    const user = state.users.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase() && !candidate.archivedAt);
    if (!user) {
      return null;
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    return isMatch ? this.toAuthUser(user) : null;
  }

  async getUserById(id: number): Promise<AuthUser | null> {
    const user = this.assertState().users.find((candidate) => candidate.id === id && !candidate.archivedAt);
    return user ? this.toAuthUser(user) : null;
  }

  async listUsers(): Promise<AuthUser[]> {
    return this.assertState().users.map((user) => this.toAuthUser(user));
  }

  async createUser(name: string, email: string, password: string, role: Role, canEditBlog: boolean, _actor: AuthUser): Promise<AuthUser> {
    const state = this.assertState();
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedName) {
      throw new Error('Name is required.');
    }
    if (state.users.some((candidate) => candidate.email.toLowerCase() === normalizedEmail)) {
      throw new Error('Email is already in use.');
    }

    const nextId = state.users.length ? Math.max(...state.users.map((user) => user.id)) + 1 : 1;
    const passwordHash = await bcrypt.hash(password, 10);
    const nextUser: StoredUser = {
      id: nextId,
      name: normalizedName,
      email: normalizedEmail,
      role,
      canEditBlog,
      passwordHash,
      archivedAt: null,
      assignedPropertyIds: [],
      hostLevel: null,
    };
    state.users.push(nextUser);
    return this.toAuthUser(nextUser);
  }

  async registerHost(name: string, email: string, password: string): Promise<AuthUser> {
    const state = this.assertState();
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedName) {
      throw new Error('Name is required.');
    }
    if (state.users.some((candidate) => candidate.email.toLowerCase() === normalizedEmail)) {
      throw new Error('Email is already in use.');
    }

    const nextId = state.users.length ? Math.max(...state.users.map((user) => user.id)) + 1 : 1;
    const passwordHash = await bcrypt.hash(password, 10);
    const nextUser: StoredUser = {
      id: nextId,
      name: normalizedName,
      email: normalizedEmail,
      role: 'HOST',
      canEditBlog: false,
      passwordHash,
      archivedAt: null,
      assignedPropertyIds: [],
      hostLevel: 1,
    };
    state.users.push(nextUser);
    return this.toAuthUser(nextUser);
  }

  async updateUserName(userId: number, name: string, _actor: AuthUser): Promise<AuthUser> {
    const state = this.assertState();
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error('Name is required.');
    }

    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('User not found.');
    }

    user.name = normalizedName;
    return this.toAuthUser(user);
  }

  async updateUserEmail(userId: number, email: string, _actor: AuthUser): Promise<AuthUser> {
    const state = this.assertState();
    const normalizedEmail = email.trim().toLowerCase();
    if (state.users.some((candidate) => candidate.id !== userId && candidate.email.toLowerCase() === normalizedEmail)) {
      throw new Error('Email is already in use.');
    }

    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('User not found.');
    }

    user.email = normalizedEmail;
    return this.toAuthUser(user);
  }

  async updateUserRole(userId: number, role: Role, _actor: AuthUser): Promise<AuthUser> {
    const state = this.assertState();
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('User not found.');
    }

    user.role = role;
    if (role !== 'HOST') {
      user.assignedPropertyIds = [];
    }

    return this.toAuthUser(user);
  }

  async updateUserCanEditBlog(userId: number, canEditBlog: boolean, _actor: AuthUser): Promise<AuthUser> {
    const state = this.assertState();
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('User not found.');
    }

    user.canEditBlog = canEditBlog;
    return this.toAuthUser(user);
  }

  async updateUserHostLevel(userId: number, level: 1 | 2 | 3 | 4 | null, _actor: AuthUser): Promise<AuthUser> {
    const state = this.assertState();
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('User not found.');
    }
    user.hostLevel = level;
    return this.toAuthUser(user);
  }

  async setUserArchived(userId: number, archived: boolean, _actor: AuthUser): Promise<AuthUser> {
    const state = this.assertState();
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('User not found.');
    }

    user.archivedAt = archived ? Date.now() : null;
    return this.toAuthUser(user);
  }

  async updateUserPassword(userId: number, password: string, _actor: AuthUser): Promise<void> {
    const state = this.assertState();
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error('User not found.');
    }

    user.passwordHash = await bcrypt.hash(password, 10);
  }

  async deleteUser(userId: number, _actor: AuthUser): Promise<void> {
    const state = this.assertState();
    const index = state.users.findIndex((candidate) => candidate.id === userId);
    if (index === -1) {
      throw new Error('User not found.');
    }
    state.users.splice(index, 1);
  }

  async listProperties(includeArchived = false): Promise<Array<PropertyData & { id: string }>> {
    const properties = this.assertState().properties.filter((property) => includeArchived || !property.archivedAt);
    return structuredClone(properties);
  }

  async getProperty(idOrMetalink: string): Promise<(PropertyData & { id: string }) | null> {
    const property = this.assertState().properties.find((item) => item.id === idOrMetalink || item.metalink === idOrMetalink);
    return property ? structuredClone(property) : null;
  }

  async createProperty(property: PropertyData): Promise<PropertyData & { id: string }> {
    const state = this.assertState();
    const id = property.id ?? `list_${Math.random().toString(36).slice(2, 7)}`;
    if (property.metalink && state.properties.some((item) => item.metalink === property.metalink)) {
      throw new Error('Custom URL is already taken.');
    }
    const next = { ...structuredClone(property), id };
    state.properties.push(next);
    return structuredClone(next);
  }

  async renameProperty(propertyId: string, newPropertyId: string, property: PropertyData): Promise<PropertyData & { id: string }> {
    const state = this.assertState();
    const index = state.properties.findIndex((item) => item.id === propertyId || item.metalink === propertyId);
    if (index === -1) {
      throw new Error('Property not found.');
    }
    const targetId = newPropertyId.trim();
    if (!targetId) {
      throw new Error('New property id is required.');
    }
    if (state.properties.some((item) => item.id === targetId && item.id !== state.properties[index].id)) {
      throw new Error('Property id is already in use.');
    }
    if (property.metalink && state.properties.some((item) => item.id !== state.properties[index].id && item.metalink === property.metalink)) {
      throw new Error('Custom URL is already taken.');
    }

    const current = state.properties[index];
    const oldId = current.id;
    const next = { ...current, ...structuredClone(property), id: targetId };
    state.properties[index] = next;

    state.users = state.users.map((user) => {
      if (user.role !== 'HOST') {
        return user;
      }
      if (!user.assignedPropertyIds.includes(oldId)) {
        return user;
      }
      return {
        ...user,
        assignedPropertyIds: user.assignedPropertyIds.map((assignedId) => assignedId === oldId ? targetId : assignedId),
      };
    });

    if (state.blockedDates[oldId]) {
      state.blockedDates[targetId] = state.blockedDates[oldId];
      delete state.blockedDates[oldId];
    }

    state.checkIns = state.checkIns.map((submission) => {
      if (submission.propertyId !== oldId) {
        return submission;
      }
      return { ...submission, propertyId: targetId };
    });

    state.bookingConfirmations = state.bookingConfirmations.map((confirmation) => {
      if (confirmation.propertyId !== oldId) {
        return confirmation;
      }
      return { ...confirmation, propertyId: targetId };
    });

    return structuredClone(next);
  }

  async saveProperty(propertyId: string, property: PropertyData): Promise<PropertyData & { id: string }> {
    const state = this.assertState();
    const index = state.properties.findIndex((item) => item.id === propertyId || item.metalink === propertyId);
    if (index === -1) {
      throw new Error('Property not found.');
    }
    if (property.metalink && state.properties.some((item) => item.id !== state.properties[index].id && item.metalink === property.metalink)) {
      throw new Error('Custom URL is already taken.');
    }
    const current = state.properties[index];
    const next = { ...current, ...structuredClone(property), id: current.id };
    state.properties[index] = next;
    return structuredClone(next);
  }

  async setPropertyArchived(propertyId: string, archived: boolean): Promise<PropertyData & { id: string }> {
    const state = this.assertState();
    const index = state.properties.findIndex((item) => item.id === propertyId);
    if (index === -1) {
      throw new Error('Property not found.');
    }

    state.properties[index] = {
      ...state.properties[index],
      archivedAt: archived ? Date.now() : null,
    };

    return structuredClone(state.properties[index]);
  }

  async deleteProperty(propertyId: string): Promise<void> {
    const state = this.assertState();
    state.properties = state.properties.filter((item) => item.id !== propertyId);
  }

  async getSiteSettings(): Promise<SiteSettings> {
    return structuredClone({ ...siteSettingsSeed, ...this.assertState().siteSettings });
  }

  async saveSiteSettings(settings: SiteSettings): Promise<SiteSettings> {
    const next = { ...siteSettingsSeed, ...structuredClone(settings) };
    this.assertState().siteSettings = next;
    return structuredClone(next);
  }

  async createSubscriptionRequest(userId: number, planCode: HostPlanCode, billingCycle: BillingCycle): Promise<SubscriptionRequest> {
    const state = this.assertState();
    const user = state.users.find((candidate) => candidate.id === userId && !candidate.archivedAt);
    if (!user) {
      throw new Error('User not found.');
    }
    const now = Date.now();
    const request: SubscriptionRequest = {
      id: `sub_${now}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      userName: user.name,
      userEmail: user.email,
      planCode,
      billingCycle,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      decidedByUserId: null,
    };
    state.subscriptionRequests.push(request);
    return structuredClone(request);
  }

  async listSubscriptionRequests(filters?: { status?: SubscriptionRequestStatus; userId?: number }): Promise<SubscriptionRequest[]> {
    return structuredClone(this.assertState().subscriptionRequests)
      .filter((request) => (filters?.status ? request.status === filters.status : true))
      .filter((request) => (filters?.userId ? request.userId === filters.userId : true))
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async getSubscriptionRequest(id: string): Promise<SubscriptionRequest | null> {
    const request = this.assertState().subscriptionRequests.find((candidate) => candidate.id === id);
    return request ? structuredClone(request) : null;
  }

  async updateSubscriptionRequestStatus(id: string, status: SubscriptionRequestStatus, actor: AuthUser): Promise<SubscriptionRequest> {
    const request = this.assertState().subscriptionRequests.find((candidate) => candidate.id === id);
    if (!request) {
      throw new Error('Subscription request not found.');
    }
    request.status = status;
    request.decidedByUserId = actor.id;
    request.updatedAt = Date.now();
    return structuredClone(request);
  }

  async listBlockedDates(propertyId: string): Promise<string[]> {
    return [...(this.assertState().blockedDates[propertyId] ?? [])];
  }

  async listBlogPosts(includeArchived = false): Promise<BlogPost[]> {
    return structuredClone(this.assertState().blogPosts)
      .filter((post) => includeArchived || !post.archivedAt)
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async getBlogPost(id: string): Promise<BlogPost | null> {
    const post = this.assertState().blogPosts.find((item) => item.id === id);
    return post ? structuredClone(post) : null;
  }

  async createBlogPost(post: Omit<BlogPost, 'createdAt' | 'updatedAt'>): Promise<BlogPost> {
    const next: BlogPost = {
      ...structuredClone(post),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.assertState().blogPosts.unshift(next);
    return structuredClone(next);
  }

  async updateBlogPost(id: string, post: Partial<Omit<BlogPost, 'id' | 'createdAt' | 'authorId'>>): Promise<BlogPost> {
    const state = this.assertState();
    const index = state.blogPosts.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error('Blog post not found.');
    }
    const next = { ...state.blogPosts[index], ...structuredClone(post), updatedAt: Date.now() };
    state.blogPosts[index] = next;
    return structuredClone(next);
  }

  async setBlogPostArchived(id: string, archived: boolean): Promise<BlogPost> {
    const state = this.assertState();
    const index = state.blogPosts.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error('Blog post not found.');
    }

    state.blogPosts[index] = {
      ...state.blogPosts[index],
      archivedAt: archived ? Date.now() : null,
      updatedAt: Date.now(),
    };

    return structuredClone(state.blogPosts[index]);
  }

  async deleteBlogPost(id: string): Promise<void> {
    const state = this.assertState();
    state.blogPosts = state.blogPosts.filter((item) => item.id !== id);
  }

  async assignHost(propertyId: string, hostUserId: number): Promise<void> {
    const state = this.assertState();
    const user = state.users.find((item) => item.id === hostUserId);
    if (!user) {
      throw new Error('Host user not found.');
    }
    if (user.role !== 'HOST') {
      throw new Error('Only HOST users can be assigned to properties.');
    }
    if (!user.assignedPropertyIds.includes(propertyId)) {
      user.assignedPropertyIds.push(propertyId);
    }
  }

  async unassignHost(propertyId: string, hostUserId: number): Promise<void> {
    const state = this.assertState();
    const user = state.users.find((item) => item.id === hostUserId);
    if (!user) {
      throw new Error('Host user not found.');
    }
    user.assignedPropertyIds = user.assignedPropertyIds.filter((item) => item !== propertyId);
  }

  async createCheckInSubmission(input: CheckInSubmissionInput): Promise<CheckInSubmission> {
    const state = this.assertState();
    const now = Date.now();
    const submission: CheckInSubmission = {
      id: `ci_${Math.random().toString(36).slice(2, 10)}`,
      propertyId: input.propertyId,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      guests: structuredClone(input.guests),
      consent: structuredClone(input.consent),
      audit: structuredClone(input.audit),
      createdAt: now,
      updatedAt: now,
    };
    state.checkIns.unshift(submission);
    return structuredClone(submission);
  }

  async listCheckInSubmissions(filters?: CheckInListFilters): Promise<CheckInSubmission[]> {
    const state = this.assertState();
    const guestNameNeedle = filters?.guestName?.trim().toLowerCase() ?? '';
    const nationalityNeedle = filters?.nationality?.trim().toLowerCase() ?? '';

    const rows = state.checkIns.filter((submission) => {
      if (filters?.propertyId && submission.propertyId !== filters.propertyId) {
        return false;
      }
      if (filters?.fromDate && submission.checkInDate < filters.fromDate) {
        return false;
      }
      if (filters?.toDate && submission.checkInDate > filters.toDate) {
        return false;
      }
      if (guestNameNeedle && !submission.guests.some((guest) => guest.fullName.toLowerCase().includes(guestNameNeedle))) {
        return false;
      }
      if (nationalityNeedle && !submission.guests.some((guest) => guest.nationality.toLowerCase().includes(nationalityNeedle))) {
        return false;
      }
      return true;
    });

    return structuredClone(rows).sort((left, right) => right.createdAt - left.createdAt);
  }

  async getCheckInSubmission(id: string): Promise<CheckInSubmission | null> {
    const row = this.assertState().checkIns.find((item) => item.id === id);
    return row ? structuredClone(row) : null;
  }

  async updateCheckInSubmission(
    id: string,
    patch: {
      checkInDate?: string;
      checkOutDate?: string;
      guests?: CheckInGuest[];
    },
  ): Promise<CheckInSubmission | null> {
    const state = this.assertState();
    const rowIndex = state.checkIns.findIndex((item) => item.id === id);
    if (rowIndex < 0) {
      return null;
    }

    const current = state.checkIns[rowIndex];
    const next: CheckInSubmission = {
      ...current,
      checkInDate: patch.checkInDate ?? current.checkInDate,
      checkOutDate: patch.checkOutDate ?? current.checkOutDate,
      guests: patch.guests ? structuredClone(patch.guests) : structuredClone(current.guests),
      updatedAt: Date.now(),
    };

    state.checkIns[rowIndex] = next;
    return structuredClone(next);
  }

  async deleteCheckInSubmission(id: string): Promise<boolean> {
    const state = this.assertState();
    const rowIndex = state.checkIns.findIndex((item) => item.id === id);
    if (rowIndex < 0) {
      return false;
    }

    state.checkIns.splice(rowIndex, 1);
    return true;
  }

  async deleteExpiredCheckInSubmissions(olderThanTimestamp: number): Promise<CheckInSubmission[]> {
    const state = this.assertState();
    const expired = state.checkIns.filter((submission) => submission.createdAt < olderThanTimestamp);
    if (expired.length === 0) {
      return [];
    }

    state.checkIns = state.checkIns.filter((submission) => submission.createdAt >= olderThanTimestamp);
    return structuredClone(expired);
  }

  async createBookingConfirmation(input: BookingConfirmationInput): Promise<BookingConfirmation> {
    const state = this.assertState();
    const now = Date.now();
    const confirmation: BookingConfirmation = {
      id: `bc_${Math.random().toString(36).slice(2, 10)}`,
      confirmationNo: generateConfirmationNo(now),
      propertyId: input.propertyId,
      propertyName: input.propertyName,
      propertyAddress: input.propertyAddress,
      propertyUrl: input.propertyUrl,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      numGuests: input.numGuests,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      currency: input.currency,
      roomFee: input.roomFee,
      cleaningFee: input.cleaningFee,
      extraFeeLabel: input.extraFeeLabel,
      extraFee: input.extraFee,
      totalAmount: input.totalAmount,
      depositAmount: input.depositAmount,
      balanceDue: input.balanceDue,
      notes: input.notes,
      includeInAccounting: input.includeInAccounting,
      createdByUserId: input.createdByUserId,
      createdByName: input.createdByName,
      createdAt: now,
      updatedAt: now,
    };
    state.bookingConfirmations.unshift(confirmation);
    return structuredClone(confirmation);
  }

  async listBookingConfirmations(filters?: BookingConfirmationListFilters): Promise<BookingConfirmation[]> {
    const state = this.assertState();
    const guestNameNeedle = filters?.guestName?.trim().toLowerCase() ?? '';

    const rows = state.bookingConfirmations.filter((row) => {
      if (filters?.propertyId && row.propertyId !== filters.propertyId) {
        return false;
      }
      if (filters?.fromDate && row.checkInDate < filters.fromDate) {
        return false;
      }
      if (filters?.toDate && row.checkInDate > filters.toDate) {
        return false;
      }
      if (guestNameNeedle && !row.guestName.toLowerCase().includes(guestNameNeedle)) {
        return false;
      }
      return true;
    });

    return structuredClone(rows).sort((left, right) => right.createdAt - left.createdAt);
  }

  async getBookingConfirmation(id: string): Promise<BookingConfirmation | null> {
    const row = this.assertState().bookingConfirmations.find((item) => item.id === id);
    return row ? structuredClone(row) : null;
  }

  async updateBookingConfirmation(id: string, patch: BookingConfirmationPatch): Promise<BookingConfirmation | null> {
    const state = this.assertState();
    const index = state.bookingConfirmations.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }
    const current = state.bookingConfirmations[index];
    const next: BookingConfirmation = {
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      id: current.id,
      updatedAt: Date.now(),
    };
    state.bookingConfirmations[index] = next;
    return structuredClone(next);
  }

  async deleteBookingConfirmation(id: string): Promise<boolean> {
    const state = this.assertState();
    const index = state.bookingConfirmations.findIndex((item) => item.id === id);
    if (index < 0) {
      return false;
    }
    state.bookingConfirmations.splice(index, 1);
    return true;
  }

  async listFinancialTransactions(propertyIds: string[], year?: number): Promise<FinancialTransaction[]> {
    const state = this.assertState();
    let txns = state.financialTransactions.filter((t) => propertyIds.includes(t.propertyId));
    if (year) {
      txns = txns.filter((t) => new Date(t.transactionDate).getFullYear() === year);
    }
    return structuredClone(txns.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate)));
  }

  async createFinancialTransaction(input: FinancialTransactionInput, _actor: AuthUser): Promise<FinancialTransaction> {
    const state = this.assertState();
    const now = Date.now();
    const txn: FinancialTransaction = {
      id: `txn_${now}_${Math.random().toString(36).slice(2)}`,
      propertyId: input.propertyId,
      transactionNo: input.transactionNo,
      transactionDate: input.transactionDate,
      debitAccount: input.debitAccount,
      debitAmount: input.debitAmount,
      creditAccount: input.creditAccount,
      creditAmount: input.creditAmount,
      description: input.description,
      receiptUrl: input.receiptUrl,
      sourceRef: input.sourceRef,
      createdAt: now,
      updatedAt: now,
    };
    state.financialTransactions.push(txn);
    return structuredClone(txn);
  }

  async updateFinancialTransaction(id: string, input: Partial<FinancialTransactionInput>, _actor: AuthUser): Promise<FinancialTransaction> {
    const state = this.assertState();
    const idx = state.financialTransactions.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error('Transaction not found');
    const updated: FinancialTransaction = {
      ...state.financialTransactions[idx],
      ...Object.fromEntries(Object.entries({
        propertyId: input.propertyId,
        transactionNo: input.transactionNo,
        transactionDate: input.transactionDate,
        debitAccount: input.debitAccount,
        debitAmount: input.debitAmount,
        creditAccount: input.creditAccount,
        creditAmount: input.creditAmount,
        description: input.description,
        receiptUrl: input.receiptUrl,
      }).filter(([, v]) => v !== undefined)),
      updatedAt: Date.now(),
    };
    state.financialTransactions[idx] = updated;
    return structuredClone(updated);
  }

  async deleteFinancialTransaction(id: string, _actor: AuthUser): Promise<FinancialTransaction | null> {
    const state = this.assertState();
    const found = state.financialTransactions.find((t) => t.id === id) ?? null;
    state.financialTransactions = state.financialTransactions.filter((t) => t.id !== id);
    return found ? structuredClone(found) : null;
  }

  async bulkImportFinancialTransactions(propertyId: string, transactions: FinancialTransactionInput[], actor: AuthUser): Promise<FinancialTransaction[]> {
    const results: FinancialTransaction[] = [];
    for (const input of transactions) {
      results.push(await this.createFinancialTransaction({ ...input, propertyId }, actor));
    }
    return results;
  }

  async listPendingTransactions(propertyIds: string[]): Promise<PendingTransaction[]> {
    const state = this.assertState();
    return structuredClone(
      state.pendingTransactions
        .filter((t) => propertyIds.includes(t.propertyId))
        .sort((a, b) => b.createdAt - a.createdAt),
    );
  }

  async createPendingTransaction(input: PendingTransactionInput, _actor: AuthUser): Promise<PendingTransaction> {
    const state = this.assertState();
    const now = Date.now();
    const txn: PendingTransaction = {
      id: `pend_${now}_${Math.random().toString(36).slice(2)}`,
      propertyId: input.propertyId,
      gcsPath: input.gcsPath,
      receiptUrl: input.gcsPath,
      ocrProcessed: input.ocrProcessed ?? false,
      transactionDate: input.transactionDate ?? '',
      debitAccount: input.debitAccount ?? '',
      debitAmount: input.debitAmount ?? 0,
      creditAccount: input.creditAccount ?? '普通預金',
      creditAmount: input.creditAmount ?? 0,
      description: input.description ?? '',
      vendor: input.vendor,
      sourceRef: input.sourceRef,
      createdAt: now,
      updatedAt: now,
    };
    state.pendingTransactions.push(txn);
    return structuredClone(txn);
  }

  async updatePendingTransaction(id: string, input: Partial<PendingTransactionInput>, _actor: AuthUser): Promise<PendingTransaction> {
    const state = this.assertState();
    const idx = state.pendingTransactions.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error('Pending transaction not found');
    const updated: PendingTransaction = {
      ...state.pendingTransactions[idx],
      ...Object.fromEntries(
        Object.entries({
          propertyId: input.propertyId,
          gcsPath: input.gcsPath,
          receiptUrl: input.gcsPath,
          transactionDate: input.transactionDate,
          debitAccount: input.debitAccount,
          debitAmount: input.debitAmount,
          creditAccount: input.creditAccount,
          creditAmount: input.creditAmount,
          description: input.description,
          vendor: input.vendor,
          ocrProcessed: input.ocrProcessed,
        }).filter(([, v]) => v !== undefined),
      ),
      updatedAt: Date.now(),
    };
    state.pendingTransactions[idx] = updated;
    return structuredClone(updated);
  }

  async approvePendingTransaction(id: string, actor: AuthUser): Promise<FinancialTransaction> {
    const state = this.assertState();
    const pending = state.pendingTransactions.find((t) => t.id === id);
    if (!pending) throw new Error('Pending transaction not found');
    const txn = await this.createFinancialTransaction({
      propertyId: pending.propertyId,
      transactionNo: '',
      transactionDate: pending.transactionDate,
      debitAccount: pending.debitAccount,
      debitAmount: pending.debitAmount,
      creditAccount: pending.creditAccount,
      creditAmount: pending.creditAmount,
      description: pending.description,
      receiptUrl: pending.gcsPath,
      sourceRef: pending.sourceRef,
    }, actor);
    state.pendingTransactions = state.pendingTransactions.filter((t) => t.id !== id);
    return txn;
  }

  async deletePendingTransaction(id: string, _actor: AuthUser): Promise<PendingTransaction | null> {
    const state = this.assertState();
    const found = state.pendingTransactions.find((t) => t.id === id) ?? null;
    state.pendingTransactions = state.pendingTransactions.filter((t) => t.id !== id);
    return found ? structuredClone(found) : null;
  }

  async hasFinanceSourceRef(sourceRef: string): Promise<boolean> {
    const state = this.assertState();
    return state.pendingTransactions.some((t) => t.sourceRef === sourceRef)
      || state.financialTransactions.some((t) => t.sourceRef === sourceRef);
  }

  async listIngestRules(): Promise<IngestRule[]> {
    const state = this.assertState();
    return structuredClone(state.ingestRules.slice().sort((a, b) => a.email.localeCompare(b.email)));
  }

  async upsertIngestRule(email: string, propertyId: string, _actor: AuthUser): Promise<IngestRule> {
    const state = this.assertState();
    const normalized = email.trim().toLowerCase();
    const now = Date.now();
    const existing = state.ingestRules.find((r) => r.email === normalized);
    if (existing) {
      existing.propertyId = propertyId;
      existing.updatedAt = now;
      return structuredClone(existing);
    }
    const rule: IngestRule = { email: normalized, propertyId, createdAt: now, updatedAt: now };
    state.ingestRules.push(rule);
    return structuredClone(rule);
  }

  async deleteIngestRule(email: string, _actor: AuthUser): Promise<boolean> {
    const state = this.assertState();
    const normalized = email.trim().toLowerCase();
    const before = state.ingestRules.length;
    state.ingestRules = state.ingestRules.filter((r) => r.email !== normalized);
    return state.ingestRules.length < before;
  }
}
