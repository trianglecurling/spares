ALTER TABLE "server_config" ADD COLUMN IF NOT EXISTS "disable_user_login" integer DEFAULT 0 NOT NULL;
