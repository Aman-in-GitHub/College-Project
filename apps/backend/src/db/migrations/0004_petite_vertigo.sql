ALTER TABLE "audit_logs" ADD COLUMN "category" text DEFAULT 'data' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "status" text DEFAULT 'success' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "target_type" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "target_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "target_user_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "target_department_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "changes" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_department_id_departments_id_fk" FOREIGN KEY ("target_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_category_created_at_idx" ON "audit_logs" USING btree ("category","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_status_created_at_idx" ON "audit_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_department_id_created_at_idx" ON "audit_logs" USING btree ("target_department_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_user_id_created_at_idx" ON "audit_logs" USING btree ("target_user_id","created_at");