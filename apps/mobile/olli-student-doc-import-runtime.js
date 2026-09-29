(function(){
  window.openStudentBulkImportFilePicker = function(){
    const input = document.getElementById('studentBulkImportFileInput');
    if (input) input.click();
  };

  window.handleStudentBulkImportFileChange = async function(event){
    const file = event && event.target && event.target.files ? event.target.files[0] : null;
    if (!file) return;
    try {
      let text = '';
      if (typeof isExistingFeedbackDocxFile === 'function' && isExistingFeedbackDocxFile(file)) {
        text = await extractDocxTextForExistingFeedback(file);
      } else if (typeof readFileAsTextForExistingFeedback === 'function') {
        text = await readFileAsTextForExistingFeedback(file);
      } else {
        text = await file.text();
      }
      if (!text || !String(text).trim()) throw new Error('파일에서 읽을 수 있는 텍스트가 없습니다.');
      if (typeof updateStudentBulkImportText === 'function') updateStudentBulkImportText(text);
      const textarea = document.getElementById('studentBulkImportText');
      if (textarea) textarea.value = text;
      if (typeof parseStudentBulkImportText === 'function') parseStudentBulkImportText();
      if (typeof showPushToast === 'function') showPushToast('파일 내용을 읽어 등록 후보를 만들었어요.');
    } catch(err) {
      if (typeof studentBulkImportState !== 'undefined') studentBulkImportState.errorMessage = err.message || String(err);
      if (typeof refreshSettingsAttendancePhotoImportDetail === 'function') refreshSettingsAttendancePhotoImportDetail();
      else alert('파일 읽기 실패\n' + (err.message || err));
    } finally {
      if (event && event.target) event.target.value = '';
    }
  };
})();
