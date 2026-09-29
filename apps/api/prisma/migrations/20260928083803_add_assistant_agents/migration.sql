-- CreateEnum
CREATE TYPE "AssistantAgentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "assistant_agents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "toolPolicy" JSONB NOT NULL DEFAULT '{}',
    "visibility" JSONB NOT NULL DEFAULT '{}',
    "budget" JSONB NOT NULL DEFAULT '{}',
    "status" "AssistantAgentStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "assistant_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_agents_tenant_id_status_deleted_at_idx" ON "assistant_agents"("tenant_id", "status", "deleted_at");
