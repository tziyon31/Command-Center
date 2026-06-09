export const CONSTRUCTION_STATUS_NOT_UPDATED = 'not_updated';

export const CONSTRUCTION_STATUS_OPTIONS = [
  { value: 'licensing_and_permit_process', label: 'רישוי וקבלת היתר' },
  { value: 'building_permit_received', label: 'היתר בניה' },
  { value: 'execution_excavation_and_shoring', label: 'ביצוע - חפירה ודיפון' },
  { value: 'execution_walls_and_ceilings', label: 'ביצוע - קירות ותקרות' },
  { value: 'execution_commissioning_and_activation', label: 'ביצוע - הרצה והפעלה' },
  { value: 'delivered_to_client', label: 'מסירה ללקוח' },
];

const CONSTRUCTION_STATUS_SET = new Set([
  CONSTRUCTION_STATUS_NOT_UPDATED,
  ...CONSTRUCTION_STATUS_OPTIONS.map((option) => option.value),
]);

export const CONSTRUCTION_STATUS_LABELS = {
  [CONSTRUCTION_STATUS_NOT_UPDATED]: 'לא עודכן',
  ...Object.fromEntries(
    CONSTRUCTION_STATUS_OPTIONS.map((option) => [option.value, option.label]),
  ),
};

export function normalizeConstructionStatus(status) {
  const normalized = String(status || '').trim();
  return CONSTRUCTION_STATUS_SET.has(normalized)
    ? normalized
    : CONSTRUCTION_STATUS_NOT_UPDATED;
}

export function getConstructionStatusLabel(status) {
  const normalized = normalizeConstructionStatus(status);
  return CONSTRUCTION_STATUS_LABELS[normalized] || CONSTRUCTION_STATUS_LABELS[CONSTRUCTION_STATUS_NOT_UPDATED];
}

export function getConstructionStatusProgress(status) {
  const normalized = normalizeConstructionStatus(status);
  const milestones = CONSTRUCTION_STATUS_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  if (normalized === CONSTRUCTION_STATUS_NOT_UPDATED) {
    return {
      isUpdated: false,
      currentStatus: CONSTRUCTION_STATUS_NOT_UPDATED,
      currentIndex: -1,
      milestones,
    };
  }

  const currentIndex = milestones.findIndex((milestone) => milestone.value === normalized);

  return {
    isUpdated: true,
    currentStatus: normalized,
    currentIndex: currentIndex >= 0 ? currentIndex : -1,
    milestones,
  };
}
