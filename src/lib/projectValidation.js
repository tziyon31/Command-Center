export function assertProjectHasClientId(clientId) {
  if (!String(clientId || '').trim()) {
    alert('יש לשייך לקוח לפני שמירת פרויקט');
    return false;
  }

  return true;
}
