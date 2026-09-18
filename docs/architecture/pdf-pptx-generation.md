# PDF 与 PPT 生成实现方案

> 状态：已实现（2026-09-16）
> 关联：`docs/architecture/document-generation.md`（DocumentSpec 与 DOCX/Markdown 生成）
> 范围：`apps/ai-service`（渲染器）+ `apps/api`（工具接线、落库、审计）+ `packages/contracts`（契约）

## 1. 背景与现状

现有文档生成链路已经收敛为「结构化中间表示 → 确定性渲染器」：

```
指令/素材 → DocumentComposer (LLM) → DocumentSpec → 渲染器 → 目标格式
```

| 目标格式 | 现状 | 渲染器 |
| --- | --- | --- |
| DOCX | ✅ 已完成 | `apps/ai-service/app/documents/docx_renderer.py`（`DocxRenderer`） |
| Markdown | ✅ 已完成 | `apps/api/src/document/document.service.ts`（`documentSpecToMarkdown`） |
| PDF | ❌ 缺失 | 无 |
| PPTX | ❌ 缺失 | 无（无 `PptxSpec`） |

`DocumentSpec` 已定义 6 种块：`paragraph` / `bullet_list` / `numbered_list` / `table` / `quote` / `page_break`，并带 `DocumentOptions`（`locale` / `template_id` / `include_toc` 等）。契约见 `packages/contracts/openapi/ai-service.openapi.yaml`。

本方案补齐 PDF 与 PPTX 两条渲染链路，并统一工具接线。

---

## 2. PDF 生成

### 2.1 目标

- `DocumentSpec` → PDF，**中文内嵌字体**，任何设备不丢字、不方块。
- 与 `render-docx` 对称：确定性渲染，不调用 LLM。

### 2.2 技术选型

- **reportlab**（纯 Python，无系统级字体/渲染依赖，适合 `python:3.14-slim` 容器）。
- 字体：内嵌开源中文字体 **Noto Sans SC（思源黑体）**，正文 + 标题各一个字重。

字体获取与打包（已确认：**构建时下载**）：

- Dockerfile / `uv` 脚本从 Google Fonts 或 GitHub 下载 `NotoSansSC-Regular.otf`、`NotoSansSC-Bold.otf`，放到 `apps/ai-service/config/fonts/`；`.gitignore` 排除字体，避免大二进制入库。
- **兜底**：下载失败时降级到 reportlab 内置 Adobe CID 字体 `UnicodeCIDFont('STSong-Light')`（零字体文件，绝大多数阅读器可渲染，但非真正内嵌），仅作降级。

### 2.3 实现步骤

1. **契约**（`packages/contracts`）：新增 `RenderPdfRequest`（与 `RenderDocxRequest` 同构），端点 `POST /internal/v1/documents/render-pdf`，响应 `application/pdf`。
2. **渲染器**（`apps/ai-service/app/documents/pdf_renderer.py`）：
   - `PdfRenderer.render(document: DocumentSpec, options: DocumentOptions) -> RenderedPdf`。
   - 复用 `validate_document_spec`；按 `sections → blocks` 逐块映射：标题（`heading` 层级）、段落、项目/编号列表、表格、引用、分页。
   - `_configure_fonts`：注册 Noto Sans SC 的 `TTFont`，中文 locale 用 CJK 字体，非中文用 Helvetica。
   - 页眉/页脚、页码、目录（`include_toc`）对齐 DOCX 的现有能力。
3. **端点**（`apps/ai-service/app/api/routes/documents.py`）：加 `render_pdf`，返回 `Response`，`content-disposition` 复用现有 `content_disposition` 逻辑。
4. **NestJS**：
   - `AiServiceGateway` 增加 `renderPdf`（对称 `renderDocx`）。
   - `DocumentService` 增加 `exportDocumentPdf`（对称 `exportDocumentDocx`），返回 `application/pdf` 字节。
5. **依赖**：`apps/ai-service/pyproject.toml` 增加 `reportlab`。

### 2.4 验收

- 中文文档渲染 PDF 后，在 Chrome / Adobe / Preview / WPS 打开均无「豆腐块」。
- PDF 文件内字体为嵌入子集（用 `pdffonts` 或阅读器「文档属性 → 字体」验证）。
- `render-pdf` 与 `render-docx` 对同一 `DocumentSpec` 输出的结构一致（标题层级、列表、表格）。

---

## 3. PPT 生成

### 3.1 目标

- 新增 `PptxSpec`（幻灯片结构化规范）+ `PptxRenderer`，把结构化内容生成 PPTX。

### 3.2 PptxSpec 设计（契约新增）

与 `DocumentSpec` 不同，PPT 是「幻灯片集合」，需要独立 schema：

```yaml
PptxSpec:
  schema_version: "1.0"
  title: string                 # 演示文稿标题
  subtitle: string | null
  theme: enum[brand, neutral]   # 配色主题，默认 brand
  slides: PptxSlide[]           # 1..100 页

PptxSlide:
  title: string                 # 单页标题
  layout: enum[title, title_and_content, section_header, two_column, blank]
  blocks: PptxBlock[]           # 1..50 块

PptxBlock (oneOf, discriminator: type):
  - paragraph   { text }
  - bullet_list { items[] }
  - numbered_list { items[] }
  - table       { columns[], rows[][] }
  - quote       { text, attribution? }
  - image       { url, alt?, caption? }   # 仅接受 COS URL；用户上传图片需先存 COS，再以 URL 注入
```

### 3.3 技术选型

