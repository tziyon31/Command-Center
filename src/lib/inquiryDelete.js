import { base44 } from '@/api/base44Client';
import { cancelRemindersForDeletedSource } from '@/lib/reminderEngine';

export const INQUIRY_DELETE_CONFIRM_MESSAGE =
  'האם אתה בטוח שברצונך למחוק את הפנייה? פעולה זו לא ניתנת לשחזור.';

/**
 * Deletes an inquiry. Uses hard delete when the SDK supports it; otherwise soft-deletes.
 * @returns {'hard' | 'soft'}
 */
export async function deleteInquiry(inquiryId) {
  const inquiryEntity = base44.entities.Inquiry;
  let deleteMode = 'soft';

  if (typeof inquiryEntity.delete === 'function') {
    await inquiryEntity.delete(inquiryId);
    deleteMode = 'hard';
  } else {
    await inquiryEntity.update(inquiryId, { form_status: 'cancelled' });
  }

  try {
    await cancelRemindersForDeletedSource('inquiry', inquiryId);
  } catch (error) {
    console.error('[Inquiry] deleted but failed to cancel related reminders', error);
  }

  return deleteMode;
}

export const isInquiryVisibleInList = (inquiry) => inquiry?.form_status !== 'cancelled';
