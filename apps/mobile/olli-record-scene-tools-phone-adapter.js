/* Phone-only compatibility: keep the existing feedback archive date formatter used by the phone observation UI. */
if (typeof formatMemoFeedbackArchiveDate === 'function') {
  formatMemoUpdatedDate = formatMemoFeedbackArchiveDate;
}
