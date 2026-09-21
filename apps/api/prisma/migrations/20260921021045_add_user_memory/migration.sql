-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('PREFERENCE', 'FACT', 'DECISION', 'HABIT');

-- CreateTable
CREATE TABLE "user_memories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "type" "MemoryType" NOT NULL,
    "content" TEXT NOT NULL,
    "source_conversation_id" UUID,
    "source_turn_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_memories_tenant_id_membership_id_deleted_at_idx" ON "user_memories"("tenant_id", "membership_id", "deleted_at");
