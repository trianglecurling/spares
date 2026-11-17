-- A member with a permanent roster spot in a league attached to a waitlist, in a
-- session that has not ended, cannot also wait for that league. Remove existing
-- entries that break this rule, releasing frozen slots like the app does.
DO $$
DECLARE
 conflict RECORD;
 stored_index INTEGER;
BEGIN
 FOR conflict IN
  SELECT we."id" AS entry_id, we."waitlist_id", we."member_id", MIN(l."id") AS league_id
  FROM "waitlist_entries" AS we
  JOIN "leagues" AS l ON l."waitlist_id" = we."waitlist_id"
  JOIN "league_roster" AS lr ON lr."league_id" = l."id" AND lr."member_id" = we."member_id"
  JOIN "curling_sessions" AS s ON s."id" = l."session_id"
  WHERE we."status" = 'active'
    AND lr."is_temporary_sabbatical_fill" = 0
    AND s."end_date" >= CURRENT_DATE
  GROUP BY we."id", we."waitlist_id", we."member_id"
 LOOP
  SELECT ranked.rn - 1 INTO stored_index
  FROM (
    SELECT e."id", ROW_NUMBER() OVER (ORDER BY e."position_sort_key", e."joined_at", e."id") AS rn
    FROM "waitlist_entries" AS e
    WHERE e."waitlist_id" = conflict.waitlist_id AND e."status" = 'active'
  ) AS ranked
  WHERE ranked."id" = conflict.entry_id;

  UPDATE "league_waitlists"
  SET "frozen_entry_count" = GREATEST(0, "frozen_entry_count" - 1), "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = conflict.waitlist_id AND stored_index < "frozen_entry_count";

  UPDATE "waitlist_entries"
  SET "status" = 'removed', "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = conflict.entry_id;

  UPDATE "waitlist_offers"
  SET "status" = 'cancelled', "cancellation_reason" = 'member_rostered', "updated_at" = CURRENT_TIMESTAMP
  WHERE "waitlist_entry_id" = conflict.entry_id AND "status" = 'pending';

  INSERT INTO "waitlist_audit_events"
   ("waitlist_entry_id", "league_id", "member_id", "source", "action", "reason", "before_json", "after_json", "created_at")
  VALUES
   (conflict.entry_id, conflict.league_id, conflict.member_id, 'system_cleanup', 'entry_removed',
    'Member is on the league roster.', '{"status":"active"}'::jsonb, '{"status":"removed"}'::jsonb, CURRENT_TIMESTAMP);
 END LOOP;
END $$;
