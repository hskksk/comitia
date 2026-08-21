CREATE TABLE "session_project_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_project_engagements_session_id_project_id_unique" UNIQUE("session_id","project_id")
);
--> statement-breakpoint
DROP INDEX "sessions_one_open_per_participant_project";--> statement-breakpoint
UPDATE "sessions" SET "ended_at" = now(), "ended_reason" = 'interrupted' WHERE "ended_at" IS NULL AND "id" NOT IN (SELECT "id" FROM (SELECT DISTINCT ON ("participant_id") "id" FROM "sessions" WHERE "ended_at" IS NULL ORDER BY "participant_id", "started_at" DESC) AS "kept");--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "handovers" ADD COLUMN "projects" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "focus_project_id" uuid;--> statement-breakpoint
ALTER TABLE "session_project_engagements" ADD CONSTRAINT "session_project_engagements_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_project_engagements" ADD CONSTRAINT "session_project_engagements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_focus_project_id_projects_id_fk" FOREIGN KEY ("focus_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_open_per_participant" ON "sessions" USING btree ("participant_id") WHERE "sessions"."ended_at" is null;