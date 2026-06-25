const CAMEL_OVERRIDES = {
  password_hash: 'passwordHash',
};

const SNAKE_OVERRIDES = {
  passwordHash: 'password_hash',
};

export function snakeToCamel(key) {
  if (CAMEL_OVERRIDES[key]) return CAMEL_OVERRIDES[key];
  return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

export function camelToSnake(key) {
  if (SNAKE_OVERRIDES[key]) return SNAKE_OVERRIDES[key];
  return key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function serializeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return value;
  return value;
}

export function toApiRecord(record, { omit = [] } = {}) {
  if (!record) return record;

  const omitted = new Set([...omit, 'passwordHash']);
  const result = { id: record.id };

  for (const [key, value] of Object.entries(record)) {
    if (key === 'id' || omitted.has(key)) continue;
    if (key === 'createdAt') {
      result.created_date = serializeValue(value);
      continue;
    }
    if (key === 'updatedAt') {
      result.updated_date = serializeValue(value);
      continue;
    }
    result[camelToSnake(key)] = serializeValue(value);
  }

  return result;
}

// snake_case fields mapped to Postgres `uuid` columns. The legacy SDK accepted
// empty strings to mean "no value"; Postgres rejects '' as invalid uuid syntax,
// so we coerce blank uuid inputs to null before they reach Prisma.
const UUID_FIELDS = new Set([
  'client_id',
  'project_id',
  'source_inquiry_id',
  'source_signed_proposal_id',
  'signed_proposal_id',
  'collection_due_id',
  'invoice_process_id',
  'source_entity_id',
  'assigned_to_user_id',
  'user_id',
]);

const coerceFieldValue = (snakeKey, value) => {
  if (UUID_FIELDS.has(snakeKey) && typeof value === 'string' && value.trim() === '') {
    return null;
  }
  return value;
};

export function toDbData(body, { omit = [] } = {}) {
  const omitted = new Set([
    ...omit,
    'id',
    'created_date',
    'updated_date',
    'created_at',
    'updated_at',
    'password_hash',
  ]);

  const data = {};

  for (const [key, value] of Object.entries(body ?? {})) {
    if (omitted.has(key)) continue;
    data[snakeToCamel(key)] = coerceFieldValue(key, value);
  }

  return data;
}

export function toUserResponse(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
    phone: user.phone,
    position: user.position,
  };
}
