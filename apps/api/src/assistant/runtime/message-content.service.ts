import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ManagedImageStatus } from '@prisma/client';
import type { MessageContentPart } from '@cees/ai-service-client';
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
}

interface ResolvedImage {
  id: string;
  mimeType: AssistantImageMimeType;
  sizeBytes: number;
  objectKey: string;
}

/**
 * Single owner of Assistant message attachments.
 * Conversation facts contain only file IDs; signed COS URLs are created just
 * before an ai-service request and are never persisted in conversation facts.
 */
@Injectable()
export class AssistantMessageContentService {
  private readonly maxImageBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(STORAGE_SETTINGS) storageSettings: StorageSettings,
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
    identity: MessageContentIdentity,
  ): Promise<MessageContentPart[]> {
    const normalized = normalizeFileIds(fileIds);
    const parts: MessageContentPart[] = [];
    if (content !== null && content !== undefined && content.length > 0) {
      parts.push({ type: 'text', text: content });
    }
    if (normalized.length > 0) {
      const images = await this.resolveImages(normalized, identity);
      for (const image of images) {
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
        parts.push({ type: 'image_url', image_url: { url } });
      }
    }
    if (parts.length === 0) {
      throw new BadRequestException({
        code: 'MESSAGE_CONTENT_EMPTY',
        message: '消息至少需要包含文本或一张图片',
      });
    }
    return parts;
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
      });
    }
    return resolved;
  }
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
