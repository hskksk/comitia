CREATE TABLE "session_trace_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"run" integer,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_trace_entries" ADD CONSTRAINT "session_trace_entries_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_trace_entries_session_seq" ON "session_trace_entries" USING btree ("session_id","seq");