ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "name_tag_name" text;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "name_tag_include_pronouns" integer;
