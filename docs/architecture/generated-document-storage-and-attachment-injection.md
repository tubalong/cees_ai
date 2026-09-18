# 生成文档落 COS 与附件注入实现说明

> 状态：已实现（2026-09-16）
> 关联：`docs/architecture/pdf-pptx-generation.md`、`docs/architecture/document-generation.md`、`docs/architecture/assistant-tool-loop.md`
> 范围：`apps/api`（NestJS）+ `packages/contracts` + Prisma 迁移

本文记录两个任务的实现：

1. **任务一**：`generate_docx` / `generate_pdf` / `generate_pptx` 生成后把文件字节直接上传 COS 并落 `FileObject`，而非仅在导出时才渲染。
2. **任务二**：对话轮次支持引用已上传文档文件，抽取文本注入对话上下文。

---

## 1. 任务一：生成文档落 COS

### 1.1 数据模型（Prisma 迁移 `0028_generated_document_file`）

- `FilePurpose` 新增枚举值 `GENERATED_DOCUMENT`。
- `ManagedDocument` 新增 `fileObjectId`（可空、唯一）+ `fileObject FileObject?` 关联。
- `FileObject` 新增 `managedDocuments ManagedDocument[]` 反向关联。

```prisma
enum FilePurpose {
  ATTACHMENT
  GENERATED_IMAGE
  GENERATED_DOCUMENT
}

model ManagedDocument {
  // ...
  fileObjectId String?     @unique @map("file_object_id") @db.Uuid
  fileObject   FileObject? @relation(fields: [fileObjectId], references: [id], onDelete: Restrict)
}
```

### 1.2 对象键

`CosObjectKeyFactory.buildGeneratedDocumentKey({ tenantId, toolCallId, format })` 生成确定性键：

```
cees/{env}/tenants/{tenantId}/generated-documents/{toolCallId}/{format}
```

与图片生成同策略：相同 `toolCallId + format` 的重试/恢复始终覆盖同一对象，避免无限孤儿对象。

### 1.3 落库链路

`DocumentService` 注入 `StorageProvider` / `StorageSettings` / `CosObjectKeyFactory`（`DocumentModule` 引入 `StorageModule`）。

`createGeneratedDocument` 在 compose 后、事务提交前：

1. `renderDocumentBytes(document, command)` 按 `command.format` 调 `renderDocumentDocx/Pdf/Pptx` 渲染文件字节。
2. `storage.putObject` 上传 COS。
3. 事务内 `fileObject.create`（`purpose: GENERATED_DOCUMENT`）并给 `managedDocument` 关联 `fileObjectId`。

**降级策略**：渲染/上传失败不阻断生成，文档仍以 Markdown + DocumentSpec 落库，可稍后在文档库导出。`GenerateDocumentCommand` 新增 `format: 'docx' | 'pdf' | 'pptx'`，由三个工具执行器各自传入。

---

## 2. 任务二：附件注入对话上下文

### 2.1 数据模型（Prisma 迁移 `0029_conversation_document_attachments`）

`ConversationMessage` 新增 `documentFileIds String[] @default([])`，与 `imageFileIds` 并列。

### 2.2 请求与传递链

- `CreateTurnRequestDto` 新增 `fileIds?: string[]`（文档文件，UUID，最多 8 个）。
- `TurnRunner.startTurn` 接收 `documentFileIds`，并入幂等 `requestHash` 与 `TurnState.createTurn` 落库。
- `ContextBuilder.toParts` 把历史消息的 `documentFileIds` 传给 `toModelParts`。

### 2.3 文本抽取

- `AiServiceGateway.extractFile(input)` 调 ai-service `/internal/v1/files/extract`（base64 字节 → `MessageContentPart[]`）。
- `AssistantMessageContentService.resolveDocumentParts`：
  1. 校验 `FileObject` 归属（`purpose: ATTACHMENT`、租户、`createdBy === userId`）。
  2. `storage.createDownloadUrl` 下载字节。
  3. `gateway.extractFile` 抽取文本。
  4. 结果并入 `toModelParts` 的文本 parts。

> 文档抽取由 ai-service 的 `extractFile` 完成，支持纯文本、Markdown、CSV、JSON、DOCX、PPTX、XLSX 与 best-effort PDF，不调用 LLM。

---

## 3. 迁移清单

| 迁移 | 内容 |
| --- | --- |
| `0028_generated_document_file` | `FilePurpose` + `managed_documents.file_object_id` + 外键/唯一索引 |
| `0029_conversation_document_attachments` | `conversation_messages.document_file_ids` |

> 说明：由于历史 schema 漂移导致 `prisma migrate dev` 交互卡住，本次两个迁移用 `prisma migrate diff --from-schema-datasource --to-schema-datamodel --script` 手动生成 SQL 后落地，仅取本次改动相关语句。

## 4. 验证

- API 编译：`tsc --noEmit` exit 0。
- 测试：`document.service.spec.ts` + `generate-document.tool.spec.ts` 共 15 项通过。
- `generate_docx` / `generate_pdf` / `generate_pptx` 三个工具正确注册。

## 5. 遗留 / 后续

- 生成文件字节的下载入口：`ManagedDocument` 已关联 `fileObjectId`，但公开下载端点（直接下载已落盘的 COS 文件，而非按需重渲染）尚未接线，可后续补充。
- 附件注入前端 UI（对话输入框选文档文件）尚未实现，后端链路已就绪。
