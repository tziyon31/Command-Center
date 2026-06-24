const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'auth_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.error || response.statusText || 'Request failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

const ENTITY_PATHS = {
  User: 'users',
  Client: 'clients',
  Inquiry: 'inquiries',
  Project: 'projects',
  Proposal: 'proposals',
  SignedProposal: 'signed_proposals',
  WorkStage: 'work_stages',
  InvoiceProcess: 'invoice_processes',
  Invoice: 'invoices',
  CollectionDue: 'collection_dues',
  CollectionEvent: 'collection_events',
  Reminder: 'reminders',
  ReminderSettings: 'reminder_settings',
  Task: 'tasks',
  Quote: 'quotes',
  Document: 'documents',
  Conversation: 'conversations',
};

function createEntityApi(entityName) {
  const basePath = `/api/entities/${ENTITY_PATHS[entityName]}`;

  return {
    async list(sort) {
      const params = new URLSearchParams();
      if (sort) params.set('sort', sort);
      const query = params.toString();
      return apiFetch(`${basePath}${query ? `?${query}` : ''}`);
    },

    async filter(filters, sort) {
      const params = new URLSearchParams();
      params.set('filter', JSON.stringify(filters ?? {}));
      if (sort) params.set('sort', sort);
      return apiFetch(`${basePath}?${params.toString()}`);
    },

    async create(data) {
      return apiFetch(basePath, { method: 'POST', body: JSON.stringify(data) });
    },

    async update(id, data) {
      return apiFetch(`${basePath}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },

    async delete(id) {
      return apiFetch(`${basePath}/${id}`, { method: 'DELETE' });
    },

    async bulkCreate(items) {
      return apiFetch(`${basePath}/bulk`, { method: 'POST', body: JSON.stringify(items) });
    },
  };
}

const entities = Object.fromEntries(
  Object.keys(ENTITY_PATHS).map((name) => [name, createEntityApi(name)]),
);

export const api = {
  entities,
  auth: {
    async me() {
      return apiFetch('/api/auth/me');
    },
    logout(_redirectUrl) {
      setToken(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/Login';
      }
    },
    redirectToLogin(_returnUrl) {
      if (typeof window !== 'undefined') {
        window.location.href = '/Login';
      }
    },
    async login(email, password) {
      const result = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(result.token);
      return result;
    },
  },
  users: {
    async inviteUser(email, role) {
      return apiFetch('/api/auth/invite', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
    },
  },
  integrations: {
    Core: {
      async UploadFile() {
        throw new Error('File upload is not available yet');
      },
      async ExtractDataFromUploadedFile() {
        throw new Error('File extract is not available yet');
      },
    },
  },
  agents: null,
};

export { getToken, setToken };
