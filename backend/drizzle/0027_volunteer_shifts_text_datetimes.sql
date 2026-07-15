ALTER TABLE "volunteer_shifts" ALTER COLUMN "start_dt" SET DATA TYPE text USING "start_dt"::text;
--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ALTER COLUMN "end_dt" SET DATA TYPE text USING "end_dt"::text;
