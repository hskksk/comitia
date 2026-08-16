CREATE TABLE "github_issue_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_number" integer NOT NULL,
	"board_thread_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_issue_intakes_project_id_issue_number_unique" UNIQUE("project_id","issue_number")
);
--> statement-breakpoint
CREATE TABLE "github_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "thread_pull_requests_project_id_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "github_user_id" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "github_login" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_installation_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_owner" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_repo" text;--> statement-breakpoint
ALTER TABLE "github_issue_intakes" ADD CONSTRAINT "github_issue_intakes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_intakes" ADD CONSTRAINT "github_issue_intakes_board_thread_id_threads_id_fk" FOREIGN KEY ("board_thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_pull_requests" ADD CONSTRAINT "thread_pull_requests_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_pull_requests" ADD CONSTRAINT "thread_pull_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_github_user_id_uidx" ON "participants" USING btree ("github_user_id");