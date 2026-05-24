import { base44 } from '@/api/base44Client';

export const INQUIRY_DELETE_CONFIRM_MESSAGE =
  'האם אתה בטוח שברצונך למחוק את הפנייה? פעולה זו לא ניתנת לשחזור.';

/**
 * Deletes an inquiry. Uses hard delete when the SDK supports it; otherwise soft-deletes.
 * @returns {'hard' | 'soft'}
 */
export async function deleteInquiry(inquiryId) {
  const inquiryEntity = base44.entities.Inquiry;

  if (typeof inquiryEntity.delete === 'function') {
    await inquiryEntity.delete(inquiryId);
    return 'hard';
  }

  await inquiryEntity.update(inquiryId, { form_status: 'cancelled' });
  return 'soft';
}

export const isInquiryVisibleInList = (inquiry) => inquiry?.form_status !== 'cancelled';

/** Secondary destructive style — white background, red text and border. */
export const INQUIRY_DELETE_BUTTON_CLASS =
  'bg-white text-destructive border border-destructive hover:bg-red-50 hover:text-destructive hover:border-destructive';
