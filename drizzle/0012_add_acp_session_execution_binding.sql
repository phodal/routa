ALTER TABLE "acp_sessions" ADD COLUMN IF NOT EXISTS "execution_mode" text;
ALTER TABLE "acp_sessions" ADD COLUMN IF NOT EXISTS "owner_instance_id" text;
ALTER TABLE "acp_sessions" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;
