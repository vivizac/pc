# Shared Team Chat push

This function is source-only until the release checklist in
`docs/olli-team-chat-integration-20261106.md` is satisfied.

Use `verify_jwt=false` when deploying **this function**: browser requests carry the
existing Olli account session token in the body. Authorization is performed by the
service-only `olli_shared_chat_push_claim` RPC, including active academy membership,
sender ownership, room participation, join epoch, and the closed-by-default release
gate. Do not turn off verification on unrelated functions.

Requires `SUPABASE_URL`, a server-only `SUPABASE_SECRET_KEY` or
`SUPABASE_SERVICE_ROLE_KEY`, and the existing VAPID record. It never initializes or
replaces VAPID keys. `OLLI_VAPID_SUBJECT` is optional. Only a generic notification is
sent; message bodies, student data, and academy business data are excluded.

Delivery claims deduplicate an endpoint across multiple academy memberships. A
failed claim can be retried after two minutes by dispatching the same message;
provider success followed by a failed completion RPC can still cause an at-least-once
retry. The stable notification tag and `renotify:false` avoid repeated visible alerts
on the same device. This is not an exactly-once external delivery guarantee.
