import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { resolveEntity } from '../lib/entityRegistry.js';
import { buildOrderBy, buildWhereFromFilters } from '../lib/filters.js';
import { toApiRecord, toDbData } from '../lib/serialize.js';

const router = Router();

// Forwards rejected promises to the Express error middleware so a failed query
// returns a clean 500 instead of an unhandled rejection that drops the socket.
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function getDelegate(entityName) {
  const config = resolveEntity(entityName);
  if (!config) return null;
  return { config, delegate: prisma[config.model] };
}

function parseFilterQuery(filterParam) {
  if (!filterParam) return {};
  if (typeof filterParam === 'object') return filterParam;
  try {
    return JSON.parse(filterParam);
  } catch {
    return {};
  }
}

router.get('/:entityName', asyncHandler(async (req, res) => {
  const resolved = getDelegate(req.params.entityName);
  if (!resolved) return res.status(404).json({ error: 'Unknown entity' });

  const limit = Math.min(Number(req.query.limit) || 5000, 5000);
  const skip = Number(req.query.skip) || 0;
  const where = buildWhereFromFilters(parseFilterQuery(req.query.filter));
  const orderBy = buildOrderBy(req.query.sort);

  const items = await resolved.delegate.findMany({ where, orderBy, take: limit, skip });
  res.json(items.map((item) => toApiRecord(item, { omit: resolved.config.sensitive ?? [] })));
}));

router.get('/:entityName/:id', asyncHandler(async (req, res) => {
  const resolved = getDelegate(req.params.entityName);
  if (!resolved) return res.status(404).json({ error: 'Unknown entity' });

  const item = await resolved.delegate.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: 'Not found' });

  res.json(toApiRecord(item, { omit: resolved.config.sensitive ?? [] }));
}));

router.post('/:entityName/bulk', asyncHandler(async (req, res) => {
  if (req.params.entityName !== 'clients') {
    return res.status(404).json({ error: 'Bulk create not supported for this entity' });
  }

  const rows = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Expected array body' });
  }

  const created = await prisma.$transaction(
    rows.map((row) => prisma.client.create({ data: toDbData(row) })),
  );

  res.status(201).json(created.map((item) => toApiRecord(item)));
}));

router.post('/:entityName', asyncHandler(async (req, res) => {
  const resolved = getDelegate(req.params.entityName);
  if (!resolved) return res.status(404).json({ error: 'Unknown entity' });

  const data = toDbData(req.body, { omit: resolved.config.sensitive ?? [] });
  const item = await resolved.delegate.create({ data });
  res.status(201).json(toApiRecord(item, { omit: resolved.config.sensitive ?? [] }));
}));

router.put('/:entityName/:id', asyncHandler(async (req, res) => {
  const resolved = getDelegate(req.params.entityName);
  if (!resolved) return res.status(404).json({ error: 'Unknown entity' });

  const data = toDbData(req.body, { omit: resolved.config.sensitive ?? [] });
  try {
    const item = await resolved.delegate.update({ where: { id: req.params.id }, data });
    res.json(toApiRecord(item, { omit: resolved.config.sensitive ?? [] }));
  } catch (error) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    throw error;
  }
}));

router.delete('/:entityName/:id', asyncHandler(async (req, res) => {
  const resolved = getDelegate(req.params.entityName);
  if (!resolved) return res.status(404).json({ error: 'Unknown entity' });

  try {
    await resolved.delegate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (error) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    throw error;
  }
}));

export default router;
