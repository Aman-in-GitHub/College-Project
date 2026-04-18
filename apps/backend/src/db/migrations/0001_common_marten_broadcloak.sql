CREATE TYPE "public"."department_role" AS ENUM('department_admin', 'department_staff');--> statement-breakpoint
CREATE TYPE "public"."global_role" AS ENUM('system_admin');--> statement-breakpoint
CREATE TYPE "public"."template_column_type" AS ENUM('text', 'integer', 'numeric', 'boolean', 'date', 'time', 'timestamp');--> statement-breakpoint
CREATE TABLE "department_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "department_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"template_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"department_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_columns" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"column_key" text NOT NULL,
	"name" text NOT NULL,
	"column_type" "template_column_type" NOT NULL,
	"position" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_searchable" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_global_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" "global_role" NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_rows" ADD CONSTRAINT "table_rows_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_rows" ADD CONSTRAINT "table_rows_template_id_table_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."table_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_rows" ADD CONSTRAINT "table_rows_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_rows" ADD CONSTRAINT "table_rows_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_templates" ADD CONSTRAINT "table_templates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_templates" ADD CONSTRAINT "table_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_templates" ADD CONSTRAINT "table_templates_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_columns" ADD CONSTRAINT "template_columns_template_id_table_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."table_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_global_roles" ADD CONSTRAINT "user_global_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_global_roles" ADD CONSTRAINT "user_global_roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_memberships_department_user_unique_idx" ON "department_memberships" USING btree ("department_id","user_id");--> statement-breakpoint
CREATE INDEX "department_memberships_user_id_idx" ON "department_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "department_memberships_department_id_idx" ON "department_memberships" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_slug_unique_idx" ON "departments" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "departments_is_active_idx" ON "departments" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "table_rows_department_id_idx" ON "table_rows" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "table_rows_template_id_idx" ON "table_rows" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "table_rows_created_at_idx" ON "table_rows" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "table_templates_department_slug_unique_idx" ON "table_templates" USING btree ("department_id","slug");--> statement-breakpoint
CREATE INDEX "table_templates_department_id_idx" ON "table_templates" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_columns_template_column_key_unique_idx" ON "template_columns" USING btree ("template_id","column_key");--> statement-breakpoint
CREATE UNIQUE INDEX "template_columns_template_position_unique_idx" ON "template_columns" USING btree ("template_id","position");--> statement-breakpoint
CREATE INDEX "template_columns_template_id_idx" ON "template_columns" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_global_roles_user_id_role_unique_idx" ON "user_global_roles" USING btree ("user_id","role");--> statement-breakpoint
CREATE INDEX "user_global_roles_user_id_idx" ON "user_global_roles" USING btree ("user_id");