-- Remap draw JSON team slots to registration slots before dropping tournament team tables.
DO $$
DECLARE
  ev RECORD;
  draw jsonb;
  game_key text;
  game jsonb;
  slots jsonb;
  new_slots jsonb;
  slot jsonb;
  team_id_val int;
  reg_id int;
  i int;
  slot_len int;
BEGIN
  IF to_regclass('public.event_tournament_teams') IS NULL THEN
    RETURN;
  END IF;

  FOR ev IN
    SELECT id, tournament_draw_json
    FROM events
    WHERE tournament_draw_json IS NOT NULL AND btrim(tournament_draw_json) <> ''
  LOOP
    BEGIN
      draw := ev.tournament_draw_json::jsonb;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    IF draw->'games' IS NULL OR jsonb_typeof(draw->'games') <> 'object' THEN
      CONTINUE;
    END IF;

    FOR game_key IN SELECT jsonb_object_keys(draw->'games')
    LOOP
      game := draw->'games'->game_key;
      slots := game->'slots';
      IF slots IS NULL OR jsonb_typeof(slots) <> 'array' THEN
        CONTINUE;
      END IF;

      new_slots := '[]'::jsonb;
      slot_len := jsonb_array_length(slots);
      FOR i IN 0..(slot_len - 1)
      LOOP
        slot := slots->i;
        IF coalesce(slot->>'sourceType', '') = 'team' THEN
          team_id_val := NULL;
          BEGIN
            IF slot ? 'teamId' AND jsonb_typeof(slot->'teamId') = 'number' THEN
              team_id_val := (slot->>'teamId')::int;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            team_id_val := NULL;
          END;

          reg_id := NULL;
          IF team_id_val IS NOT NULL THEN
            SELECT registration_id INTO reg_id
            FROM event_tournament_teams
            WHERE id = team_id_val;
          END IF;

          IF reg_id IS NOT NULL THEN
            slot := jsonb_build_object('sourceType', 'registration', 'registrationId', reg_id);
          ELSE
            slot := jsonb_build_object('sourceType', 'tbd');
          END IF;
        END IF;
        new_slots := new_slots || jsonb_build_array(slot);
      END LOOP;

      draw := jsonb_set(draw, ARRAY['games', game_key, 'slots'], new_slots, true);
    END LOOP;

    UPDATE events
    SET tournament_draw_json = draw::text
    WHERE id = ev.id;
  END LOOP;
END $$;
--> statement-breakpoint
-- Migrate legacy bonspiel + tournament_format into bonspiel-fours / bonspiel-doubles.
UPDATE events
SET calendar_type_id = 'bonspiel-doubles'
WHERE calendar_type_id = 'bonspiel'
  AND tournament_format = 'doubles';
--> statement-breakpoint
UPDATE events
SET calendar_type_id = 'bonspiel-fours'
WHERE calendar_type_id = 'bonspiel';
--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN IF EXISTS "tournament_format";
--> statement-breakpoint
DROP TABLE IF EXISTS "event_tournament_roster_slots";
--> statement-breakpoint
DROP TABLE IF EXISTS "event_tournament_teams";
