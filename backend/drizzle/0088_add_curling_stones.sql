CREATE TABLE IF NOT EXISTS "curling_stones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_stones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"wcf_registration_number" text NOT NULL,
	"al_serial_number" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "curling_stones_wcf_registration_number_unique" ON "curling_stones" ("wcf_registration_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "curling_stones_al_serial_number_unique" ON "curling_stones" ("al_serial_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "curling_stone_placements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_stone_placements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stone_id" integer NOT NULL,
	"sheet" text,
	"color" text,
	"rock_number" integer,
	"side" text NOT NULL,
	"effective_date" date NOT NULL,
	"change_type" text NOT NULL,
	"related_stone_id" integer,
	"notes" text,
	"created_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "curling_stone_placements_stone_id_curling_stones_id_fk" FOREIGN KEY ("stone_id") REFERENCES "public"."curling_stones"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "curling_stone_placements_related_stone_id_curling_stones_id_fk" FOREIGN KEY ("related_stone_id") REFERENCES "public"."curling_stones"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "curling_stone_placements_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_curling_stone_placements_stone_id" ON "curling_stone_placements" ("stone_id", "effective_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "curling_stone_maintenance" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "curling_stone_maintenance_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stone_id" integer NOT NULL,
	"activity_type" text NOT NULL,
	"side" text NOT NULL,
	"performed_on" date NOT NULL,
	"passes" integer,
	"rotations" integer,
	"sandpaper_grit" integer,
	"band_width_1_mm" double precision,
	"band_width_2_mm" double precision,
	"band_width_3_mm" double precision,
	"band_width_4_mm" double precision,
	"comments" text,
	"created_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "curling_stone_maintenance_stone_id_curling_stones_id_fk" FOREIGN KEY ("stone_id") REFERENCES "public"."curling_stones"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "curling_stone_maintenance_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_curling_stone_maintenance_stone_id" ON "curling_stone_maintenance" ("stone_id", "performed_on");
