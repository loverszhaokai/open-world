CREATE TABLE "document_presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_revision_id" uuid NOT NULL,
	"attachment_id" uuid,
	"attachment_sha256" text,
	"kind" text DEFAULT 'html' NOT NULL,
	"version" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_presentations" ADD CONSTRAINT "document_presentations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_presentations" ADD CONSTRAINT "document_presentations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_presentations" ADD CONSTRAINT "document_presentations_document_revision_id_document_revisions_id_fk" FOREIGN KEY ("document_revision_id") REFERENCES "public"."document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_presentations" ADD CONSTRAINT "document_presentations_attachment_id_issue_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."issue_attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_presentations" ADD CONSTRAINT "document_presentations_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_presentations_revision_uq" ON "document_presentations" USING btree ("document_id","document_revision_id");--> statement-breakpoint
CREATE INDEX "document_presentations_attachment_idx" ON "document_presentations" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "document_presentations_company_idx" ON "document_presentations" USING btree ("company_id");