-- AlterEnum
ALTER TYPE "FilePurpose" ADD VALUE 'GENERATED_DOCUMENT';

-- AlterTable
ALTER TABLE "managed_documents" ADD COLUMN "file_object_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "managed_documents_file_object_id_key" ON "managed_documents"("file_object_id");

-- AddForeignKey
ALTER TABLE "managed_documents" ADD CONSTRAINT "managed_documents_file_object_id_fkey" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
