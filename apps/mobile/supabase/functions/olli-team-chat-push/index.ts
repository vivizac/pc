import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function getSecretKey() {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (direct) return direct;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.default || "");
  } catch {
    return "";
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function preview(value: unknown, max = 160) {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length > max ? text.slice(0, max) + "…" : text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = getSecretKey();
  if (!supabaseUrl || !secretKey) {
    return json({ ok: false, error: "Push server configuration is missing." }, 500);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const action = clean(body.action || "dispatch");
  const academyId = clean(body.academy_id);

  async function ensureVapid() {
    let { data, error } = await admin.rpc("olli_push_server_vapid");
    if (error) throw error;

    let publicKey = clean(data?.public_key);
    let privateKey = clean(data?.private_key);

    if (!publicKey || !privateKey) {
      const generated = webpush.generateVAPIDKeys();
      const stored = await admin.rpc("olli_push_server_store_vapid", {
        p_public_key: generated.publicKey,
        p_private_key: generated.privateKey,
      });
      if (stored.error) throw stored.error;
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
    }

    return { publicKey, privateKey };
  }

  async function deliverTargets(options: {
    targets: any[];
    vapid: { publicKey: string; privateKey: string };
    notificationPayload: string;
    messageId: number;
    academyId: string;
  }) {
    const { targets, vapid, notificationPayload, messageId, academyId } = options;
    let notificationBase: any = null;
    try { notificationBase = JSON.parse(notificationPayload); } catch (_) {}

    if (!targets.length) {
      return { ok: true, attempted: 0, sent: 0, failed: 0 };
    }

    webpush.setVapidDetails(
      new URL(req.url).origin,
      vapid.publicKey,
      vapid.privateKey,
    );

    let sent = 0;
    let failed = 0;

    await Promise.all(targets.map(async (target: any) => {
      const subscription = {
        endpoint: clean(target.endpoint),
        keys: {
          p256dh: clean(target.p256dh),
          auth: clean(target.auth),
        },
      };

      try {
        const badgeCount = Math.max(0, Number(target?.unread_count || 0));
        const perTargetPayload = notificationBase
          ? JSON.stringify({
              ...notificationBase,
              data: {
                ...(notificationBase.data || {}),
                ...(badgeCount > 0 ? { badgeCount } : {}),
              },
            })
          : notificationPayload;

        await webpush.sendNotification(subscription, perTargetPayload, {
          TTL: 60 * 60,
          urgency: "normal",
        });

        sent += 1;
        await admin.rpc("olli_team_chat_push_mark_delivered", {
          p_academy_id: academyId,
          p_message_id: messageId,
          p_subscription_id: target.subscription_id,
          p_member_id: target.member_id,
        });
      } catch (error: any) {
        failed += 1;
        const statusCode = Number(error?.statusCode || error?.status || 0);
        if (statusCode === 404 || statusCode === 410) {
          await admin.rpc("olli_team_chat_push_disable_subscription", {
            p_academy_id: academyId,
            p_subscription_id: target.subscription_id,
          });
        }
        console.warn("OLLI push delivery failed", statusCode, error?.message || error);
      }
    }));

    return { ok: true, attempted: targets.length, sent, failed };
  }

  try {
    if (action === "dispatch-system") {
      const messageId = Number(body.message_id || 0);
      const targetMemberId = clean(body.target_member_id);
      const internalToken = clean(body.internal_token);

      if (!academyId || !Number.isInteger(messageId) || messageId <= 0 || !targetMemberId || !internalToken) {
        return json({ ok: false, error: "System dispatch target is incomplete." }, 400);
      }

      const secretResult = await admin.rpc("olli_team_chat_system_push_secret");
      if (secretResult.error) throw secretResult.error;
      if (!clean(secretResult.data) || clean(secretResult.data) !== internalToken) {
        return json({ ok: false, error: "Unauthorized system dispatch." }, 401);
      }

      const targetsResult = await admin.rpc("olli_team_chat_system_push_targets", {
        p_academy_id: academyId,
        p_message_id: messageId,
        p_member_id: targetMemberId,
      });

      if (targetsResult.error || !targetsResult.data?.ok) {
        return json({ ok: false, error: targetsResult.error?.message || "System push targets could not be resolved." }, 400);
      }

      const vapid = await ensureVapid();
      const payload = targetsResult.data;
      const targets = Array.isArray(payload.targets) ? payload.targets : [];
      const notificationPayload = JSON.stringify({
        title: "올리봇 알림",
        body: preview(payload.body, 180),
        tag: "olli-talk-system-" + messageId,
        data: {
          type: "olli-talk-system",
          messageId,
          url: "./?olliTalk=1&message=" + encodeURIComponent(String(messageId)),
        },
      });

      return json(await deliverTargets({
        targets,
        vapid,
        notificationPayload,
        messageId,
        academyId,
      }));
    }

    const sessionToken = clean(body.session_token);
    if (!sessionToken || !academyId) {
      return json({ ok: false, error: "Session and academy are required." }, 400);
    }

    const { data: context, error: contextError } = await admin.rpc("olli_team_chat_push_context", {
      p_session_token: sessionToken,
      p_academy_id: academyId,
    });

    if (contextError || !context?.ok) {
      return json({ ok: false, error: contextError?.message || "Unauthorized." }, 401);
    }

    const vapid = await ensureVapid();

    if (action === "public-key") {
      return json({ ok: true, public_key: vapid.publicKey });
    }

    if (action !== "dispatch") {
      return json({ ok: false, error: "Unknown action." }, 400);
    }

    const messageId = Number(body.message_id || 0);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return json({ ok: false, error: "Message id is required." }, 400);
    }

    const targetsResult = await admin.rpc("olli_team_chat_push_targets", {
      p_session_token: sessionToken,
      p_academy_id: academyId,
      p_message_id: messageId,
    });

    if (targetsResult.error || !targetsResult.data?.ok) {
      return json({ ok: false, error: targetsResult.error?.message || "Push targets could not be resolved." }, 400);
    }

    const payload = targetsResult.data;
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    const senderName = clean(payload.sender_name) || "올리톡";
    const notificationPayload = JSON.stringify({
      title: "올리톡 · " + senderName,
      body: preview(payload.body, 180),
      tag: "olli-talk-mention-" + messageId,
      data: {
        type: "olli-talk-mention",
        messageId,
        url: "./?olliTalk=1&message=" + encodeURIComponent(String(messageId)),
      },
    });

    return json(await deliverTargets({
      targets,
      vapid,
      notificationPayload,
      messageId,
      academyId,
    }));
  } catch (error: any) {
    console.error("OLLI push function error", error?.message || error);
    return json({ ok: false, error: error?.message || "Push service failed." }, 500);
  }
});
