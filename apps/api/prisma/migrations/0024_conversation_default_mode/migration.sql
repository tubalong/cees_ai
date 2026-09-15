-- 会话默认对话执行模式：conversations 增加 mode 列，
-- 发起轮次未显式指定 mode 时使用；存量会话回填 standard。
ALTER TABLE "conversations"
    ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN "conversations"."mode" IS '会话默认对话执行模式（standard 快速 / ultra 深度）；发起轮次未显式指定时使用';
