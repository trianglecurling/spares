ALTER TABLE "server_config" ADD COLUMN IF NOT EXISTS "bypass_login_verification" integer DEFAULT 0 NOT NULL;
UPDATE "server_config" SET "bypass_login_verification" = "test_mode" WHERE "id" = 1;
