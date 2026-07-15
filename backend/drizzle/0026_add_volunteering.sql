CREATE TABLE IF NOT EXISTS "volunteer_programs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_programs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"description" text,
	"point_of_contact" text NOT NULL,
	"location" text,
	"created_by_member_id" integer,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_credentials" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_credentials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"description" text,
	"point_of_contact_email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_program_managers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_program_managers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"program_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_credential_managers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_credential_managers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"credential_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"program_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_role_credentials" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_role_credentials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"role_id" integer NOT NULL,
	"credential_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_volunteer_credentials" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_volunteer_credentials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"credential_id" integer NOT NULL,
	"granted_by_member_id" integer,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_shifts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_shifts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"program_id" integer NOT NULL,
	"start_dt" text NOT NULL,
	"end_dt" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_shift_roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_shift_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"shift_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"volunteers_needed" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_signups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_signups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"shift_role_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"cancelled_at" timestamp,
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_programs_created_by" ON "volunteer_programs" USING btree ("created_by_member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_programs_archived_at" ON "volunteer_programs" USING btree ("archived_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_program_managers_program_id" ON "volunteer_program_managers" USING btree ("program_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_program_managers_member_id" ON "volunteer_program_managers" USING btree ("member_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_program_managers_program_member_unique_pg" ON "volunteer_program_managers" USING btree ("program_id","member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_credential_managers_credential_id" ON "volunteer_credential_managers" USING btree ("credential_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_credential_managers_member_id" ON "volunteer_credential_managers" USING btree ("member_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_credential_managers_credential_member_unique_pg" ON "volunteer_credential_managers" USING btree ("credential_id","member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_roles_program_id" ON "volunteer_roles" USING btree ("program_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_role_credentials_role_id" ON "volunteer_role_credentials" USING btree ("role_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_role_credentials_credential_id" ON "volunteer_role_credentials" USING btree ("credential_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_role_credentials_role_credential_unique_pg" ON "volunteer_role_credentials" USING btree ("role_id","credential_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_member_volunteer_credentials_member_id" ON "member_volunteer_credentials" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_member_volunteer_credentials_credential_id" ON "member_volunteer_credentials" USING btree ("credential_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_volunteer_credentials_member_credential_unique_pg" ON "member_volunteer_credentials" USING btree ("member_id","credential_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_shifts_program_id" ON "volunteer_shifts" USING btree ("program_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_shifts_start_dt" ON "volunteer_shifts" USING btree ("start_dt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_shift_roles_shift_id" ON "volunteer_shift_roles" USING btree ("shift_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_shift_roles_role_id" ON "volunteer_shift_roles" USING btree ("role_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_shift_roles_shift_role_unique_pg" ON "volunteer_shift_roles" USING btree ("shift_id","role_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_signups_shift_role_id" ON "volunteer_signups" USING btree ("shift_role_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_signups_member_id" ON "volunteer_signups" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_signups_status" ON "volunteer_signups" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_signups_shift_role_member_unique_pg" ON "volunteer_signups" USING btree ("shift_role_id","member_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_programs" ADD CONSTRAINT "volunteer_programs_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_program_managers" ADD CONSTRAINT "volunteer_program_managers_program_id_volunteer_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."volunteer_programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_program_managers" ADD CONSTRAINT "volunteer_program_managers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_credential_managers" ADD CONSTRAINT "volunteer_credential_managers_credential_id_volunteer_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."volunteer_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_credential_managers" ADD CONSTRAINT "volunteer_credential_managers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_roles" ADD CONSTRAINT "volunteer_roles_program_id_volunteer_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."volunteer_programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_role_credentials" ADD CONSTRAINT "volunteer_role_credentials_role_id_volunteer_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."volunteer_roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_role_credentials" ADD CONSTRAINT "volunteer_role_credentials_credential_id_volunteer_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."volunteer_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_volunteer_credentials" ADD CONSTRAINT "member_volunteer_credentials_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_volunteer_credentials" ADD CONSTRAINT "member_volunteer_credentials_credential_id_volunteer_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."volunteer_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_volunteer_credentials" ADD CONSTRAINT "member_volunteer_credentials_granted_by_member_id_members_id_fk" FOREIGN KEY ("granted_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_shifts" ADD CONSTRAINT "volunteer_shifts_program_id_volunteer_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."volunteer_programs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_shift_roles" ADD CONSTRAINT "volunteer_shift_roles_shift_id_volunteer_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."volunteer_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_shift_roles" ADD CONSTRAINT "volunteer_shift_roles_role_id_volunteer_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."volunteer_roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_signups" ADD CONSTRAINT "volunteer_signups_shift_role_id_volunteer_shift_roles_id_fk" FOREIGN KEY ("shift_role_id") REFERENCES "public"."volunteer_shift_roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_signups" ADD CONSTRAINT "volunteer_signups_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
