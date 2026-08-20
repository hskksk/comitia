ALTER TABLE "threads" ADD COLUMN "awaiting_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "timing_duration_hours" integer;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "timing_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "engine_diversity" text DEFAULT 'off' NOT NULL;