import { Prisma } from '@prisma/client';

// Map each Prisma delegate name (e.g. "signedProposal") to the set of writable
// scalar/enum field names on that model. The legacy SDK silently ignored unknown
// fields on create/update; Prisma instead throws "Unknown argument" and returns a
// 500. Whitelisting real columns restores that lenient behavior so extra client
// payload keys are dropped instead of crashing the request.
const buildFieldMap = () => {
  const map = new Map();

  for (const model of Prisma.dmmf.datamodel.models) {
    const scalarFields = new Set(
      model.fields
        .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
        .map((field) => field.name),
    );
    const delegateName = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    map.set(delegateName, scalarFields);
  }

  return map;
};

const FIELD_MAP = buildFieldMap();

export function getModelScalarFields(delegateName) {
  return FIELD_MAP.get(delegateName) ?? null;
}
