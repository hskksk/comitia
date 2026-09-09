ALTER TABLE "memories" ADD COLUMN "layer" text DEFAULT 'episodic' NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "norm_reviewed_at" timestamp with time zone;