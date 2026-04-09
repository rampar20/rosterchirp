const BASE = '/api';

function getToken() {
  return localStorage.getItem('tc_token') || sessionStorage.getItem('tc_token');
}

// SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" with no timezone marker.
// Browsers parse bare strings like this as LOCAL time, but the value is actually UTC.
// Appending 'Z' forces correct UTC interpretation so local display is always right.
export function parseTS(ts) {
  if (!ts) return new Date(NaN);
  // Already has timezone info (contains T and Z/+ or ends in Z) — leave alone
  if (/Z$|[+-]\d{2}:\d{2}$/.test(ts) || (ts.includes('T') && ts.includes('Z'))) return new Date(ts);
  // Replace the space separator SQLite uses and append Z
  return new Date(ts.replace(' ', 'T') + 'Z');
}

async function req(method, path, body, opts = {}) {
  const token = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  let fetchOpts = { method, headers };
  
  if (body instanceof FormData) {
    fetchOpts.body = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(body);
  }

  const res = await fetch(BASE + path, fetchOpts);
  const data = await res.json();
  if (!res.ok) {
    // Session displaced by a new login elsewhere — force logout
    if (res.status === 401 && data.error?.includes('Session expired')) {
      localStorage.removeItem('tc_token');
      sessionStorage.removeItem('tc_token');
      window.dispatchEvent(new CustomEvent('rosterchirp:session-displaced'));
    }
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export const api = {
  // Auth
  login: (body) => req('POST', '/auth/login', body),
  submitSupport: (body) => req('POST', '/auth/support', body),
  logout: () => req('POST', '/auth/logout'),
  me: () => req('GET', '/auth/me'),
  changePassword: (body) => req('POST', '/auth/change-password', body),
  
  // Users
  getUsers: () => req('GET', '/users'),
  searchUsers: (q, groupId) => req('GET', `/users/search?q=${encodeURIComponent(q)}${groupId ? `&groupId=${groupId}` : ''}`),
  createUser: (body) => req('POST', '/users', body),
  updateUser: (id, body) => req('PATCH', `/users/${id}`, body),
  bulkUsers: (users) => req('POST', '/users/bulk', { users }),
  updateName: (id, name) => req('PATCH', `/users/${id}/name`, { name }),
  updateRole: (id, role) => req('PATCH', `/users/${id}/role`, { role }),
  resetPassword: (id, password) => req('PATCH', `/users/${id}/reset-password`, { password }),
  suspendUser: (id) => req('PATCH', `/users/${id}/suspend`),
  activateUser: (id) => req('PATCH', `/users/${id}/activate`),
  deleteUser: (id) => req('DELETE', `/users/${id}`),
  checkDisplayName: (name) => req('GET', `/users/check-display-name?name=${encodeURIComponent(name)}`),
  updateProfile: (body) => req('PATCH', '/users/me/profile', body), // body: { displayName, aboutMe, hideAdminTag, allowDm }
  uploadAvatar: (file) => {
    const form = new FormData(); form.append('avatar', file);
    return req('POST', '/users/me/avatar', form);
  },
  searchMinorUsers: (q) => req('GET', `/users/search-minors?q=${encodeURIComponent(q || '')}`),
  getMinorPlayers: () => req('GET', '/users/minor-players'),
  addGuardianChild: (minorId, dateOfBirth) => req('POST', `/users/me/guardian-children/${minorId}`, { dateOfBirth: dateOfBirth || null }),
  removeGuardianChild: (minorId) => req('DELETE', `/users/me/guardian-children/${minorId}`),
  approveGuardian: (id) => req('PATCH', `/users/${id}/approve-guardian`),
  denyGuardian: (id) => req('PATCH', `/users/${id}/deny-guardian`),
  linkMinor: (minorId) => req('PATCH', `/users/me/link-minor/${minorId}`),
  // Guardian aliases
  getAliases: () => req('GET', '/users/me/aliases'),
  getAllAliases: () => req('GET', '/users/aliases-all'),
  createAlias: (body) => req('POST', '/users/me/aliases', body),
  updateAlias: (id, body) => req('PATCH', `/users/me/aliases/${id}`, body),
  deleteAlias: (id) => req('DELETE', `/users/me/aliases/${id}`),
  uploadAliasAvatar: (aliasId, file) => {
    const form = new FormData(); form.append('avatar', file);
    return req('POST', `/users/me/aliases/${aliasId}/avatar`, form);
  },
  // Spouse/Partner
  getPartner: () => req('GET', '/users/me/partner'),
  setPartner: (partnerId, respondSeparately = false) => req('POST', '/users/me/partner', { partnerId, respondSeparately }),
  updatePartnerRespondSeparately: (respondSeparately) => req('PATCH', '/users/me/partner', { respondSeparately }),
  removePartner: () => req('DELETE', '/users/me/partner'),

  // Groups
  getGroups: () => req('GET', '/groups'),
  createGroup: (body) => req('POST', '/groups', body),
  renameGroup: (id, name) => req('PATCH', `/groups/${id}/rename`, { name }),
  setCustomGroupName: (id, name) => req('PATCH', `/groups/${id}/custom-name`, { name }),
  getHelp: () => req('GET', '/help'),
  getHelpStatus: () => req('GET', '/help/status'),
  dismissHelp: (dismissed) => req('POST', '/help/dismiss', { dismissed }),
  getMembers: (id) => req('GET', `/groups/${id}/members`),
  addMember: (groupId, userId) => req('POST', `/groups/${groupId}/members`, { userId }),
  removeMember: (groupId, userId) => req('DELETE', `/groups/${groupId}/members/${userId}`),
  leaveGroup: (id) => req('DELETE', `/groups/${id}/leave`),
  takeOwnership: (id) => req('POST', `/groups/${id}/take-ownership`),
  deleteGroup: (id) => req('DELETE', `/groups/${id}`),

  // Messages
  getMessages: (groupId, before) => req('GET', `/messages/group/${groupId}${before ? `?before=${before}` : ''}`),
  sendMessage: (groupId, body) => req('POST', `/messages/group/${groupId}`, body),
  uploadImage: (groupId, file, extra = {}) => {
    const form = new FormData();
    form.append('image', file);
    if (extra.replyToId) form.append('replyToId', extra.replyToId);
    if (extra.content) form.append('content', extra.content);
    return req('POST', `/messages/group/${groupId}/image`, form);
  },
  deleteMessage: (id) => req('DELETE', `/messages/${id}`),
  toggleReaction: (id, emoji) => req('POST', `/messages/${id}/reactions`, { emoji }),

  // Settings
  getSettings: () => req('GET', '/settings'),
  updateAppName: (name) => req('PATCH', '/settings/app-name', { name }),
  updateColors: (body) => req('PATCH', '/settings/colors', body),
  registerCode: (code) => req('POST', '/settings/register', { code }),
  updateTeamSettings: (body) => req('PATCH', '/settings/team', body),
  updateMessageSettings: (body) => req('PATCH', '/settings/messages', body),
  updateLoginType: (body) => req('PATCH', '/settings/login-type', body),

  // Schedule Manager
  getMyScheduleGroups: () => req('GET', '/schedule/my-groups'),
  getEventTypes: () => req('GET', '/schedule/event-types'),
  createEventType: (body) => req('POST', '/schedule/event-types', body),
  updateEventType: (id, body) => req('PATCH', `/schedule/event-types/${id}`, body),
  deleteEventType: (id) => req('DELETE', `/schedule/event-types/${id}`),
  getEvents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req('GET', `/schedule${qs ? '?' + qs : ''}`);
  },
  getEvent: (id) => req('GET', `/schedule/${id}`),
  createEvent: (body) => req('POST', '/schedule', body), // body may include recurrenceRule: {freq,interval,byDay,ends,endDate,endCount}
  updateEvent: (id, body) => req('PATCH', `/schedule/${id}`, body),
  deleteEvent: (id, scope = 'this', occurrenceStart = null) => req('DELETE', `/schedule/${id}`, { recurringScope: scope, occurrenceStart }),
  setAvailability: (id, response, note, aliasId, forPartnerId) => req('PUT', `/schedule/${id}/availability`, { response, note, ...(aliasId ? { aliasId } : {}), ...(forPartnerId ? { forPartnerId } : {}) }),
  setAvailabilityNote: (id, note) => req('PATCH', `/schedule/${id}/availability/note`, { note }),
  deleteAvailability: (id, aliasId, forPartnerId) => req('DELETE', `/schedule/${id}/availability${aliasId ? `?aliasId=${aliasId}` : forPartnerId ? `?forPartnerId=${forPartnerId}` : ''}`),
  getPendingAvailability: () => req('GET', '/schedule/me/pending'),
  bulkAvailability: (responses) => req('POST', '/schedule/me/bulk-availability', { responses }),
  importPreview: (file) => {
    const fd = new FormData(); fd.append('file', file);
    return fetch('/api/schedule/import/preview', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('tc_token') }, body: fd }).then(r => r.json());
  },
  importConfirm: (rows) => req('POST', '/schedule/import/confirm', { rows }),

  // User groups (Group Manager)
  getMyUserGroups: () => req('GET', '/usergroups/me'),
  getUserGroups: () => req('GET', '/usergroups'),
  getUserGroup: (id) => req('GET', `/usergroups/${id}`),
  getUserGroupsForUser: (userId) => req('GET', `/usergroups/byuser/${userId}`),
  createUserGroup: (body) => req('POST', '/usergroups', body),
  updateUserGroup: (id, body) => req('PATCH', `/usergroups/${id}`, body),
  deleteUserGroup: (id) => req('DELETE', `/usergroups/${id}`),
  addUserToGroup: (groupId, userId) => req('POST', `/usergroups/${groupId}/members/${userId}`, {}),
  removeUserFromGroup: (groupId, userId) => req('DELETE', `/usergroups/${groupId}/members/${userId}`),
  removeUserGroupMember: (groupId, userId) => req('DELETE', `/usergroups/${groupId}/members/${userId}`),
  // Multi-group DMs
  getMultiGroupDms: () => req('GET', '/usergroups/multigroup'),
  createMultiGroupDm: (body) => req('POST', '/usergroups/multigroup', body),
  updateMultiGroupDm: (id, body) => req('PATCH', `/usergroups/multigroup/${id}`, body),
  deleteMultiGroupDm: (id) => req('DELETE', `/usergroups/multigroup/${id}`),
  // U2U Restrictions
  getGroupRestrictions: (id) => req('GET', `/usergroups/${id}/restrictions`),
  setGroupRestrictions: (id, blockedGroupIds) => req('PUT', `/usergroups/${id}/restrictions`, { blockedGroupIds }),
  uploadLogo: (file) => {
    const form = new FormData(); form.append('logo', file);
    return req('POST', '/settings/logo', form);
  },
  uploadIconNewChat: (file) => {
    const form = new FormData(); form.append('icon', file);
    return req('POST', '/settings/icon-newchat', form);
  },
  uploadIconGroupInfo: (file) => {
    const form = new FormData(); form.append('icon', file);
    return req('POST', '/settings/icon-groupinfo', form);
  },
  resetSettings: () => req('POST', '/settings/reset'),

  // Push notifications (FCM)
  getFirebaseConfig: () => req('GET', '/push/firebase-config'),
  getVapidPublicKey: () => req('GET', '/push/vapid-public-key'),
  subscribePush: (fcmToken) => req('POST', '/push/subscribe', { fcmToken }),
  subscribeWebPush: (subscription) => req('POST', '/push/subscribe-webpush', subscription),
  unsubscribePush: () => req('POST', '/push/unsubscribe'),
  testPush: (mode = 'notification') => req('POST', `/push/test?mode=${mode}`),
  pushDebug: () => req('GET', '/push/debug'),

  // Link preview
  getLinkPreview: (url) => req('GET', `/link-preview?url=${encodeURIComponent(url)}`),
};
