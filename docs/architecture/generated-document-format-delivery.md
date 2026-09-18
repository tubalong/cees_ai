# 生成文档格式交付说明

> 状态：已实现
> 范围：生成文档工具、文档详情契约、桌面端资源卡片
> 关联：`docs/architecture/generated-document-storage-and-attachment-injection.md`

## 1. 问题

生成 `generate_docx`、`generate_pdf` 或 `generate_pptx` 时，服务端会保存结构化 `DocumentSpec` 和 Markdown 内容。Markdown 是可重复编辑的事实源，但桌面端资源卡片此前没有保存生成格式，下载时固定把 Markdown 内容保存为 `.md`，因此用户请求 PPT 或 PDF 时看到的仍然是 Markdown 文档。

## 2. 实现

### 2.1 服务端契约

`DocumentDetail` 增加：

- `fileObjectId`：生成时落盘的正式文件 ID，落盘失败时为 `null`。
- `fileMimeType`：正式文件 MIME 类型，客户端据此恢复 `docx`、`pdf` 或 `pptx`。

服务端原有的 `DocumentService.toDetail` 已从关联 `FileObject` 返回这两个字段；本轮同步了 OpenAPI 3.1 契约和公开 API 客户端。

### 2.2 流式会话

桌面端在收到工具调用时识别以下工具：

- `generate_docx` → `docx`
- `generate_pdf` → `pdf`
- `generate_pptx` → `pptx`
- `generate_document` 保留为兼容旧数据，但不猜测其文件格式

工具结果生成的资源引用会携带格式元数据，当前会话无需额外请求即可显示正确的下载类型。

### 2.3 历史会话与文档详情

刷新或重新打开会话后，资源引用可能没有流式事件里的格式元数据。桌面端会请求文档详情，并根据 `fileMimeType` 恢复格式，因此历史生成的 PPTX/PDF/DOCX 仍能正确下载。

### 2.4 下载与编辑语义

- 文档预览和编辑继续使用 Markdown 内容。
- 有已知生成格式时，下载按钮调用 `exportDocument(documentId, format, preferredName)`，服务端按当前 `DocumentSpec` 渲染并返回正式文件。
- 没有生成格式的手工文档仍允许下载 Markdown。
- 编辑后再次下载会按最新 `DocumentSpec` 渲染，避免下载旧版本的 COS 文件。

### 2.5 导出文件命名

下载名必须是「用户要的主题」，而不是通用的 `document.pdf`/`presentation.pptx`：

1. **服务端解析标题**（`document.service.ts` 的 `resolveDocumentTitle`）：按「落库 `managed_documents.title` → `document_spec.title` → `document`」顺序取第一个可用值。历史上被误转码成 `??????` 之类占位符的标题会被清洗成空串，从而正确回退到 `DocumentSpec.title`。
2. **净化**（`sanitizeFilenameSegment`）：替换文件系统与响应头禁忌字符 `\ / : * ? " < > |` 及控制字符，折叠空白，去掉结尾的点（避免 Windows 隐藏文件与扩展名歧义），截断到 120 字符。
3. **响应头**（`document.controller.ts` 的 `attachmentDisposition`）：同时给出 ASCII 回退名 `filename="document.<ext>"` 与 RFC 5987 的 `filename*=UTF-8''<pct-encoded>`。编码走严格实现，额外编码 `!'()*`（`encodeURIComponent` 会漏掉它们，但它们不属于 RFC 5987 的 `attr-char`）。
4. **同源用于封面**：同一个标题同时作为 `document_options.title` 传给 ai-service，保证文件封面与文件名一致。
5. **跨域可读**：`apps/api/src/main.ts` 通过 CORS `exposedHeaders: ['Content-Disposition']` 暴露该头；否则浏览器读不到，客户端只能拿到 `null`。
6. **客户端兜底**：`apps/desktop/src/core/api.ts` 的 `resolveDownloadFilename` 优先用响应头，但识别到通用兜底名（`document.*`/`presentation.*`）或响应头不可读时，改用调用方已知的文档标题（`ChatResourceCard` 与文档列表都传入），因此桌面端始终下载到按主题命名的文件。

预览、编辑与下载的格式语义见 2.4；本轮的与文件名相关的验证见第 3 节。

这种设计同时满足在线重复编辑和正式格式交付：Markdown 不是 PPTX/PDF 的替代品，而是编辑中间层。

## 3. 验证

- `pnpm contracts:lint`：通过。
- 公开 API 客户端已重新生成。
- 桌面端 `pnpm exec tsc -p tsconfig.json`：通过。
- 需要继续用 API Jest 测试确认工具注册和执行结果未回归。
- `apps/api/src/document/document.service.spec.ts`：导出标题解析与净化（落库标题、`DocumentSpec.title` 回退、中性兜底名、非法字符净化）。
- `apps/api/src/document/document.controller.spec.ts`：三种格式的 `Content-Disposition` 编码、RFC 5987 保留字符补编码、Media Type 与字节长度透传。
- 端到端：登录既有租户后导出真实文档，`/export/pdf`、`/export`、`/export/pptx` 均返回带 `filename*=UTF-8''` 的附件名，落库标题为坏占位符时回退到 `导出格式自检.pdf`。
