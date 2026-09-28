import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "student_feedback_photos";
const READ_TTL_DEFAULT = 900;
const READ_TTL_MIN = 60;
const READ_TTL_MAX = 1800;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function clean(value: unknown) { return String(value ?? "").trim(); }

function getSecretKey() {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (direct) return direct;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  if (!raw) return "";
  try { return String(JSON.parse(raw).default || ""); } catch { return ""; }
}

function isAcademyPhotoPath(academyId: string, objectPath: string) {
  if (!academyId || !objectPath) return false;
  if (objectPath.includes("..") || objectPath.includes("\\") || objectPath.includes("//")) return false;
  if (!objectPath.startsWith(academyId + "/")) return false;
  const suffix = objectPath.slice(academyId.length + 1);
  return /^\d{4}-\d{2}\/photo_[A-Za-z0-9_-]+\/(image|thumb)\.jpg$/.test(suffix);
}

function normalizeReadTtl(value: unknown) {
  const raw = Number(value || READ_TTL_DEFAULT);
  if (!Number.isFinite(raw)) return READ_TTL_DEFAULT;
  return Math.min(READ_TTL_MAX, Math.max(READ_TTL_MIN, Math.floor(raw)));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = getSecretKey();
  if (!supabaseUrl || !secretKey) {
    return json({ ok: false, code: "SERVER_CONFIG_MISSING", message: "Storage signing configuration is missing." }, 500);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any = {};
  try { body = await req.json(); }
  catch { return json({ ok: false, code: "INVALID_JSON", message: "Invalid JSON body." }, 400); }

  const action = clean(body.action);
  const sessionToken = clean(body.session_token);
  const academyId = clean(body.academy_id);
  if (!sessionToken || !academyId) {
    return json({ ok: false, code: "AUTH_CONTEXT_MISSING", message: "Session and academy are required." }, 400);
  }

  try {
    const accountResult = await admin.rpc("olli_account_id_from_session", { p_session_token: sessionToken });
    if (accountResult.error || !clean(accountResult.data)) {
      return json({ ok: false, code: "SESSION_INVALID", message: "Account session is invalid." }, 401);
    }
    const accountId = clean(accountResult.data);

    const memberResult = await admin.from("academy_members").select("role,status")
      .eq("academy_id", academyId).eq("account_id", accountId).eq("status", "active")
      .in("role", ["owner", "manager", "teacher", "super_admin"]).maybeSingle();
    if (memberResult.error || !memberResult.data) {
      return json({ ok: false, code: "PERMISSION_DENIED", message: "Academy membership is not active." }, 403);
    }

    const academyResult = await admin.from("academies").select("id,status,deleted_at")
      .eq("id", academyId).eq("status", "active").is("deleted_at", null).maybeSingle();
    if (academyResult.error || !academyResult.data) {
      return json({ ok: false, code: "ACADEMY_INACTIVE", message: "Academy is not active." }, 403);
    }

    if (action === "sign-upload") {
      const objectPath = clean(body.object_path);
      const contentType = clean(body.content_type || "image/jpeg").toLowerCase();
      if (!isAcademyPhotoPath(academyId, objectPath)) {
        return json({ ok: false, code: "PHOTO_PATH_ACADEMY_MISMATCH", message: "Invalid photo storage path." }, 400);
      }
      if (contentType !== "image/jpeg") {
        return json({ ok: false, code: "PHOTO_CONTENT_TYPE_INVALID", message: "Only JPEG uploads are allowed." }, 400);
      }
      const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(objectPath, { upsert: true });
      if (signed.error || !signed.data?.token || !signed.data?.signedUrl) throw signed.error || new Error("Signed upload URL was not created.");
      return json({ ok: true, bucket: BUCKET, path: signed.data.path, token: signed.data.token, signed_url: signed.data.signedUrl, expires_in: 7200 });
    }

    if (action === "sign-read") {
      const photoId = clean(body.photo_id);
      if (!photoId) return json({ ok: false, code: "PHOTO_ID_MISSING", message: "Photo id is required." }, 400);
      const photoResult = await admin.from("feedback_photos")
        .select("id,academy_id,image_path,thumbnail_path,is_deleted")
        .eq("academy_id", academyId).eq("id", photoId).eq("is_deleted", false).maybeSingle();
      if (photoResult.error || !photoResult.data) {
        return json({ ok: false, code: "PHOTO_NOT_FOUND", message: "Photo metadata was not found." }, 404);
      }

      const imagePath = clean(photoResult.data.image_path);
      const thumbnailPath = clean(photoResult.data.thumbnail_path);
      if (!isAcademyPhotoPath(academyId, imagePath) || !isAcademyPhotoPath(academyId, thumbnailPath)) {
        return json({ ok: false, code: "PHOTO_PATH_ACADEMY_MISMATCH", message: "Stored photo path is invalid." }, 409);
      }

      const expiresIn = normalizeReadTtl(body.expires_in);
      const signed = await admin.storage.from(BUCKET).createSignedUrls([imagePath, thumbnailPath], expiresIn);
      if (signed.error || !Array.isArray(signed.data) || signed.data.length !== 2) throw signed.error || new Error("Signed read URLs were not created.");
      const imageUrl = clean(signed.data[0]?.signedUrl);
      const thumbnailUrl = clean(signed.data[1]?.signedUrl);
      if (!imageUrl || !thumbnailUrl) return json({ ok: false, code: "PHOTO_SIGN_FAILED", message: "Signed read URL is incomplete." }, 500);

      return json({
        ok: true, photo_id: photoId, image_path: imagePath, thumbnail_path: thumbnailPath,
        image_url: imageUrl, thumbnail_url: thumbnailUrl, expires_in: expiresIn,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString()
      });
    }

    return json({ ok: false, code: "ACTION_NOT_ALLOWED", message: "Unsupported storage signing action." }, 400);
  } catch (error: any) {
    console.error("OLLI feedback photo storage signing failed", error?.message || error);
    return json({ ok: false, code: "STORAGE_SIGNING_FAILED", message: error?.message || "Storage signing failed." }, 500);
  }
});
