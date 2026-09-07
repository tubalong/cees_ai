-- Enable the vector type required by document_chunks on PostgreSQL images with pgvector installed.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "public"."TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."VisibilityScope" AS ENUM ('PRIVATE', 'DEPARTMENT', 'PROJECT', 'TENANT', 'CUSTOM');

-- AlterTable
ALTER TABLE "public"."tenants" ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "status" "public"."TenantStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "normalized_email" TEXT NOT NULL,
ADD COLUMN     "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "public"."auth_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_name" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_chunks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "department_id" UUID,
    "project_id" UUID,
    "visibility_scope" "public"."VisibilityScope" NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector NOT NULL,
    "metadata" JSONB NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "file_object_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "file_object_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "department_id" UUID,
    "project_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_base_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_base_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_bases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_query_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "answer" TEXT,
    "citations" JSONB,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."meeting_minutes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "meeting_minutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."meeting_participants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."meetings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "department_id" UUID,
    "agenda" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."work_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "report_type" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "content" JSONB NOT NULL,
    "source_draft_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "work_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "public"."auth_sessions"("expires_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "public"."auth_sessions"("refresh_token_hash" ASC);

-- CreateIndex
CREATE INDEX "auth_sessions_tenant_id_user_id_idx" ON "public"."auth_sessions"("tenant_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "document_chunks_tenant_id_knowledge_base_id_document_id_idx" ON "public"."document_chunks"("tenant_id" ASC, "knowledge_base_id" ASC, "document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_tenant_id_document_id_version_number_key" ON "public"."document_versions"("tenant_id" ASC, "document_id" ASC, "version_number" ASC);

-- CreateIndex
CREATE INDEX "documents_tenant_id_knowledge_base_id_idx" ON "public"."documents"("tenant_id" ASC, "knowledge_base_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_base_members_tenant_id_knowledge_base_id_user_id_key" ON "public"."knowledge_base_members"("tenant_id" ASC, "knowledge_base_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "knowledge_bases_tenant_id_idx" ON "public"."knowledge_bases"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "knowledge_query_logs_tenant_id_user_id_created_at_idx" ON "public"."knowledge_query_logs"("tenant_id" ASC, "user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "meeting_minutes_tenant_id_meeting_id_idx" ON "public"."meeting_minutes"("tenant_id" ASC, "meeting_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_tenant_id_meeting_id_user_id_key" ON "public"."meeting_participants"("tenant_id" ASC, "meeting_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "meetings_tenant_id_starts_at_idx" ON "public"."meetings"("tenant_id" ASC, "starts_at" ASC);

-- CreateIndex
CREATE INDEX "work_reports_tenant_id_user_id_report_date_idx" ON "public"."work_reports"("tenant_id" ASC, "user_id" ASC, "report_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "public"."tenants"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_normalized_email_key" ON "public"."users"("tenant_id" ASC, "normalized_email" ASC);

-- AddForeignKey
ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
