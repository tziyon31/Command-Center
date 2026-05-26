import { base44 } from '@/api/base44Client';
import { cancelRemindersForDeletedSource } from '@/lib/reminderEngine';

export const PROJECT_DELETE_CONFIRM_MESSAGE =
  'האם אתה בטוח שברצונך למחוק את הפרויקט? פעולה זו לא ניתנת לשחזור.';

export const PROJECT_DELETE_BUTTON_CLASS =
  'bg-white text-destructive border border-destructive hover:bg-red-50 hover:text-destructive hover:border-destructive';

export async function deleteProject(projectId) {
  const projectEntity = base44.entities.Project;

  if (typeof projectEntity.delete === 'function') {
    await projectEntity.delete(projectId);
    await cancelRemindersForDeletedSource('project', projectId);
    return 'hard';
  }

  await projectEntity.update(projectId, { status: 'cancelled' });
  await cancelRemindersForDeletedSource('project', projectId);
  return 'soft';
}
