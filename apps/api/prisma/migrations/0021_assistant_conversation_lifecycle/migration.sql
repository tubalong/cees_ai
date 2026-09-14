-- Conversation title updates and soft deletion use the same optimistic-lock
-- convention as the other mutable CEES business resources.
ALTER TABLE "conversations"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