- **python-pptx**（纯 Python，官方库）。
- 中文：PPTX 是 OOXML，字体由打开它的客户端渲染，**无需内嵌**；渲染时设置 `font.name = "Microsoft YaHei"`（Windows）即可，可额外设 `eastAsia` 字体保证跨平台。
- 美观：用内置布局，但叠加统一品牌美化，避免默认模板的单调观感——标题用品牌主色 `#565cf6`（`--primary`），正文深灰 `#202432`（`--text`），强调块浅底 `#eef0ff`（`--primary-soft`）；标题字号 28pt、正文 16–18pt、页标题 24–28pt；统一留白与列表间距，`theme` 为 `neutral` 时改用中性灰配色。

### 3.4 实现步骤

1. **契约**：新增 `PptxSpec` / `PptxSlide` / `PptxBlock` / `RenderPptxRequest`；端点 `POST /internal/v1/documents/render-pptx`，响应 `application/vnd.openxmlformats-officedocument.presentationml.presentation`。
2. **渲染器**（`apps/ai-service/app/documents/pptx_renderer.py`）：`PptxRenderer.render(spec: PptxSpec, options) -> RenderedPptx`，逐页用 `python-pptx` 的内置布局（`Title`, `Title and Content`, `Section Header`, `Two Content`, `Blank`）渲染块，并按上述美观规范统一配色/字号/间距；图片块插入 `Picture`（URL 仅来自 COS，渲染时下载）。
3. **验证**：`apps/ai-service/app/documents/validation.py` 增加 `validate_pptx_spec`。
4. **端点**：`documents.py` 加 `render_pptx`。
5. **NestJS**：`AiServiceGateway.renderPptx`、`DocumentService.exportDocumentPptx`。
6. **依赖**：`pyproject.toml` 增加 `python-pptx`。

### 3.6 用户上传图片注入 PPT

- 用户上传的图片**必须先存 COS**（复用现有附件上传 / 图片生成链路），拿到可访问 URL。
- 前端把该 COS URL 作为 `PptxSpec.slides[].blocks[]` 中 `image` 块的 `url`，调 `render-pptx` 渲染。
- 「给已生成的 PPT 加图/换图」= **修改 PptxSpec 后重新渲染**，而非原位编辑二进制 PPTX：前端保存/编辑 `PptxSpec` → 替换或追加 image 块 URL → 重新 `render-pptx`。
- 「原位编辑二进制 PPTX（保留用户手动排版、只插一页/一张图）」超出本方案范围，如需要后续单独做 PPT 编辑端点（接收 pptx + 图片 + 目标页）。

> 落地（2026-09-18）：「给已生成文档（PDF/DOCX/PPTX）在指定章节末尾加图」已实现为 `insert_document_image` 工具：读取目标文档 `DocumentSpec` → 章节末尾追加 `ImageBlock` → 按原格式原位重渲染同一文档，不新建文档、不重写正文。落库 spec 只保存 `cos://{objectKey}` 稳定引用，渲染前现场签发短期 URL。详见 [AI 助手工具循环](assistant-tool-loop.md) 第 17 节。

### 3.5 验收

- 结构化内容生成 PPTX，PowerPoint / WPS / Keynote 可打开，中文正常。
- `PptxSpec` 的 6 种块（含图片）均能正确渲染。

---

## 4. 工具接线（`generate_pdf` / `generate_pptx`，补齐 `generate_docx`）

统一走现有「工具调用 → 生成 → COS → 落库 → 审计」链路，与 `generate_image` 对齐。**已确认拆成三个独立工具**：`generate_docx` / `generate_pdf` / `generate_pptx`（语义清晰、参数各自独立），替换当前合并的 `generate_document`。

1. 工具定义：在 `apps/api/src/assistant/tools/` 注册 `generate_docx`、`generate_pdf`、`generate_pptx` 三个独立工具（当前 `generate_document` 保留为兼容别名或直接迁移）。
2. 执行器 `executors/`：调用 `DocumentService.exportDocumentPdf/exportDocumentPptx`（或先生成 `DocumentSpec` 再渲染）。
3. 落库：生成字节上传 COS → 建 `FileObject` + `Resource`（`ResourceType.DOCUMENT`）→ `ManagedDocument`（PDF/PPTX 作为附件或独立资源）。
4. 审计：写 `AIActionDraft`（`actionType = ai.document.generate`）+ `audit` 事件（租户/操作者/请求/资源）。
5. 前端：`generate_pdf` / `generate_pptx` 的 `tool_result` 在 `Workspace.tsx` 的资源卡片里渲染（当前 `ChatResource` 只处理 `IMAGE` / `DOCUMENT`，需扩展 PDF/PPTX 的预览/下载）。

---

## 5. 影响面与验证矩阵

| 变更 | 最低验证 |
| --- | --- |
| 契约新增 `RenderPdfRequest` / `PptxSpec` / `render-pdf` / `render-pptx` | 契约校验 + 重新生成 `api-client` / `ai-service-client` / Python `models.py` |
| `pdf_renderer.py` / `pptx_renderer.py` | `pytest`（渲染中文样本，断言字节非空、PDF 含嵌入字体） |
| NestJS 网关 + Service + 工具 | `jest`（受影响模块） |
| 工具接线（COS/落库/审计） | 集成验证：一次工具调用后 FileObject/Resource/AIActionDraft/audit 齐全 |

## 6. 已确认决策

1. **字体文件策略**：构建时下载（`.gitignore` 排除字体，Dockerfile/脚本拉取 Noto Sans SC）。
2. **PPT 图片来源**：只接受 COS URL（用户上传图片需先存 COS）。
3. **PPT 模板**：python-pptx 内置布局 + 品牌美化（配色/字号/间距），不做自定义母版（后续需要再加 `PptxTheme`）。
4. **工具拆分**：拆成 `generate_docx` / `generate_pdf` / `generate_pptx` 三个独立工具。
