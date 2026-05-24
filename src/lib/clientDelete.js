import { base44 } from '@/api/base44Client';

export const CLIENT_DELETE_CONFIRM_MESSAGE =
  'האם אתה בטוח שברצונך למחוק את הלקוח? פעולה זו לא ניתנת לשחזור.';

export const CLIENT_DELETE_BUTTON_CLASS =
  'bg-white text-destructive border border-destructive hover:bg-red-50 hover:text-destructive hover:border-destructive';

export async function deleteClient(clientId) {
  const clientEntity = base44.entities.Client;

  if (typeof clientEntity.delete === 'function') {
    await clientEntity.delete(clientId);
    return 'hard';
  }

  await clientEntity.update(clientId, { status: 'archived' });
  return 'soft';
}
