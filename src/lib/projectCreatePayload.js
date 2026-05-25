export const buildProjectCreatePayloadFromForm = (formData, { sourceInquiryId, formStatus = 'draft' } = {}) => {
  const payload = {
    client_id: formData.client_id || '',
    bid_number: String(formData.bid_number || '').trim(),
    work_number: String(formData.work_number || '').trim(),
    name: String(formData.name || '').trim(),
    city: String(formData.city || '').trim(),
    project_type: String(formData.project_type || '').trim(),
    area: String(formData.area || '').trim(),
    description: String(formData.description || '').trim(),
    status: formData.status || 'pricing',
    total_amount: Number(formData.total_amount) || 0,
    year: Number(formData.year) || new Date().getFullYear(),
    notes: String(formData.notes || '').trim(),
    form_status: formStatus,
    collected_amount: 0,
  };

  const inquiryId = formData.source_inquiry_id?.trim() || sourceInquiryId?.trim();
  if (inquiryId) {
    payload.source_inquiry_id = inquiryId;
  }

  return payload;
};
