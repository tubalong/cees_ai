ALTER TABLE "conversation_messages"
    ADD COLUMN "connector_contexts" JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "conversation_messages"."connector_contexts" IS 'Desktop 本地连接器提供的本轮只读上下文，不作为业务事实或写操作权限依据';
