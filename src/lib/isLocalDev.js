export function isLocalDevEnvironment() {
  if (typeof window === 'undefined') return false;

  return (
    import.meta.env.DEV
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
  );
}
