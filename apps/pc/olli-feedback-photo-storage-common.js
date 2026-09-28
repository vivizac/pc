(function initOlliFeedbackPhotoStorage(global) {
  'use strict';

  const FUNCTION_NAME = 'olli-feedback-photo-storage';
  const BUCKET = 'student_feedback_photos';
  const DEFAULT_READ_TTL = 900;
  const signedReadCache = new Map();

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function getSessionToken() {
    const token = clean(localStorage.getItem('olli_account_session_token_v1'));
    if (!token) {
      const error = new Error('계정 세션이 없어 수업사진 보안 저장소를 사용할 수 없습니다.');
      error.code = 'NO_ACCOUNT_SESSION';
      throw error;
    }
    return token;
  }

  function getSupabaseBaseUrl() {
    const lexicalUrl = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '';
    const url = clean(lexicalUrl || global.SUPABASE_URL || '');
    if (!url) {
      const error = new Error('Supabase 연결 주소가 없습니다.');
      error.code = 'SUPABASE_URL_MISSING';
      throw error;
    }
    return url.replace(/\/$/, '');
  }

  function getPublishableKey() {
    const lexicalKey = typeof SUPABASE_KEY !== 'undefined' ? SUPABASE_KEY : '';
    return clean(lexicalKey || global.SUPABASE_KEY || '');
  }

  async function callSigningService(action, payload = {}) {
    const url = `${getSupabaseBaseUrl()}/functions/v1/${FUNCTION_NAME}`;
    const key = getPublishableKey();
    const headers = { 'Content-Type': 'application/json' };
    if (key) {
      headers.apikey = key;
      headers.Authorization = `Bearer ${key}`;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action,
        session_token: getSessionToken(),
        ...payload
      })
    });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data || data.ok !== true) {
      const error = new Error(data?.message || `수업사진 보안 URL 요청에 실패했습니다. (${response.status})`);
      error.code = clean(data?.code || 'PHOTO_STORAGE_SIGNING_FAILED');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function requestSignedUpload({ academyId, objectPath, contentType = 'image/jpeg' } = {}) {
    const safeAcademyId = clean(academyId);
    const safeObjectPath = clean(objectPath);
    if (!safeAcademyId || !safeObjectPath) {
      const error = new Error('수업사진 업로드 식별값이 없습니다.');
      error.code = 'PHOTO_UPLOAD_IDENTITY_MISSING';
      throw error;
    }
    return callSigningService('sign-upload', {
      academy_id: safeAcademyId,
      object_path: safeObjectPath,
      content_type: clean(contentType || 'image/jpeg')
    });
  }

  async function uploadSignedFile({ academyId, bucket = BUCKET, objectPath, file } = {}) {
    if (clean(bucket) !== BUCKET) {
      const error = new Error('허용되지 않은 수업사진 버킷입니다.');
      error.code = 'PHOTO_BUCKET_NOT_ALLOWED';
      throw error;
    }
    if (!file) {
      const error = new Error('업로드할 수업사진 파일이 없습니다.');
      error.code = 'PHOTO_FILE_MISSING';
      throw error;
    }

    const signed = await requestSignedUpload({
      academyId,
      objectPath,
      contentType: file.type || 'image/jpeg'
    });
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    const response = await fetch(signed.signed_url, {
      method: 'PUT',
      headers: { 'x-upsert': 'true' },
      body: form
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      const error = new Error(message || `수업사진 signed upload에 실패했습니다. (${response.status})`);
      error.code = 'PHOTO_SIGNED_UPLOAD_FAILED';
      error.status = response.status;
      throw error;
    }
    return {
      bucket: BUCKET,
      path: clean(signed.path || objectPath),
      expiresIn: Number(signed.expires_in || 7200)
    };
  }

  async function getSignedPhotoUrls({ academyId, photoId, expiresIn = DEFAULT_READ_TTL, force = false } = {}) {
    const safeAcademyId = clean(academyId);
    const safePhotoId = clean(photoId);
    if (!safeAcademyId || !safePhotoId) {
      const error = new Error('수업사진 조회 식별값이 없습니다.');
      error.code = 'PHOTO_READ_IDENTITY_MISSING';
      throw error;
    }

    const cacheKey = `${safeAcademyId}:${safePhotoId}`;
    const cached = signedReadCache.get(cacheKey);
    if (!force && cached && Number(cached.expiresAtMs || 0) > Date.now() + 60000) {
      return { ...cached.value };
    }

    const data = await callSigningService('sign-read', {
      academy_id: safeAcademyId,
      photo_id: safePhotoId,
      expires_in: Number(expiresIn || DEFAULT_READ_TTL)
    });
    const value = {
      photoId: safePhotoId,
      imagePath: clean(data.image_path),
      thumbnailPath: clean(data.thumbnail_path),
      imageUrl: clean(data.image_url),
      thumbnailUrl: clean(data.thumbnail_url),
      expiresAt: clean(data.expires_at),
      expiresIn: Number(data.expires_in || DEFAULT_READ_TTL)
    };
    const expiresAtMs = Date.parse(value.expiresAt) || (Date.now() + value.expiresIn * 1000);
    signedReadCache.set(cacheKey, { value, expiresAtMs });
    return { ...value };
  }

  function clearSignedPhotoUrlCache(photoId = '') {
    const safePhotoId = clean(photoId);
    if (!safePhotoId) {
      signedReadCache.clear();
      return;
    }
    for (const key of signedReadCache.keys()) {
      if (key.endsWith(`:${safePhotoId}`)) signedReadCache.delete(key);
    }
  }

  global.OlliFeedbackPhotoStorage = {
    bucket: BUCKET,
    requestSignedUpload,
    uploadSignedFile,
    getSignedPhotoUrls,
    clearSignedPhotoUrlCache
  };
})(window);
