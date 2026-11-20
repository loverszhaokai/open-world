ALTER TABLE "projects" ADD COLUMN "parent_project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_project_id_projects_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_parent_idx" ON "projects" USING btree ("company_id","parent_project_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_not_self" CHECK ("projects"."parent_project_id" is distinct from "projects"."id");