CREATE TABLE "article_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "article_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"article_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content_type" text DEFAULT 'markdown' NOT NULL,
	"content" text NOT NULL,
	"revision_note" text,
	"is_small_edit" integer DEFAULT 0 NOT NULL,
	"snippet" text,
	"featured" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp,
	"saved_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "articles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content_type" text DEFAULT 'markdown' NOT NULL,
	"content" text NOT NULL,
	"snippet" text,
	"featured" integer DEFAULT 0 NOT NULL,
	"featured_sort_order" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_member_id" integer,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contact" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"actor_member_id" integer,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "calendar_event_exceptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_event_exceptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"parent_event_id" integer NOT NULL,
	"exception_date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event_locations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_event_locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"location_type" text NOT NULL,
	"sheet_id" integer
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" text DEFAULT 'direct' NOT NULL,
	"type_id" text NOT NULL,
	"title" text NOT NULL,
	"start_dt" text NOT NULL,
	"end_dt" text NOT NULL,
	"all_day" integer DEFAULT 0 NOT NULL,
	"recurrence_rule" text,
	"parent_event_id" integer,
	"recurrence_date" text,
	"description" text,
	"article_id" integer,
	"created_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curling_ice_privileges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_ice_privileges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_registration_id" integer,
	"source_league_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curling_league_sabbaticals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_league_sabbaticals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"lineage_key" text,
	"original_league_id" integer NOT NULL,
	"current_league_id" integer NOT NULL,
	"source_registration_id" integer,
	"first_sabbatical_league_id" integer NOT NULL,
	"first_sabbatical_start_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"staff_override" integer DEFAULT 0 NOT NULL,
	"staff_override_reason" text,
	"released_at" timestamp,
	"released_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curling_registrations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_registrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"submitted_by_member_id" integer,
	"curler_member_id" integer,
	"returning_member_answer" integer,
	"registering_for_self" integer,
	"demographics_current_confirmed" integer DEFAULT 0 NOT NULL,
	"guardian_first_name" text,
	"guardian_last_name" text,
	"guardian_email" text,
	"guardian_phone" text,
	"membership_option" text DEFAULT 'none' NOT NULL,
	"experience_type" text,
	"experience_self_reported_years" double precision,
	"student_discount_claimed" integer DEFAULT 0 NOT NULL,
	"student_institution" text,
	"reciprocal_discount_claimed" integer DEFAULT 0 NOT NULL,
	"reciprocal_club_name" text,
	"last_fee_preview_json" jsonb,
	"payment_decision_json" jsonb,
	"status" text DEFAULT 'identity_incomplete' NOT NULL,
	"shell_completed_at" timestamp,
	"submitted_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curling_sabbatical_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_sabbatical_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sabbatical_id" integer NOT NULL,
	"league_id" integer NOT NULL,
	"registration_id" integer,
	"fee_amount_minor" integer DEFAULT 0 NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curling_seasons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_seasons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curling_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_activity" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "daily_activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"activity_date" text NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draw_sheet_availability" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "draw_sheet_availability_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"draw_date" date NOT NULL,
	"draw_time" time NOT NULL,
	"sheet_id" integer NOT NULL,
	"is_available" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event_category_assignments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_category_assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"category_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_locations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"location_type" text NOT NULL,
	"sheet_id" integer
);
--> statement-breakpoint
CREATE TABLE "event_owners" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_owners_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_registration_field_values" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_registration_field_values_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"registration_id" integer NOT NULL,
	"field_id" integer NOT NULL,
	"registration_member_id" integer,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "event_registration_fields" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_registration_fields_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"scope" text DEFAULT 'group' NOT NULL,
	"required" integer DEFAULT 0 NOT NULL,
	"options" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_registration_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_registration_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"registration_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_registrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"member_id" integer,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"group_size" integer DEFAULT 1 NOT NULL,
	"payment_order_id" integer,
	"special_link_id" integer,
	"waitlist_position" integer,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_special_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_special_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"override_fee_minor" integer,
	"max_group_size" integer,
	"bypass_capacity" integer DEFAULT 0 NOT NULL,
	"ignore_registration_dates" integer DEFAULT 0 NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"invalidated" integer DEFAULT 0 NOT NULL,
	"used_by_registration_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_special_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "event_timespans" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_timespans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"start_dt" text NOT NULL,
	"end_dt" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_tournament_roster_slots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_tournament_roster_slots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"team_id" integer NOT NULL,
	"slot_code" text NOT NULL,
	"player_name" text,
	"email" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "event_tournament_teams" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_tournament_teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"team_name" text,
	"home_club" text,
	"vice_slot_code" text NOT NULL,
	"skip_slot_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"article_id" integer,
	"image_file_id" integer,
	"visibility" text DEFAULT 'public' NOT NULL,
	"published" integer DEFAULT 0 NOT NULL,
	"capacity" integer,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"member_fee_minor" integer,
	"currency" text DEFAULT 'usd' NOT NULL,
	"registration_start" timestamp,
	"registration_cutoff" timestamp,
	"cancellation_cutoff" timestamp,
	"allow_group_registration" integer DEFAULT 0 NOT NULL,
	"max_group_size" integer,
	"enable_waitlist" integer DEFAULT 1 NOT NULL,
	"calendar_type_id" text DEFAULT 'other' NOT NULL,
	"tournament_teams_published" integer DEFAULT 0 NOT NULL,
	"tournament_draw_published" integer DEFAULT 0 NOT NULL,
	"tournament_format" text,
	"tournament_draw_json" text,
	"terms_article_id" integer,
	"created_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"category" text NOT NULL,
	"body" text NOT NULL,
	"email" text,
	"member_id" integer,
	"page_path" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"display_name" text,
	"description" text,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"checksum_sha256" text,
	"thumbnail_storage_key" text,
	"thumbnail_mime_type" text,
	"thumbnail_byte_size" integer,
	"thumbnail_checksum_sha256" text,
	"uploaded_by_member_id" integer,
	"suspected_orphan" integer DEFAULT 0 NOT NULL,
	"last_referenced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "financial_assistance_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "financial_assistance_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"registration_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"requested_percentage" double precision NOT NULL,
	"approved_percentage" double precision,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_member_id" integer,
	"reviewed_at" timestamp,
	"staff_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_lineups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "game_lineups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"game_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"role" text NOT NULL,
	"is_spare" integer DEFAULT 0 NOT NULL,
	"sparing_for_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "game_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"game_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"result_order" integer NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"team1_id" integer NOT NULL,
	"team2_id" integer NOT NULL,
	"game_date" date,
	"game_time" time,
	"sheet_id" integer,
	"status" text DEFAULT 'unscheduled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_board_member_committees" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "governance_board_member_committees_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"board_member_id" integer NOT NULL,
	"committee_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_board_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "governance_board_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"public_email" text,
	"first_fiscal_year" integer NOT NULL,
	"last_fiscal_year" integer NOT NULL,
	"manual_inactive" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_committee_chairs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "governance_committee_chairs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"committee_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"public_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_committees" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "governance_committees_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"contact_info" text,
	"responsibilities" text,
	"board_liaison_board_member_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_officers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "governance_officers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"position" text NOT NULL,
	"board_member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"fiscal_year_start_mmdd" text NOT NULL,
	"board_turnover_mmdd" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ice_bookings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ice_bookings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"sheet_id" integer NOT NULL,
	"start_dt" text NOT NULL,
	"end_dt" text NOT NULL,
	"purpose" text NOT NULL,
	"purpose_other" text,
	"guest_names" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_divisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_divisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_draw_times" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_draw_times_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"draw_time" time NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_exceptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_exceptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"exception_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_extra_draws" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_extra_draws_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"draw_date" date NOT NULL,
	"draw_time" time NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_member_roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_member_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"league_id" integer,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_roster" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_roster_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"source_registration_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"placement_type" text,
	"is_temporary_sabbatical_fill" integer DEFAULT 0 NOT NULL,
	"related_sabbatical_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"head_to_head_first" integer DEFAULT 0 NOT NULL,
	"result_labels" text,
	"collect_bye_requests" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_teams" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"division_id" integer NOT NULL,
	"name" text,
	"prefer_late_draw" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leagues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer,
	"name" text NOT NULL,
	"day_of_week" integer NOT NULL,
	"format" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"league_type" text DEFAULT 'standard' NOT NULL,
	"capacity_type" text DEFAULT 'individual' NOT NULL,
	"capacity_value" integer DEFAULT 0 NOT NULL,
	"registration_fee_minor" integer DEFAULT 0 NOT NULL,
	"registration_fee_override_minor" integer,
	"requires_club_membership" integer DEFAULT 1 NOT NULL,
	"min_experience_years" integer,
	"min_age" integer,
	"max_age" integer,
	"first_day_of_play" date,
	"last_day_of_play" date,
	"allows_waitlist" integer DEFAULT 1 NOT NULL,
	"allows_sabbatical" integer DEFAULT 1 NOT NULL,
	"predecessor_league_id" integer,
	"successor_league_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_account_access_delegations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_account_access_delegations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"grantor_member_id" integer NOT NULL,
	"grantee_member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_availability" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_availability_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"league_id" integer NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"can_skip" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_role_assignments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_role_assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"resource_type" text,
	"resource_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"first_name" text,
	"last_name" text,
	"date_of_birth" date,
	"mailing_address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"valid_through" date,
	"spare_only" integer DEFAULT 0 NOT NULL,
	"social_member" integer DEFAULT 0 NOT NULL,
	"is_server_admin" integer DEFAULT 0 NOT NULL,
	"is_calendar_admin" integer DEFAULT 0 NOT NULL,
	"is_content_admin" integer DEFAULT 0 NOT NULL,
	"is_sponsor_admin" integer DEFAULT 0 NOT NULL,
	"opted_in_sms" integer DEFAULT 0 NOT NULL,
	"email_subscribed" integer DEFAULT 1 NOT NULL,
	"first_login_completed" integer DEFAULT 0 NOT NULL,
	"email_visible" integer DEFAULT 0 NOT NULL,
	"phone_visible" integer DEFAULT 0 NOT NULL,
	"theme_preference" text DEFAULT 'system',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "menu_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"menu_type" text DEFAULT 'navbar' NOT NULL,
	"parent_id" integer,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"link_type" text,
	"url" text,
	"open_in_new_tab" integer DEFAULT 0 NOT NULL,
	"article_id" integer,
	"use_article_title_for_label" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observability_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observability_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"member_id" integer,
	"related_id" integer,
	"meta" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payment_order_id" integer,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"processing_error" text,
	"raw_payload" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_token" text NOT NULL,
	"provider" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" integer,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"status_reason" text,
	"provider_order_id" text,
	"metadata" text,
	"created_by_member_id" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_order_token_unique" UNIQUE("order_token")
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"payment_order_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"transaction_type" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"fee_minor" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"occurred_at" timestamp,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permalink_hits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "permalink_hits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"permalink_id" integer NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"visitor_id" text NOT NULL,
	"member_id" integer,
	"referrer_domain" text
);
--> statement-breakpoint
CREATE TABLE "permalinks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "permalinks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"label" text,
	"notes" text,
	"destination_url" text NOT NULL,
	"destination_may_change" integer DEFAULT 0 NOT NULL,
	"legacy_click_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permalinks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refunds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"payment_order_id" integer NOT NULL,
	"payment_transaction_id" integer,
	"provider" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"reason" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by_member_id" integer,
	"approved_by_member_id" integer,
	"provider_refund_id" text,
	"provider_response" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_discount_settings" (
	"scope" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"student_discount_amount_type" text DEFAULT 'dollar' NOT NULL,
	"student_discount_amount_value" integer DEFAULT 0 NOT NULL,
	"reciprocal_discount_amount_type" text DEFAULT 'dollar' NOT NULL,
	"reciprocal_discount_amount_value" integer DEFAULT 0 NOT NULL,
	"winter_only_discount_amount_type" text DEFAULT 'dollar' NOT NULL,
	"winter_only_discount_amount_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_invoice_line_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registration_invoice_line_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"invoice_id" integer NOT NULL,
	"line_type" text NOT NULL,
	"description" text NOT NULL,
	"related_league_id" integer,
	"related_selection_id" integer,
	"amount_minor" integer NOT NULL,
	"discount_eligible" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_invoices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registration_invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"registration_id" integer NOT NULL,
	"payer_member_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"deferred" integer DEFAULT 0 NOT NULL,
	"deferred_reason" text,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"payment_order_id" integer,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_outbound_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registration_outbound_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_type" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_member_id" integer,
	"registration_id" integer,
	"waitlist_offer_id" integer,
	"waitlist_entry_id" integer,
	"resend_of_message_id" integer,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text NOT NULL,
	"payload_json" jsonb,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"error_detail" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_policy_acceptances" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registration_policy_acceptances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"registration_id" integer NOT NULL,
	"policy_type" text NOT NULL,
	"policy_url" text NOT NULL,
	"accepted_by_member_id" integer NOT NULL,
	"accepted_for_member_id" integer NOT NULL,
	"accepted_at" timestamp NOT NULL,
	"policy_version" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_price_settings" (
	"scope" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"regular_membership_fee_minor" integer DEFAULT 0 NOT NULL,
	"social_membership_fee_minor" integer DEFAULT 0 NOT NULL,
	"spare_only_ice_privilege_fee_minor" integer DEFAULT 0 NOT NULL,
	"sabbatical_fee_minor" integer DEFAULT 0 NOT NULL,
	"junior_recreational_fee_minor" integer DEFAULT 0 NOT NULL,
	"default_league_fee_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_selections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registration_selections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"registration_id" integer NOT NULL,
	"league_id" integer,
	"selection_type" text NOT NULL,
	"rank" integer,
	"replaces_league_id" integer,
	"related_sabbatical_id" integer,
	"is_temporary_sabbatical_fill" integer DEFAULT 0 NOT NULL,
	"byot_teammate_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"fee_amount_minor_snapshot" integer DEFAULT 0 NOT NULL,
	"discount_amount_minor_snapshot" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_state_transitions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registration_state_transitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"effective_at" timestamp NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_scope_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "role_scope_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"role_id" integer NOT NULL,
	"scope" text NOT NULL,
	"effect" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" integer DEFAULT 0 NOT NULL,
	"is_computed" integer DEFAULT 0 NOT NULL,
	"is_assignable" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "season_memberships" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "season_memberships_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"membership_type" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"source_registration_id" integer,
	"payment_order_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"twilio_api_key_sid" text,
	"twilio_api_key_secret" text,
	"twilio_account_sid" text,
	"twilio_campaign_sid" text,
	"azure_connection_string" text,
	"azure_sender_email" text,
	"azure_sender_display_name" text,
	"dashboard_alert_title" text,
	"dashboard_alert_body" text,
	"dashboard_alert_expires_at" timestamp,
	"dashboard_alert_variant" text,
	"dashboard_alert_icon" text,
	"test_mode" integer DEFAULT 0 NOT NULL,
	"disable_email" integer DEFAULT 0 NOT NULL,
	"disable_sms" integer DEFAULT 0 NOT NULL,
	"frontend_otel_enabled" integer DEFAULT 1 NOT NULL,
	"capture_frontend_logs" integer DEFAULT 1 NOT NULL,
	"capture_backend_logs" integer DEFAULT 1 NOT NULL,
	"test_current_time" timestamp,
	"notification_delay_seconds" integer DEFAULT 180 NOT NULL,
	"session_token_ttl_minutes" integer DEFAULT 30 NOT NULL,
	"refresh_token_ttl_days" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sheets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "showcase_images" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "showcase_images_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"url" text NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"club_name" text,
	"logo_url" text,
	"contact_email" text,
	"contact_phone" text,
	"footer_markdown" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spare_request_ccs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spare_request_ccs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"spare_request_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spare_request_invitations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spare_request_invitations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"spare_request_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"declined_at" timestamp,
	"decline_comment" text
);
--> statement-breakpoint
CREATE TABLE "spare_request_notification_deliveries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spare_request_notification_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"spare_request_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"notification_generation" integer NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"claimed_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spare_request_notification_queue" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spare_request_notification_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"spare_request_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"queue_order" integer NOT NULL,
	"claimed_at" timestamp,
	"notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spare_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spare_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"requester_id" integer NOT NULL,
	"league_id" integer,
	"game_id" integer,
	"requested_for_name" text NOT NULL,
	"requested_for_member_id" integer,
	"game_date" date NOT NULL,
	"game_time" time NOT NULL,
	"position" text,
	"message" text,
	"request_type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"filled_by_member_id" integer,
	"cancelled_by_member_id" integer,
	"filled_at" timestamp,
	"notification_generation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"notifications_sent_at" timestamp,
	"had_cancellation" integer DEFAULT 0 NOT NULL,
	"notification_status" text,
	"next_notification_at" timestamp,
	"notification_paused" integer DEFAULT 0 NOT NULL,
	"all_invites_declined_notified" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spare_responses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spare_responses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"spare_request_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sponsors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"website_url" text NOT NULL,
	"logo_file_id" integer,
	"contact_name" text,
	"contact_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsorship_levels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sponsorship_levels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"amount" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsorships" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sponsorships_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sponsor_id" integer NOT NULL,
	"sponsorship_level_id" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_bye_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "team_bye_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"team_id" integer NOT NULL,
	"draw_date" date NOT NULL,
	"priority" integer NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "team_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"team_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"role" text NOT NULL,
	"is_skip" integer DEFAULT 0 NOT NULL,
	"is_vice" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_audit_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "waitlist_audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"waitlist_entry_id" integer,
	"league_id" integer,
	"member_id" integer,
	"actor_member_id" integer,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"metadata_json" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "waitlist_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"league_id" integer NOT NULL,
	"source_registration_id" integer,
	"entry_type" text NOT NULL,
	"replaces_league_id" integer,
	"position_sort_key" text NOT NULL,
	"joined_at" timestamp NOT NULL,
	"decline_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rolled_over_from_waitlist_entry_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_offers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "waitlist_offers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"waitlist_entry_id" integer NOT NULL,
	"league_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"offer_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"offered_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"responded_at" timestamp,
	"response_source" text,
	"response_token" text,
	"offered_by_member_id" integer,
	"source_registration_id" integer,
	"payment_link_id" text,
	"cancellation_reason" text,
	"staff_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"webhook_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"request_url" text NOT NULL,
	"response_status" integer,
	"success" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhooks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"destination_url" text NOT NULL,
	"secret" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_saved_by_member_id_members_id_fk" FOREIGN KEY ("saved_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ADD CONSTRAINT "calendar_event_exceptions_parent_event_id_calendar_events_id_fk" FOREIGN KEY ("parent_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_locations" ADD CONSTRAINT "calendar_event_locations_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_locations" ADD CONSTRAINT "calendar_event_locations_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_ice_privileges" ADD CONSTRAINT "curling_ice_privileges_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_ice_privileges" ADD CONSTRAINT "curling_ice_privileges_season_id_curling_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."curling_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_ice_privileges" ADD CONSTRAINT "curling_ice_privileges_session_id_curling_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."curling_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_ice_privileges" ADD CONSTRAINT "curling_ice_privileges_source_registration_id_curling_registrations_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_ice_privileges" ADD CONSTRAINT "curling_ice_privileges_source_league_id_leagues_id_fk" FOREIGN KEY ("source_league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_league_sabbaticals" ADD CONSTRAINT "curling_league_sabbaticals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_league_sabbaticals" ADD CONSTRAINT "curling_league_sabbaticals_original_league_id_leagues_id_fk" FOREIGN KEY ("original_league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_league_sabbaticals" ADD CONSTRAINT "curling_league_sabbaticals_current_league_id_leagues_id_fk" FOREIGN KEY ("current_league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_league_sabbaticals" ADD CONSTRAINT "curling_league_sabbaticals_source_registration_id_curling_registrations_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_league_sabbaticals" ADD CONSTRAINT "curling_league_sabbaticals_first_sabbatical_league_id_leagues_id_fk" FOREIGN KEY ("first_sabbatical_league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_registrations" ADD CONSTRAINT "curling_registrations_season_id_curling_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."curling_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_registrations" ADD CONSTRAINT "curling_registrations_session_id_curling_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."curling_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_registrations" ADD CONSTRAINT "curling_registrations_submitted_by_member_id_members_id_fk" FOREIGN KEY ("submitted_by_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_registrations" ADD CONSTRAINT "curling_registrations_curler_member_id_members_id_fk" FOREIGN KEY ("curler_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_sabbatical_sessions" ADD CONSTRAINT "curling_sabbatical_sessions_sabbatical_id_curling_league_sabbaticals_id_fk" FOREIGN KEY ("sabbatical_id") REFERENCES "public"."curling_league_sabbaticals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_sabbatical_sessions" ADD CONSTRAINT "curling_sabbatical_sessions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_sabbatical_sessions" ADD CONSTRAINT "curling_sabbatical_sessions_registration_id_curling_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curling_sessions" ADD CONSTRAINT "curling_sessions_season_id_curling_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."curling_seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_activity" ADD CONSTRAINT "daily_activity_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_sheet_availability" ADD CONSTRAINT "draw_sheet_availability_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_sheet_availability" ADD CONSTRAINT "draw_sheet_availability_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_category_assignments" ADD CONSTRAINT "event_category_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_category_assignments" ADD CONSTRAINT "event_category_assignments_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_owners" ADD CONSTRAINT "event_owners_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_owners" ADD CONSTRAINT "event_owners_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration_field_values" ADD CONSTRAINT "event_registration_field_values_registration_id_event_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."event_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration_field_values" ADD CONSTRAINT "event_registration_field_values_field_id_event_registration_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."event_registration_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration_field_values" ADD CONSTRAINT "event_registration_field_values_registration_member_id_event_registration_members_id_fk" FOREIGN KEY ("registration_member_id") REFERENCES "public"."event_registration_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration_fields" ADD CONSTRAINT "event_registration_fields_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registration_members" ADD CONSTRAINT "event_registration_members_registration_id_event_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."event_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_special_links" ADD CONSTRAINT "event_special_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_special_links" ADD CONSTRAINT "event_special_links_used_by_registration_id_event_registrations_id_fk" FOREIGN KEY ("used_by_registration_id") REFERENCES "public"."event_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_timespans" ADD CONSTRAINT "event_timespans_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tournament_roster_slots" ADD CONSTRAINT "event_tournament_roster_slots_team_id_event_tournament_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."event_tournament_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tournament_teams" ADD CONSTRAINT "event_tournament_teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_terms_article_id_articles_id_fk" FOREIGN KEY ("terms_article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_member_id_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_assistance_requests" ADD CONSTRAINT "financial_assistance_requests_registration_id_curling_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_assistance_requests" ADD CONSTRAINT "financial_assistance_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_assistance_requests" ADD CONSTRAINT "financial_assistance_requests_reviewed_by_member_id_members_id_fk" FOREIGN KEY ("reviewed_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineups" ADD CONSTRAINT "game_lineups_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineups" ADD CONSTRAINT "game_lineups_team_id_league_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."league_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineups" ADD CONSTRAINT "game_lineups_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineups" ADD CONSTRAINT "game_lineups_sparing_for_member_id_members_id_fk" FOREIGN KEY ("sparing_for_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_team_id_league_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."league_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_team1_id_league_teams_id_fk" FOREIGN KEY ("team1_id") REFERENCES "public"."league_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_team2_id_league_teams_id_fk" FOREIGN KEY ("team2_id") REFERENCES "public"."league_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_board_member_committees" ADD CONSTRAINT "governance_board_member_committees_board_member_id_governance_board_members_id_fk" FOREIGN KEY ("board_member_id") REFERENCES "public"."governance_board_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_board_member_committees" ADD CONSTRAINT "governance_board_member_committees_committee_id_governance_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."governance_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_board_members" ADD CONSTRAINT "governance_board_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_committee_chairs" ADD CONSTRAINT "governance_committee_chairs_committee_id_governance_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."governance_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_committee_chairs" ADD CONSTRAINT "governance_committee_chairs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_committees" ADD CONSTRAINT "governance_committees_board_liaison_board_member_id_governance_board_members_id_fk" FOREIGN KEY ("board_liaison_board_member_id") REFERENCES "public"."governance_board_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_officers" ADD CONSTRAINT "governance_officers_board_member_id_governance_board_members_id_fk" FOREIGN KEY ("board_member_id") REFERENCES "public"."governance_board_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ice_bookings" ADD CONSTRAINT "ice_bookings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ice_bookings" ADD CONSTRAINT "ice_bookings_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_divisions" ADD CONSTRAINT "league_divisions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_draw_times" ADD CONSTRAINT "league_draw_times_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_exceptions" ADD CONSTRAINT "league_exceptions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_extra_draws" ADD CONSTRAINT "league_extra_draws_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_member_roles" ADD CONSTRAINT "league_member_roles_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_member_roles" ADD CONSTRAINT "league_member_roles_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_roster" ADD CONSTRAINT "league_roster_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_roster" ADD CONSTRAINT "league_roster_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_roster" ADD CONSTRAINT "league_roster_source_registration_id_curling_registrations_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_roster" ADD CONSTRAINT "league_roster_related_sabbatical_id_curling_league_sabbaticals_id_fk" FOREIGN KEY ("related_sabbatical_id") REFERENCES "public"."curling_league_sabbaticals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_settings" ADD CONSTRAINT "league_settings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_teams" ADD CONSTRAINT "league_teams_division_id_league_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."league_divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_session_id_curling_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."curling_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_account_access_delegations" ADD CONSTRAINT "member_account_access_delegations_grantor_member_id_members_id_fk" FOREIGN KEY ("grantor_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_account_access_delegations" ADD CONSTRAINT "member_account_access_delegations_grantee_member_id_members_id_fk" FOREIGN KEY ("grantee_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_availability" ADD CONSTRAINT "member_availability_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_availability" ADD CONSTRAINT "member_availability_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observability_events" ADD CONSTRAINT "observability_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permalink_hits" ADD CONSTRAINT "permalink_hits_permalink_id_permalinks_id_fk" FOREIGN KEY ("permalink_id") REFERENCES "public"."permalinks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permalink_hits" ADD CONSTRAINT "permalink_hits_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_member_id_members_id_fk" FOREIGN KEY ("requested_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_member_id_members_id_fk" FOREIGN KEY ("approved_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_invoice_line_items" ADD CONSTRAINT "registration_invoice_line_items_invoice_id_registration_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."registration_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_invoice_line_items" ADD CONSTRAINT "registration_invoice_line_items_related_league_id_leagues_id_fk" FOREIGN KEY ("related_league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_invoice_line_items" ADD CONSTRAINT "registration_invoice_line_items_related_selection_id_registration_selections_id_fk" FOREIGN KEY ("related_selection_id") REFERENCES "public"."registration_selections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_invoices" ADD CONSTRAINT "registration_invoices_registration_id_curling_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_invoices" ADD CONSTRAINT "registration_invoices_payer_member_id_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_outbound_messages" ADD CONSTRAINT "registration_outbound_messages_recipient_member_id_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_outbound_messages" ADD CONSTRAINT "registration_outbound_messages_registration_id_curling_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_outbound_messages" ADD CONSTRAINT "registration_outbound_messages_waitlist_offer_id_waitlist_offers_id_fk" FOREIGN KEY ("waitlist_offer_id") REFERENCES "public"."waitlist_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_outbound_messages" ADD CONSTRAINT "registration_outbound_messages_waitlist_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_policy_acceptances" ADD CONSTRAINT "registration_policy_acceptances_registration_id_curling_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_policy_acceptances" ADD CONSTRAINT "registration_policy_acceptances_accepted_by_member_id_members_id_fk" FOREIGN KEY ("accepted_by_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_policy_acceptances" ADD CONSTRAINT "registration_policy_acceptances_accepted_for_member_id_members_id_fk" FOREIGN KEY ("accepted_for_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_selections" ADD CONSTRAINT "registration_selections_registration_id_curling_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_selections" ADD CONSTRAINT "registration_selections_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_selections" ADD CONSTRAINT "registration_selections_replaces_league_id_leagues_id_fk" FOREIGN KEY ("replaces_league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_selections" ADD CONSTRAINT "registration_selections_related_sabbatical_id_curling_league_sabbaticals_id_fk" FOREIGN KEY ("related_sabbatical_id") REFERENCES "public"."curling_league_sabbaticals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_state_transitions" ADD CONSTRAINT "registration_state_transitions_season_id_curling_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."curling_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_state_transitions" ADD CONSTRAINT "registration_state_transitions_session_id_curling_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."curling_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_scope_rules" ADD CONSTRAINT "role_scope_rules_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_memberships" ADD CONSTRAINT "season_memberships_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_memberships" ADD CONSTRAINT "season_memberships_season_id_curling_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."curling_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_memberships" ADD CONSTRAINT "season_memberships_source_registration_id_curling_registrations_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_request_ccs" ADD CONSTRAINT "spare_request_ccs_spare_request_id_spare_requests_id_fk" FOREIGN KEY ("spare_request_id") REFERENCES "public"."spare_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_request_ccs" ADD CONSTRAINT "spare_request_ccs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_request_invitations" ADD CONSTRAINT "spare_request_invitations_spare_request_id_spare_requests_id_fk" FOREIGN KEY ("spare_request_id") REFERENCES "public"."spare_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_request_invitations" ADD CONSTRAINT "spare_request_invitations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_request_notification_deliveries" ADD CONSTRAINT "spare_request_notification_deliveries_spare_request_id_spare_requests_id_fk" FOREIGN KEY ("spare_request_id") REFERENCES "public"."spare_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_request_notification_deliveries" ADD CONSTRAINT "spare_request_notification_deliveries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_request_notification_queue" ADD CONSTRAINT "spare_request_notification_queue_spare_request_id_spare_requests_id_fk" FOREIGN KEY ("spare_request_id") REFERENCES "public"."spare_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_request_notification_queue" ADD CONSTRAINT "spare_request_notification_queue_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_requests" ADD CONSTRAINT "spare_requests_requester_id_members_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_requests" ADD CONSTRAINT "spare_requests_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_requests" ADD CONSTRAINT "spare_requests_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_requests" ADD CONSTRAINT "spare_requests_requested_for_member_id_members_id_fk" FOREIGN KEY ("requested_for_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_requests" ADD CONSTRAINT "spare_requests_filled_by_member_id_members_id_fk" FOREIGN KEY ("filled_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_requests" ADD CONSTRAINT "spare_requests_cancelled_by_member_id_members_id_fk" FOREIGN KEY ("cancelled_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_responses" ADD CONSTRAINT "spare_responses_spare_request_id_spare_requests_id_fk" FOREIGN KEY ("spare_request_id") REFERENCES "public"."spare_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_responses" ADD CONSTRAINT "spare_responses_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorships" ADD CONSTRAINT "sponsorships_sponsorship_level_id_sponsorship_levels_id_fk" FOREIGN KEY ("sponsorship_level_id") REFERENCES "public"."sponsorship_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_bye_requests" ADD CONSTRAINT "team_bye_requests_team_id_league_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."league_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_league_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."league_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_audit_events" ADD CONSTRAINT "waitlist_audit_events_waitlist_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_audit_events" ADD CONSTRAINT "waitlist_audit_events_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_audit_events" ADD CONSTRAINT "waitlist_audit_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_audit_events" ADD CONSTRAINT "waitlist_audit_events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_source_registration_id_curling_registrations_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_replaces_league_id_leagues_id_fk" FOREIGN KEY ("replaces_league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_waitlist_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_offered_by_member_id_members_id_fk" FOREIGN KEY ("offered_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_offers" ADD CONSTRAINT "waitlist_offers_source_registration_id_curling_registrations_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_article_versions_article_id" ON "article_versions" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_versions_article_id_version_number_unique" ON "article_versions" USING btree ("article_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_article_versions_created_at" ON "article_versions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_articles_slug" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_articles_featured" ON "articles" USING btree ("featured");--> statement-breakpoint
CREATE INDEX "idx_articles_published_at" ON "articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_auth_codes_contact" ON "auth_codes" USING btree ("contact");--> statement-breakpoint
CREATE INDEX "idx_auth_codes_code" ON "auth_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_token" ON "auth_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_member_id" ON "auth_tokens" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_actor_member_id" ON "auth_tokens" USING btree ("actor_member_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_event_exceptions_parent_id" ON "calendar_event_exceptions" USING btree ("parent_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_exceptions_parent_date_unique" ON "calendar_event_exceptions" USING btree ("parent_event_id","exception_date");--> statement-breakpoint
CREATE INDEX "idx_calendar_event_locations_event_id" ON "calendar_event_locations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_start_dt" ON "calendar_events" USING btree ("start_dt");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_parent_id" ON "calendar_events" USING btree ("parent_event_id");--> statement-breakpoint
CREATE INDEX "idx_calendar_events_recurrence_date" ON "calendar_events" USING btree ("parent_event_id","recurrence_date");--> statement-breakpoint
CREATE INDEX "idx_curling_ice_privileges_member_id" ON "curling_ice_privileges" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_curling_league_sabbaticals_member_id" ON "curling_league_sabbaticals" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_curling_league_sabbaticals_current_league_id" ON "curling_league_sabbaticals" USING btree ("current_league_id");--> statement-breakpoint
CREATE INDEX "idx_curling_league_sabbaticals_status" ON "curling_league_sabbaticals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_curling_league_sabbaticals_first_start" ON "curling_league_sabbaticals" USING btree ("first_sabbatical_start_date");--> statement-breakpoint
CREATE INDEX "idx_curling_registrations_season_id" ON "curling_registrations" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "idx_curling_registrations_session_id" ON "curling_registrations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_curling_registrations_curler_member_id" ON "curling_registrations" USING btree ("curler_member_id");--> statement-breakpoint
CREATE INDEX "idx_curling_registrations_submitted_by_member_id" ON "curling_registrations" USING btree ("submitted_by_member_id");--> statement-breakpoint
CREATE INDEX "idx_curling_registrations_status" ON "curling_registrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_curling_registrations_resume" ON "curling_registrations" USING btree ("season_id","session_id","curler_member_id","status");--> statement-breakpoint
CREATE INDEX "idx_curling_sabbatical_sessions_sabbatical_id" ON "curling_sabbatical_sessions" USING btree ("sabbatical_id");--> statement-breakpoint
CREATE INDEX "idx_curling_sessions_season_id" ON "curling_sessions" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "idx_curling_sessions_season_start" ON "curling_sessions" USING btree ("season_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_activity_member_id_activity_date_unique" ON "daily_activity" USING btree ("member_id","activity_date");--> statement-breakpoint
CREATE INDEX "idx_daily_activity_activity_date" ON "daily_activity" USING btree ("activity_date");--> statement-breakpoint
CREATE INDEX "idx_daily_activity_member_id" ON "daily_activity" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_draw_sheet_availability_league_id" ON "draw_sheet_availability" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_draw_sheet_availability_draw" ON "draw_sheet_availability" USING btree ("league_id","draw_date","draw_time");--> statement-breakpoint
CREATE INDEX "idx_draw_sheet_availability_sheet_id" ON "draw_sheet_availability" USING btree ("sheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draw_sheet_availability_unique" ON "draw_sheet_availability" USING btree ("league_id","draw_date","draw_time","sheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_categories_slug_unique_pg" ON "event_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_event_category_assignments_event_id" ON "event_category_assignments" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_category_assignments_category_id" ON "event_category_assignments" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_category_assignments_event_category_unique_pg" ON "event_category_assignments" USING btree ("event_id","category_id");--> statement-breakpoint
CREATE INDEX "idx_event_locations_event_id" ON "event_locations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_owners_event_id" ON "event_owners" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_owners_member_id" ON "event_owners" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_owners_event_member_unique_pg" ON "event_owners" USING btree ("event_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_event_reg_field_values_registration_id" ON "event_registration_field_values" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "idx_event_reg_field_values_field_id" ON "event_registration_field_values" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "idx_event_registration_fields_event_id" ON "event_registration_fields" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_registration_members_registration_id" ON "event_registration_members" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "idx_event_registrations_event_id" ON "event_registrations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_registrations_member_id" ON "event_registrations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_event_registrations_status" ON "event_registrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_event_special_links_event_id" ON "event_special_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_special_links_token_unique_pg" ON "event_special_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_event_timespans_event_id" ON "event_timespans" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_timespans_start_dt" ON "event_timespans" USING btree ("start_dt");--> statement-breakpoint
CREATE INDEX "idx_event_tournament_roster_team_id" ON "event_tournament_roster_slots" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_tournament_roster_team_slot_unique_pg" ON "event_tournament_roster_slots" USING btree ("team_id","slot_code");--> statement-breakpoint
CREATE INDEX "idx_event_tournament_teams_event_id" ON "event_tournament_teams" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_unique_pg" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_events_published" ON "events" USING btree ("published");--> statement-breakpoint
CREATE INDEX "idx_events_visibility" ON "events" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_feedback_created_at" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_feedback_member_id" ON "feedback" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_feedback_category" ON "feedback" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key_unique" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "idx_files_visibility" ON "files" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "idx_files_uploaded_by_member_id" ON "files" USING btree ("uploaded_by_member_id");--> statement-breakpoint
CREATE INDEX "idx_files_created_at" ON "files" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_files_suspected_orphan" ON "files" USING btree ("suspected_orphan");--> statement-breakpoint
CREATE INDEX "idx_financial_assistance_requests_registration_id" ON "financial_assistance_requests" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "idx_game_lineups_game_id" ON "game_lineups" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "idx_game_lineups_team_id" ON "game_lineups" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_game_lineups_member_id" ON "game_lineups" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_game_lineups_member_stats" ON "game_lineups" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_game_results_game_id" ON "game_results" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "idx_game_results_team_id" ON "game_results" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_game_results_game_team" ON "game_results" USING btree ("game_id","team_id");--> statement-breakpoint
CREATE INDEX "idx_games_league_id" ON "games" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_games_team1_id" ON "games" USING btree ("team1_id");--> statement-breakpoint
CREATE INDEX "idx_games_team2_id" ON "games" USING btree ("team2_id");--> statement-breakpoint
CREATE INDEX "idx_games_sheet_id" ON "games" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "idx_games_league_date_time" ON "games" USING btree ("league_id","game_date","game_time");--> statement-breakpoint
CREATE UNIQUE INDEX "games_sheet_date_time_unique" ON "games" USING btree ("sheet_id","game_date","game_time");--> statement-breakpoint
CREATE INDEX "idx_governance_board_member_committees_board_member_id" ON "governance_board_member_committees" USING btree ("board_member_id");--> statement-breakpoint
CREATE INDEX "idx_governance_board_member_committees_committee_id" ON "governance_board_member_committees" USING btree ("committee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "governance_board_member_committees_board_member_id_committee_id_unique" ON "governance_board_member_committees" USING btree ("board_member_id","committee_id");--> statement-breakpoint
CREATE INDEX "idx_governance_board_members_member_id" ON "governance_board_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "governance_board_members_member_id_unique" ON "governance_board_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_governance_committee_chairs_committee_id" ON "governance_committee_chairs" USING btree ("committee_id");--> statement-breakpoint
CREATE INDEX "idx_governance_committee_chairs_member_id" ON "governance_committee_chairs" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "governance_committee_chairs_committee_id_member_id_unique" ON "governance_committee_chairs" USING btree ("committee_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "governance_committees_name_unique" ON "governance_committees" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_governance_committees_liaison_id" ON "governance_committees" USING btree ("board_liaison_board_member_id");--> statement-breakpoint
CREATE INDEX "idx_governance_committees_sort_order" ON "governance_committees" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "governance_officers_position_unique" ON "governance_officers" USING btree ("position");--> statement-breakpoint
CREATE UNIQUE INDEX "governance_officers_board_member_id_unique" ON "governance_officers" USING btree ("board_member_id");--> statement-breakpoint
CREATE INDEX "idx_governance_officers_board_member_id" ON "governance_officers" USING btree ("board_member_id");--> statement-breakpoint
CREATE INDEX "idx_ice_bookings_member_id" ON "ice_bookings" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_ice_bookings_sheet_id" ON "ice_bookings" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "idx_ice_bookings_sheet_range" ON "ice_bookings" USING btree ("sheet_id","start_dt","end_dt");--> statement-breakpoint
CREATE INDEX "idx_league_divisions_league_id" ON "league_divisions" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_league_divisions_league_id_sort" ON "league_divisions" USING btree ("league_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "league_divisions_league_id_name_unique" ON "league_divisions" USING btree ("league_id","name");--> statement-breakpoint
CREATE INDEX "idx_league_draw_times_league_id" ON "league_draw_times" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_league_exceptions_league_id" ON "league_exceptions" USING btree ("league_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_exceptions_league_id_exception_date_unique" ON "league_exceptions" USING btree ("league_id","exception_date");--> statement-breakpoint
CREATE INDEX "idx_league_extra_draws_league_id" ON "league_extra_draws" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_league_extra_draws_date_time" ON "league_extra_draws" USING btree ("league_id","draw_date","draw_time");--> statement-breakpoint
CREATE UNIQUE INDEX "league_extra_draws_league_id_date_time_unique" ON "league_extra_draws" USING btree ("league_id","draw_date","draw_time");--> statement-breakpoint
CREATE INDEX "idx_league_member_roles_member_id" ON "league_member_roles" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_league_member_roles_league_id" ON "league_member_roles" USING btree ("league_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_member_roles_member_id_league_id_role_unique" ON "league_member_roles" USING btree ("member_id","league_id","role");--> statement-breakpoint
CREATE INDEX "idx_league_roster_league_id" ON "league_roster" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_league_roster_member_id" ON "league_roster" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_roster_league_id_member_id_unique" ON "league_roster" USING btree ("league_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_league_settings_league_id" ON "league_settings" USING btree ("league_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_settings_league_id_unique" ON "league_settings" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_league_teams_league_id" ON "league_teams" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_league_teams_division_id" ON "league_teams" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "idx_leagues_session_id" ON "leagues" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_leagues_predecessor_league_id" ON "leagues" USING btree ("predecessor_league_id");--> statement-breakpoint
CREATE INDEX "idx_leagues_successor_league_id" ON "leagues" USING btree ("successor_league_id");--> statement-breakpoint
CREATE INDEX "idx_leagues_league_type" ON "leagues" USING btree ("league_type");--> statement-breakpoint
CREATE UNIQUE INDEX "member_account_access_grantor_grantee_unique" ON "member_account_access_delegations" USING btree ("grantor_member_id","grantee_member_id");--> statement-breakpoint
CREATE INDEX "idx_member_account_access_delegations_grantee" ON "member_account_access_delegations" USING btree ("grantee_member_id");--> statement-breakpoint
CREATE INDEX "idx_member_availability_member_id" ON "member_availability" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_member_availability_league_id" ON "member_availability" USING btree ("league_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_availability_member_id_league_id_unique" ON "member_availability" USING btree ("member_id","league_id");--> statement-breakpoint
CREATE INDEX "idx_member_role_assignments_member_id" ON "member_role_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_member_role_assignments_role_id" ON "member_role_assignments" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_member_role_assignments_resource" ON "member_role_assignments" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_role_assignments_member_role_resource_unique" ON "member_role_assignments" USING btree ("member_id","role_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_members_email" ON "members" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_members_phone" ON "members" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_menu_items_menu_type" ON "menu_items" USING btree ("menu_type");--> statement-breakpoint
CREATE INDEX "idx_menu_items_parent_id" ON "menu_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_menu_items_sort_order" ON "menu_items" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "idx_menu_items_article_id" ON "menu_items" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "idx_observability_events_created_at" ON "observability_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_observability_events_event_type" ON "observability_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_observability_events_member_id" ON "observability_events" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_unique" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_order_id" ON "payment_events" USING btree ("payment_order_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_processing_status" ON "payment_events" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_status" ON "payment_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_orders_subject" ON "payment_orders" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_provider_provider_order_id_unique" ON "payment_orders" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "idx_payment_transactions_order_id" ON "payment_transactions" USING btree ("payment_order_id");--> statement-breakpoint
CREATE INDEX "idx_payment_transactions_status" ON "payment_transactions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_provider_transaction_id_unique" ON "payment_transactions" USING btree ("provider","provider_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_permalink_hits_permalink_id" ON "permalink_hits" USING btree ("permalink_id");--> statement-breakpoint
CREATE INDEX "idx_permalink_hits_occurred_at" ON "permalink_hits" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_permalinks_slug" ON "permalinks" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_refunds_order_id" ON "refunds" USING btree ("payment_order_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_status" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_refund_id_unique" ON "refunds" USING btree ("provider","provider_refund_id");--> statement-breakpoint
CREATE INDEX "idx_registration_invoice_line_items_invoice_id" ON "registration_invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_registration_invoices_registration_id" ON "registration_invoices" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "idx_registration_invoices_payer_member_id" ON "registration_invoices" USING btree ("payer_member_id");--> statement-breakpoint
CREATE INDEX "idx_registration_invoices_status" ON "registration_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_registration_invoices_stripe_checkout_session_id" ON "registration_invoices" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX "idx_registration_outbound_messages_registration_created" ON "registration_outbound_messages" USING btree ("registration_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_registration_outbound_messages_waitlist_offer" ON "registration_outbound_messages" USING btree ("waitlist_offer_id");--> statement-breakpoint
CREATE INDEX "idx_registration_outbound_messages_waitlist_entry" ON "registration_outbound_messages" USING btree ("waitlist_entry_id");--> statement-breakpoint
CREATE INDEX "idx_registration_outbound_messages_recipient_member" ON "registration_outbound_messages" USING btree ("recipient_member_id");--> statement-breakpoint
CREATE INDEX "idx_registration_outbound_messages_delivery_status" ON "registration_outbound_messages" USING btree ("delivery_status");--> statement-breakpoint
CREATE INDEX "idx_registration_outbound_messages_type" ON "registration_outbound_messages" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX "idx_registration_policy_acceptances_registration_id" ON "registration_policy_acceptances" USING btree ("registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_policy_acceptances_registration_policy_unique" ON "registration_policy_acceptances" USING btree ("registration_id","policy_type");--> statement-breakpoint
CREATE INDEX "idx_registration_selections_registration_id" ON "registration_selections" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "idx_registration_selections_league_id" ON "registration_selections" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_registration_selections_selection_type" ON "registration_selections" USING btree ("selection_type");--> statement-breakpoint
CREATE INDEX "idx_registration_selections_status" ON "registration_selections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_registration_state_transitions_season_id" ON "registration_state_transitions" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "idx_registration_state_transitions_session_id" ON "registration_state_transitions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_registration_state_transitions_lookup" ON "registration_state_transitions" USING btree ("season_id","session_id","effective_at");--> statement-breakpoint
CREATE INDEX "idx_role_scope_rules_role_id" ON "role_scope_rules" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_role_scope_rules_scope" ON "role_scope_rules" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_rules_role_id_scope_unique" ON "role_scope_rules" USING btree ("role_id","scope");--> statement-breakpoint
CREATE INDEX "idx_roles_code" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_roles_is_system" ON "roles" USING btree ("is_system");--> statement-breakpoint
CREATE INDEX "idx_season_memberships_member_id" ON "season_memberships" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_season_memberships_season_id" ON "season_memberships" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sheets_name_unique" ON "sheets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_sheets_is_active" ON "sheets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_sheets_sort_order" ON "sheets" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "idx_showcase_images_sort_order" ON "showcase_images" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "idx_spare_request_ccs_request_id" ON "spare_request_ccs" USING btree ("spare_request_id");--> statement-breakpoint
CREATE INDEX "idx_spare_request_ccs_member_id" ON "spare_request_ccs" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spare_request_ccs_spare_request_id_member_id_unique" ON "spare_request_ccs" USING btree ("spare_request_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_spare_request_invitations_request_id" ON "spare_request_invitations" USING btree ("spare_request_id");--> statement-breakpoint
CREATE INDEX "idx_spare_request_invitations_member_id" ON "spare_request_invitations" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spare_request_invitations_spare_request_id_member_id_unique" ON "spare_request_invitations" USING btree ("spare_request_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_spare_request_notification_deliveries_req" ON "spare_request_notification_deliveries" USING btree ("spare_request_id");--> statement-breakpoint
CREATE INDEX "idx_spare_request_notification_deliveries_member" ON "spare_request_notification_deliveries" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_spare_request_notification_deliveries_claimed" ON "spare_request_notification_deliveries" USING btree ("spare_request_id","claimed_at");--> statement-breakpoint
CREATE INDEX "idx_spare_request_notification_deliveries_sent" ON "spare_request_notification_deliveries" USING btree ("spare_request_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spare_request_notification_deliveries_unique_key" ON "spare_request_notification_deliveries" USING btree ("spare_request_id","member_id","notification_generation","channel","kind");--> statement-breakpoint
CREATE INDEX "idx_notification_queue_request_id" ON "spare_request_notification_queue" USING btree ("spare_request_id");--> statement-breakpoint
CREATE INDEX "idx_notification_queue_order" ON "spare_request_notification_queue" USING btree ("spare_request_id","queue_order");--> statement-breakpoint
CREATE INDEX "idx_notification_queue_notified" ON "spare_request_notification_queue" USING btree ("spare_request_id","notified_at");--> statement-breakpoint
CREATE INDEX "idx_notification_queue_claimed" ON "spare_request_notification_queue" USING btree ("spare_request_id","claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spare_request_notification_queue_spare_request_id_member_id_unique" ON "spare_request_notification_queue" USING btree ("spare_request_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_spare_requests_requester_id" ON "spare_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_spare_requests_requested_for_member_id" ON "spare_requests" USING btree ("requested_for_member_id");--> statement-breakpoint
CREATE INDEX "idx_spare_requests_cancelled_by_member_id" ON "spare_requests" USING btree ("cancelled_by_member_id");--> statement-breakpoint
CREATE INDEX "idx_spare_requests_league_id" ON "spare_requests" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_spare_requests_game_id" ON "spare_requests" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "idx_spare_requests_game_date" ON "spare_requests" USING btree ("game_date");--> statement-breakpoint
CREATE INDEX "idx_spare_requests_status" ON "spare_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_spare_responses_request_id" ON "spare_responses" USING btree ("spare_request_id");--> statement-breakpoint
CREATE INDEX "idx_spare_responses_member_id" ON "spare_responses" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spare_responses_spare_request_id_member_id_unique" ON "spare_responses" USING btree ("spare_request_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_sponsors_name" ON "sponsors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_sponsorship_levels_sort_order" ON "sponsorship_levels" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsorship_levels_name_unique" ON "sponsorship_levels" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_sponsorships_sponsor_id" ON "sponsorships" USING btree ("sponsor_id");--> statement-breakpoint
CREATE INDEX "idx_sponsorships_sponsorship_level_id" ON "sponsorships" USING btree ("sponsorship_level_id");--> statement-breakpoint
CREATE INDEX "idx_sponsorships_dates" ON "sponsorships" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_team_bye_requests_team_id" ON "team_bye_requests" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_team_bye_requests_draw_date" ON "team_bye_requests" USING btree ("draw_date");--> statement-breakpoint
CREATE INDEX "idx_team_members_team_id" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_member_id" ON "team_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_id_member_id_unique" ON "team_members" USING btree ("team_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_audit_events_waitlist_entry_id" ON "waitlist_audit_events" USING btree ("waitlist_entry_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_audit_events_league_id" ON "waitlist_audit_events" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_audit_events_member_id" ON "waitlist_audit_events" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_audit_events_actor_member_id" ON "waitlist_audit_events" USING btree ("actor_member_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_audit_events_created_at" ON "waitlist_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_waitlist_audit_events_action" ON "waitlist_audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_waitlist_entries_league_id" ON "waitlist_entries" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_entries_member_id" ON "waitlist_entries" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_entries_status" ON "waitlist_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_waitlist_entries_entry_type" ON "waitlist_entries" USING btree ("entry_type");--> statement-breakpoint
CREATE INDEX "idx_waitlist_entries_position_sort_key" ON "waitlist_entries" USING btree ("position_sort_key");--> statement-breakpoint
CREATE INDEX "idx_waitlist_entries_joined_at" ON "waitlist_entries" USING btree ("joined_at");--> statement-breakpoint
CREATE INDEX "idx_waitlist_entries_source_registration_id" ON "waitlist_entries" USING btree ("source_registration_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_entries_replaces_league_id" ON "waitlist_entries" USING btree ("replaces_league_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_waitlist_entries_active_member_league" ON "waitlist_entries" USING btree ("member_id","league_id") WHERE "waitlist_entries"."status" = $1;--> statement-breakpoint
CREATE INDEX "idx_waitlist_offers_waitlist_entry_id" ON "waitlist_offers" USING btree ("waitlist_entry_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_offers_league_id" ON "waitlist_offers" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_offers_member_id" ON "waitlist_offers" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_offers_status" ON "waitlist_offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_waitlist_offers_expires_at" ON "waitlist_offers" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_waitlist_offers_response_token" ON "waitlist_offers" USING btree ("response_token");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_webhook_id" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_created_at" ON "webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_webhooks_event_type" ON "webhooks" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_webhooks_enabled" ON "webhooks" USING btree ("enabled");