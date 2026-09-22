ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "usa_curling_membership_opt_in" integer;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "uswca_membership_opt_in" integer;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "usa_curling_membership_number" text;
--> statement-breakpoint
UPDATE members AS m
SET usa_curling_membership_opt_in = src.usa_curling_membership_opt_in
FROM (
  SELECT DISTINCT ON (curler_member_id)
    curler_member_id,
    usa_curling_membership_opt_in
  FROM curling_registrations
  WHERE curler_member_id IS NOT NULL
    AND usa_curling_membership_opt_in IS NOT NULL
  ORDER BY curler_member_id, updated_at DESC NULLS LAST, id DESC
) AS src
WHERE src.curler_member_id = m.id
  AND m.usa_curling_membership_opt_in IS NULL;
--> statement-breakpoint
UPDATE members AS m
SET uswca_membership_opt_in = src.uswca_membership_opt_in
FROM (
  SELECT DISTINCT ON (curler_member_id)
    curler_member_id,
    uswca_membership_opt_in
  FROM curling_registrations
  WHERE curler_member_id IS NOT NULL
    AND uswca_membership_opt_in IS NOT NULL
  ORDER BY curler_member_id, updated_at DESC NULLS LAST, id DESC
) AS src
WHERE src.curler_member_id = m.id
  AND m.uswca_membership_opt_in IS NULL;
