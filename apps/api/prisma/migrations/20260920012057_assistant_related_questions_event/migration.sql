-- AlterEnum
ALTER TYPE "AssistantEventType" ADD VALUE 'RELATED_QUESTIONS';

-- RenameIndex
ALTER INDEX "legal_contract_status_history_tenant_id_contract_id_created_at_" RENAME TO "legal_contract_status_history_tenant_id_contract_id_created_idx";
