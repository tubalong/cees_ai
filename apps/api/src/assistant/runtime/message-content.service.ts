import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConversationMessageRole, FilePurpose, ManagedImageStatus } from '@prisma/client';
import type { DocumentSourceMaterial, MessageContentPart } from '@cees/ai-service-client';
import { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../../database/prisma.service';
import {
  ASSISTANT_IMAGE_MIME_TYPES,
  ASSISTANT_MAX_IMAGE_BYTES,
  ASSISTANT_MAX_IMAGE_COUNT,
  isSupportedImageMimeType,
  normalizeImageMimeType,
  type AssistantImageMimeType,
} from '../../image/image-policy';
import { STORAGE_PROVIDER, STORAGE_SETTINGS } from '../../storage/storage.tokens';
import type { StorageProvider, StorageSettings } from '../../storage/storage.types';

export {
  ASSISTANT_IMAGE_MIME_TYPES,
  ASSISTANT_MAX_IMAGE_BYTES,
  ASSISTANT_MAX_IMAGE_COUNT,
  type AssistantImageMimeType,
} from '../../image/image-policy';

export interface MessageContentIdentity {
  tenantId: string;
  userId: string;
  membershipId: string;
  requestId: string;
}

interface ResolvedImage {
  id: string;
  mimeType: AssistantImageMimeType;
  sizeBytes: number;
  objectKey: string;
  originalName: string;
}

const MAX_CONVERSATION_IMAGE_REFERENCES = 20;

/**
 * 本轮可被工具引用的图片：只暴露稳定的文件 ID 与对象键。
 * 签名下载 URL 属于短期凭据，绝不外传或落库，需要时由调用方按对象键现场签发。
 */
export interface TurnImageReference {
  /** 图片所属的 FileObject ID；已确认归属当前用户或当前成员。 */
  fileId: string;
  /** COS 对象键；调用方可据此签发短期下载 URL。 */
  objectKey: string;
  mimeType: AssistantImageMimeType;
}

export interface ConversationImageReference extends TurnImageReference {
  source: 'UPLOAD' | 'GENERATED';
  label: string;
  createdAt: Date;
}

/**
 * Single owner of Assistant message attachments.
 * Conversation facts contain only file IDs; image bytes are inlined as base64
 * data URLs just before an ai-service request and are never persisted in
 * conversation facts. 上游模型只接受内联图片（远程 https 链接会被上游以
 * "Failed to download image" 拒绝），因此这里必须先下载再内联。
 */
@Injectable()
export class AssistantMessageContentService {
  private readonly maxImageBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(STORAGE_SETTINGS) storageSettings: StorageSettings,
    private readonly gateway: AiServiceGateway,
  ) {
    this.maxImageBytes = Math.min(ASSISTANT_MAX_IMAGE_BYTES, storageSettings.maxUploadBytes);
  }

  /** Validate references before a turn is created so invalid input is not persisted. */
  async validateImageFileIds(
    fileIds: readonly string[] | undefined,
    identity: MessageContentIdentity,
  ): Promise<string[]> {
    const normalized = normalizeFileIds(fileIds);
    if (normalized.length === 0) return [];
    await this.resolveImages(normalized, identity);
    return normalized;
  }

  /** Convert persisted text + stable file IDs to the ai-service parts contract. */
  async toModelParts(
    content: string | null | undefined,
    fileIds: readonly string[] | undefined,
    documentFileIds: readonly string[] | undefined,
    identity: MessageContentIdentity,
  ): Promise<MessageContentPart[]> {
    const normalized = normalizeFileIds(fileIds);
    const parts: MessageContentPart[] = [];
    if (content !== null && content !== undefined && content.length > 0) {
      parts.push({ type: 'text', text: content });
    }
    if (normalized.length > 0) {
      const images = await this.resolveImages(normalized, identity);
      let inlineBytes = 0;
      for (const image of images) {
        const dataUrl = await this.toInlineImageUrl(image);
        // data URL 会整体进入上游请求体，累计体积必须有上限，否则 8×20MB
        // 的会话会把 provider 请求撑到上百 MB。
        inlineBytes += Buffer.byteLength(dataUrl, 'utf8');
        if (inlineBytes > this.maxImageBytes) {
          throw new BadRequestException({
            code: 'IMAGE_TOTAL_TOO_LARGE',
            message: '本轮图片总体积超过单次请求上限，请减少图片数量或压缩后重试',
            details: { fileId: image.id, maxBytes: this.maxImageBytes },
          });
        }
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }
    if (documentFileIds && documentFileIds.length > 0) {
      const documentParts = await this.resolveDocumentParts(documentFileIds, identity);
      parts.push(...documentParts);
      const references = await this.describeDocumentReferences(documentFileIds, identity);
      if (references) parts.push(references);
    }
    if (parts.length === 0) {
      throw new BadRequestException({
        code: 'MESSAGE_CONTENT_EMPTY',
        message: '消息至少需要包含文本或一张图片',
      });
    }
    return parts;
  }

  /**
   * 把私有 COS 对象读成内联 data URL。
   *
   * 上游（DeepSeek 等 OpenAI 兼容端点）不会自行下载远程图片，直接传签名链接
   * 会被以 400 "Failed to download image" 拒绝；只有 `data:<mime>;base64,...`
   * 才被接受。签名链接只用于服务端内部取字节，不进入模型请求，也不落库。
   */
  private async toInlineImageUrl(image: ResolvedImage): Promise<string> {
    let url: string;
    try {
      url = await this.storage.createDownloadUrl(image.objectKey);
    } catch (error) {
      throw new BadGatewayException({
        code: 'IMAGE_REFERENCE_URL_FAILED',
        message: '暂时无法读取对话图片',
        details: { fileId: image.id },
        cause: error,
      });
    }
    let bytes: Buffer;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`status ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw new BadGatewayException({
        code: 'IMAGE_REFERENCE_URL_FAILED',
        message: '暂时无法读取对话图片',
        details: { fileId: image.id },
        cause: error,
      });
    }
    if (bytes.byteLength === 0) {
      throw new BadGatewayException({
        code: 'IMAGE_REFERENCE_URL_FAILED',
        message: '暂时无法读取对话图片',
        details: { fileId: image.id },
      });
    }
    return `data:${image.mimeType};base64,${bytes.toString('base64')}`;
  }

  /**
   * 解析某一轮对话中可供工具引用的图片，按「本轮用户上传的附件 → 本轮船次生成的图片」
   * 顺序返回稳定引用。索引语义由调用方（工具执行器）向模型声明。
   *
   * 通过 turnId 从会话事实源读取，而不是依赖内存态传入：轮次恢复或重试后，
   * 附件引用依然可从库里重建，避免工具在重启后引用不到图片。
   */
  async resolveTurnImageReferences(
    turnId: string,
    identity: MessageContentIdentity,
  ): Promise<TurnImageReference[]> {
    const message = await this.prisma.conversationMessage.findFirst({
      where: { tenantId: identity.tenantId, turnId, role: ConversationMessageRole.USER },
      orderBy: { createdAt: 'asc' },
      select: { imageFileIds: true },
    });
    const references: TurnImageReference[] = [];
    const attached = normalizeFileIds(message?.imageFileIds ?? []);
    if (attached.length > 0) {
      const resolved = await this.resolveImages(attached, identity);
      references.push(...resolved.map((image) => ({
        fileId: image.id,
        objectKey: image.objectKey,
        mimeType: image.mimeType,
      })));
    }
    const generated = await this.prisma.managedImage.findMany({
      where: {
        tenantId: identity.tenantId,
        status: ManagedImageStatus.READY,
        fileObjectId: { not: null },
        resource: { is: { deletedAt: null } },
        toolCall: { is: { turnId, tenantId: identity.tenantId } },
      },
      orderBy: { createdAt: 'asc' },
      select: { fileObjectId: true, objectKey: true, contentType: true },
    });
    for (const image of generated) {
      if (!image.fileObjectId || !image.contentType) continue;
      const mimeType = normalizeImageMimeType(image.contentType);
      if (!isSupportedImageMimeType(mimeType)) continue;
      references.push({
        fileId: image.fileObjectId,
        objectKey: image.objectKey,
        mimeType,
      });
    }
    return references;
  }

  /**
   * 列出当前会话最近可复用的图片，供跨轮次插图使用。
   *
   * 用户上传图片必须来自当前会话且归属当前用户；生成图片必须由当前会话的工具调用
   * 产生、归属当前成员且资源未删除。返回稳定 FileObject ID，不返回短期签名 URL。
   */
  async resolveConversationImageReferences(
    conversationId: string,
    identity: MessageContentIdentity,
  ): Promise<ConversationImageReference[]> {
    const messages = await this.prisma.conversationMessage.findMany({
      where: {
        tenantId: identity.tenantId,
        conversationId,
        role: ConversationMessageRole.USER,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { imageFileIds: true, createdAt: true },
    });
    const uploadedAt = new Map<string, Date>();
    for (const message of messages) {
      for (const fileId of normalizeFileIds(message.imageFileIds)) {
        uploadedAt.set(fileId, message.createdAt);
      }
    }

    const references = new Map<string, ConversationImageReference>();
    const uploadedIds = [...uploadedAt.keys()];
    if (uploadedIds.length > 0) {
      const uploaded = await this.resolveImages(uploadedIds, identity);
      for (const image of uploaded) {
        references.set(image.id, {
          fileId: image.id,
          objectKey: image.objectKey,
          mimeType: image.mimeType,
          source: 'UPLOAD',
          label: image.originalName,
          createdAt: uploadedAt.get(image.id) ?? new Date(0),
        });
      }
    }

    const generated = await this.prisma.managedImage.findMany({
      where: {
        tenantId: identity.tenantId,
        deletedAt: null,
        status: ManagedImageStatus.READY,
        fileObjectId: { not: null },
        resource: { is: { ownerMembershipId: identity.membershipId, deletedAt: null } },
        toolCall: { is: { tenantId: identity.tenantId, conversationId } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        fileObjectId: true,
        objectKey: true,
        contentType: true,
        prompt: true,
        createdAt: true,
      },
    });
    for (const image of generated) {
      if (!image.fileObjectId || !image.contentType) continue;
      const mimeType = normalizeImageMimeType(image.contentType);
      if (!isSupportedImageMimeType(mimeType)) continue;
      references.set(image.fileObjectId, {
        fileId: image.fileObjectId,
        objectKey: image.objectKey,
        mimeType,
        source: 'GENERATED',
        label: truncateReferenceLabel(image.prompt, 'AI 生成图片'),
        createdAt: image.createdAt,
      });
    }

    return [...references.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(-MAX_CONVERSATION_IMAGE_REFERENCES);
  }

  /** 给模型的会话图片目录；ID 只用于工具参数，不允许出现在用户可见回答中。 */
  async describeConversationImageReferences(
    conversationId: string,
    identity: MessageContentIdentity,
  ): Promise<string | null> {
    const references = await this.resolveConversationImageReferences(conversationId, identity);
    if (references.length === 0) return null;
    return [
      '当前会话可供 insert_document_image 引用的图片（按时间从旧到新）：',
      ...references.map((image, index) => (
        `- image_index=${index + 1} image_file_id=${image.fileId} `
        + `来源=${image.source === 'GENERATED' ? 'AI生成' : '用户上传'} 描述=${image.label}`
      )),
      '插入历史图片时优先传 image_file_id 精确选择；也可传 image_index。省略两者时使用最近一张。',
      'image_file_id 是内部资源标识，只能用于工具调用，绝不能展示给用户。',
    ].join('\n');
  }

  /** 从会话事实源重建本轮文档附件，供需要原始内容的工具在重试/恢复后继续使用。 */
  async resolveTurnDocumentSourceMaterials(
    turnId: string,
    identity: MessageContentIdentity,
  ): Promise<DocumentSourceMaterial[]> {
    const message = await this.prisma.conversationMessage.findFirst({
      where: { tenantId: identity.tenantId, turnId, role: ConversationMessageRole.USER },
      orderBy: { createdAt: 'asc' },
      select: { documentFileIds: true },
    });
    const fileIds = normalizeFileIds(message?.documentFileIds ?? []);
    if (fileIds.length === 0) return [];
    const files = await this.prisma.fileObject.findMany({
      where: { tenantId: identity.tenantId, id: { in: fileIds }, deletedAt: null },
      select: { id: true, originalName: true },
    });
    const names = new Map(files.map((file) => [file.id, file.originalName]));
    const materials: DocumentSourceMaterial[] = [];
    for (const fileId of fileIds) {
      const parts = await this.resolveDocumentParts([fileId], identity);
      const content = parts
        .filter((part): part is Extract<MessageContentPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      if (content.trim()) {
        materials.push({ id: fileId, title: names.get(fileId) ?? 'uploaded-spreadsheet', content });
      }
    }
    return materials;
  }

  /** 抽取文档/文本文件内容为可注入对话上下文的文本 parts。 */
  async resolveDocumentParts(
    fileIds: readonly string[],
    identity: MessageContentIdentity,
  ): Promise<MessageContentPart[]> {
    const normalized = normalizeFileIds(fileIds);
    if (normalized.length === 0) return [];
    const files = await this.prisma.fileObject.findMany({
      where: {
        tenantId: identity.tenantId,
        id: { in: normalized },
        deletedAt: null,
        purpose: FilePurpose.ATTACHMENT,
      },
      select: { id: true, mimeType: true, objectKey: true, originalName: true, createdBy: true },
    });
    const byId = new Map(files.map((file) => [file.id, file]));
    const parts: MessageContentPart[] = [];
    for (const fileId of normalized) {
      const file = byId.get(fileId);
      if (!file) {
        throw new BadRequestException({
          code: 'DOCUMENT_REFERENCE_NOT_FOUND',
          message: '引用的文档不存在或不属于当前租户',
          details: { fileId },
        });
      }
      if (file.createdBy !== identity.userId) {
        throw new ForbiddenException({
          code: 'DOCUMENT_REFERENCE_ACCESS_DENIED',
          message: '没有权限使用该文档',
          details: { fileId },
        });
      }
      const url = await this.storage.createDownloadUrl(file.objectKey);
      const response = await fetch(url);
      if (!response.ok) {
        throw new BadGatewayException({
          code: 'DOCUMENT_DOWNLOAD_FAILED',
          message: '暂时无法读取文档内容',
          details: { fileId },
        });
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const extracted = await this.gateway.extractFile({
        request_id: identity.requestId,
        tenant_id: identity.tenantId,
        user_id: identity.userId,
        filename: file.originalName,
        content_type: file.mimeType,
        data_base64: bytes.toString('base64'),
      });
      parts.push(...extracted.parts);
    }
    return parts;
  }

  /**
   * 把本轮附件的稳定引用清单注入模型上下文。
   *
   * 附件正文是以**提取文本**形式进上下文的，模型看不到 FileObject ID。缺 ID 时它无法
   * 构造 `save_to_knowledge` 的 `sourceType: FILE_OBJECT` + `sourceId` 路径，只能退而
   * 把长文档内联进 `content`，最终因输出上限截断导致整轮失败。这里把 ID 与文件名一起
   * 交给模型，并按既有约定要求它不向用户展示内部 ID。
   */
  async describeDocumentReferences(
    fileIds: readonly string[] | undefined,
    identity: MessageContentIdentity,
  ): Promise<MessageContentPart | undefined> {
    const normalized = normalizeFileIds(fileIds);
    if (normalized.length === 0) return undefined;
    const files = await this.prisma.fileObject.findMany({
      where: {
        tenantId: identity.tenantId,
        id: { in: normalized },
        deletedAt: null,
        purpose: FilePurpose.ATTACHMENT,
        createdBy: identity.userId,
      },
      select: { id: true, originalName: true },
    });
    if (files.length === 0) return undefined;
    const byId = new Map(files.map((file) => [file.id, file]));
    const lines = normalized
      .map((fileId) => byId.get(fileId))
      .filter((file): file is { id: string; originalName: string } => Boolean(file))
      .map((file) => `- file_id=${file.id} 文件名=${file.originalName}`);
    if (lines.length === 0) return undefined;
    return {
      type: 'text',
      text: [
        '本轮用户消息附带的文件（可被工具引用）：',
        ...lines,
        '把这些文件存入知识库时，调用 save_to_knowledge，sourceType=FILE_OBJECT，'
        + 'sourceId 传上面列出的 file_id；name 省略时服务端沿用原文件名。'
        + '不要把这些 file_id 展示给用户，也不要把文件正文改写成 content 参数。',
      ].join('\n'),
    };
  }

  private async resolveImages(
    fileIds: readonly string[],
    identity: MessageContentIdentity,
  ): Promise<ResolvedImage[]> {
    const files = await this.prisma.fileObject.findMany({
      where: {
        tenantId: identity.tenantId,
        id: { in: [...fileIds] },
        deletedAt: null,
      },
      select: {
        id: true,
        mimeType: true,
        sizeBytes: true,
        objectKey: true,
        originalName: true,
        createdBy: true,
        managedImages: {
          select: {
            status: true,
            resource: { select: { ownerMembershipId: true, deletedAt: true } },
          },
        },
      },
    });
    const byId = new Map(files.map((file) => [file.id, file]));
    const resolved: ResolvedImage[] = [];
    for (const fileId of fileIds) {
      const file = byId.get(fileId);
      if (!file) {
        throw new BadRequestException({
          code: 'IMAGE_REFERENCE_NOT_FOUND',
          message: '引用的图片不存在或不属于当前租户',
          details: { fileId },
        });
      }
      const mimeType = normalizeImageMimeType(file.mimeType);
      if (!isSupportedImageMimeType(mimeType)) {
        throw new BadRequestException({
          code: 'IMAGE_MIME_TYPE_UNSUPPORTED',
          message: '对话图片只支持 PNG、JPEG 或 WebP',
          details: { fileId, mimeType },
        });
      }
      const sizeBytes = Number(file.sizeBytes);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > this.maxImageBytes) {
        throw new BadRequestException({
          code: 'IMAGE_FILE_TOO_LARGE',
          message: '对话图片超过允许的大小限制',
          details: { fileId, maxBytes: this.maxImageBytes },
        });
      }
      const isOwnedUpload = file.createdBy === identity.userId;
      const isOwnedGeneratedImage = file.managedImages.some(
        (image) => image.status === ManagedImageStatus.READY
          && !image.resource.deletedAt
          && image.resource.ownerMembershipId === identity.membershipId,
      );
      if (!isOwnedUpload && !isOwnedGeneratedImage) {
        throw new ForbiddenException({
          code: 'IMAGE_REFERENCE_ACCESS_DENIED',
          message: '没有权限使用该对话图片',
          details: { fileId },
        });
      }
      resolved.push({
        id: file.id,
        mimeType: mimeType as AssistantImageMimeType,
        sizeBytes,
        objectKey: file.objectKey,
        originalName: file.originalName,
      });
    }
    return resolved;
  }
}

function truncateReferenceLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 120 ? `${normalized.slice(0, 119)}…` : normalized;
}

function normalizeFileIds(fileIds: readonly string[] | undefined): string[] {
  if (!fileIds) return [];
  if (fileIds.length > ASSISTANT_MAX_IMAGE_COUNT) {
    throw new BadRequestException({
      code: 'IMAGE_COUNT_EXCEEDED',
      message: `一条消息最多引用 ${ASSISTANT_MAX_IMAGE_COUNT} 张图片`,
    });
  }
  const normalized = fileIds.map((id) => id.trim());
  if (normalized.some((id) => !UUID_PATTERN.test(id))) {
    throw new BadRequestException({
      code: 'IMAGE_REFERENCE_INVALID',
      message: '图片文件 ID 必须是 UUID',
    });
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new BadRequestException({
      code: 'IMAGE_REFERENCE_DUPLICATE',
      message: '同一条消息不能重复引用同一张图片',
    });
  }
  return normalized;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
