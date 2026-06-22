export const REMINDER_SNOOZE_OPTION_IDS = {
  LATER_TODAY: 'later_today',
  TOMORROW_MORNING: 'tomorrow_morning',
  NEXT_WEEK: 'next_week',
};

const REMINDER_SNOOZE_OPTION_BY_ID = {
  [REMINDER_SNOOZE_OPTION_IDS.LATER_TODAY]: {
    id: REMINDER_SNOOZE_OPTION_IDS.LATER_TODAY,
    label: 'מאוחר יותר היום',
    getSnoozedUntil: () => {
      const date = new Date();
      date.setHours(date.getHours() + 3);
      return date;
    },
  },
  [REMINDER_SNOOZE_OPTION_IDS.TOMORROW_MORNING]: {
    id: REMINDER_SNOOZE_OPTION_IDS.TOMORROW_MORNING,
    label: 'מחר בבוקר',
    getSnoozedUntil: () => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      date.setHours(7, 0, 0, 0);
      return date;
    },
  },
  [REMINDER_SNOOZE_OPTION_IDS.NEXT_WEEK]: {
    id: REMINDER_SNOOZE_OPTION_IDS.NEXT_WEEK,
    label: 'בעוד שבוע',
    getSnoozedUntil: () => {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      return date;
    },
  },
};

const DEFAULT_SNOOZE_OPTION_ORDER = [
  REMINDER_SNOOZE_OPTION_IDS.LATER_TODAY,
  REMINDER_SNOOZE_OPTION_IDS.TOMORROW_MORNING,
  REMINDER_SNOOZE_OPTION_IDS.NEXT_WEEK,
];

const SNOOZE_OPTION_ORDER_BY_FREQUENCY = {
  immediate: [
    REMINDER_SNOOZE_OPTION_IDS.LATER_TODAY,
    REMINDER_SNOOZE_OPTION_IDS.TOMORROW_MORNING,
    REMINDER_SNOOZE_OPTION_IDS.NEXT_WEEK,
  ],
  daily: [
    REMINDER_SNOOZE_OPTION_IDS.TOMORROW_MORNING,
    REMINDER_SNOOZE_OPTION_IDS.LATER_TODAY,
    REMINDER_SNOOZE_OPTION_IDS.NEXT_WEEK,
  ],
  weekly: [
    REMINDER_SNOOZE_OPTION_IDS.NEXT_WEEK,
    REMINDER_SNOOZE_OPTION_IDS.TOMORROW_MORNING,
    REMINDER_SNOOZE_OPTION_IDS.LATER_TODAY,
  ],
  due_date_based: DEFAULT_SNOOZE_OPTION_ORDER,
  custom: DEFAULT_SNOOZE_OPTION_ORDER,
};

export function getSnoozeOptionsForReminder(reminder) {
  const frequency = String(reminder?.frequency || 'daily').trim().toLowerCase();
  const order = SNOOZE_OPTION_ORDER_BY_FREQUENCY[frequency] || DEFAULT_SNOOZE_OPTION_ORDER;

  return order
    .map((optionId) => REMINDER_SNOOZE_OPTION_BY_ID[optionId])
    .filter(Boolean);
}

export function getSnoozedUntilIso(option) {
  return option.getSnoozedUntil().toISOString();
}

export const REMINDER_CUSTOM_SNOOZE_LABEL = 'בחר תאריך ושעה';
