-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN "document_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
