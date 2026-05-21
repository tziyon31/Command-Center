export const toDatetimeLocalValue = (value) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (part) => String(part).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const getDefaultFutureDatetimeValue = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(7, 0, 0, 0);
  return toDatetimeLocalValue(date);
};

export const datetimeLocalToIso = (value) => new Date(value).toISOString();

export const isFutureDatetimeLocal = (value) => {
  if (!value) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  return date.getTime() > Date.now();
};
