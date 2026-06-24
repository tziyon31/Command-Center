import { snakeToCamel } from './serialize.js';

function parseFilterValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && '$in' in value) {
    return { in: value.$in };
  }
  return value;
}

export function buildWhereFromFilters(filters) {
  const where = {};

  for (const [rawKey, rawValue] of Object.entries(filters ?? {})) {
    const key = snakeToCamel(rawKey);
    where[key] = parseFilterValue(rawValue);
  }

  return where;
}

export function buildOrderBy(sortParam) {
  if (!sortParam) return { createdAt: 'desc' };

  const fields = String(sortParam)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (fields.length === 0) return { createdAt: 'desc' };

  return fields.map((field) => {
    const desc = field.startsWith('-');
    const raw = desc ? field.slice(1) : field;
    const prismaField = snakeToCamel(raw === 'created_date' ? 'created_at' : raw === 'updated_date' ? 'updated_at' : raw);
    return { [prismaField]: desc ? 'desc' : 'asc' };
  });
}
