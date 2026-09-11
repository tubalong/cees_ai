import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, DraftStatus, FilePurpose, Prisma, ResourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ImageGenerateRequest } from '@cees/ai-service-client';
import { PrismaService } from '../database/prisma.service';
import { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import { STORAGE_PROVIDER, STORAGE_SETTINGS } from '../storage/storage.tokens';
import type { StorageProvider, StorageSettings } from '../storage/storage.types';
import { CosObjectKeyFactory } from '../storage/cos-object-key.factory';
import { TenantContext } from '../tenant/tenant-context';
import { ImageResult } from './image.types';

/** AIActionDraft.actionType：与权限码保持一致，动作流水与权限语义一一对应。 */
const ACTION_TYPE = 'ai.image.generate';

export interface GenerateImageCommand {
  tenantId: string;
  userId: string;
  membershipId: string;
  requestId: string;
  turnId: string;
  toolCallId: string;
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
  quality?: 'standard' | 'high';
  responseFormat?: 'png' | 'jpeg' | 'webp';
}

export interface GeneratedImage {
  imageId: string;
  contentType: string;
  sizeBytes: number;
  provider: string;
  model: string;
  /** 短期签名下载 URL。 */
  url: string;
}

/**
 * AI 图片生成的正式资源入口（与 DocumentService 同模式）：
 * ai-service 出图（Base64）→ 服务端上传 COS → FileObject / Resource(IMAGE) /
 * ManagedImage 落库 → AIActionDraft(EXECUTED) 动作流水 → 审计。
 * 本服务被 generate_image 工具执行器与公开 GET /images/{imageId} 接口调用。
 */
@Injectable()
export class ImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiServiceGateway,
    private readonly tenantContext: TenantContext,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(STORAGE_SETTINGS) private readonly storageSettings: StorageSettings,
    private readonly objectKeys: CosObjectKeyFactory,
  ) {}

  /**
   * 生成图片并落成正式资源。以 tool_call_id 幂等：同一工具调用重复执行
   * （如断线重试）直接返回已落库资源，不重复生成与上传。
   */
  async generateImage(command: GenerateImageCommand): Promise<GeneratedImage> {
    const existing = await this.findExecutedImage(command.tenantId, command.toolCallId);
    if (existing) return existing;

    const request: ImageGenerateRequest = {
      request_id: command.requestId,
      tenant_id: command.tenantId,
      user_id: command.userId,
      prompt: command.prompt,
      ...(command.size !== undefined ? { size: command.size } : {}),
      ...(command.quality !== undefined ? { quality: command.quality } : {}),
      ...(command.responseFormat !== undefined ? { response_format: command.responseFormat } : {}),
    };
    const upstream = await this.gateway.generateImage(request, {
      membershipId: command.membershipId,
      turnId: command.turnId,
      toolCallId: command.toolCallId,
    });

    const body = Buffer.from(upstream.data_base64, 'base64');
    const imageId = randomUUID();
    const fileId = randomUUID();
    const objectKey = this.objectKeys.buildSourceKey({ tenantId: command.tenantId, fileId });
    const stored = await this.storage.putObject({ objectKey, body, contentType: upstream.content_type });

    await this.prisma.$transaction(async (transaction) => {
      await transaction.fileObject.create({
        data: {
          id: fileId,
          tenantId: command.tenantId,
          originalName: `generated-${imageId}.${extensionOf(upstream.content_type)}`,
          purpose: FilePurpose.GENERATED_IMAGE,
          storageProvider: 'TENCENT_COS',
          bucket: this.storageSettings.bucket,
          region: this.storageSettings.region,
          objectKey,
          mimeType: upstream.content_type,
          sizeBytes: BigInt(stored.sizeBytes),
          etag: stored.etag,
          createdBy: command.userId,
          updatedBy: command.userId,
        },
      });
      await transaction.resource.create({
        data: {
          id: imageId,
          tenantId: command.tenantId,
          type: ResourceType.IMAGE,
          ownerMembershipId: command.membershipId,
          createdBy: command.userId,
          updatedBy: command.userId,
        },
      });
      await transaction.managedImage.create({
        data: {
          id: imageId,
          tenantId: command.tenantId,
          fileObjectId: fileId,
          provider: upstream.execution.provider,
          model: upstream.execution.model,
          prompt: command.prompt,
          size: command.size ?? null,
          contentType: upstream.content_type,
          createdBy: command.userId,
          updatedBy: command.userId,
        },
      });
      await transaction.aIActionDraft.create({
        data: {
          tenantId: command.tenantId,
          userId: command.userId,
          actionType: ACTION_TYPE,
          payload: {
            prompt: command.prompt,
            size: command.size ?? null,
            quality: command.quality ?? null,
            contentType: upstream.content_type,
            provider: upstream.execution.provider,
            model: upstream.execution.model,
            objectKey,
            sizeBytes: stored.sizeBytes,
          } satisfies Prisma.InputJsonObject,
          status: DraftStatus.EXECUTED,
          toolCallId: command.toolCallId,
          executedResourceType: 'IMAGE',
          executedResourceId: imageId,
          createdBy: command.userId,
          updatedBy: command.userId,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: command.tenantId,
          actorUserId: command.userId,
          actorMembershipId: command.membershipId,
          action: 'IMAGE_GENERATED',
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'IMAGE',
          resourceId: imageId,
          requestId: command.requestId,
          metadata: {
            toolCallId: command.toolCallId,
            prompt: command.prompt,
            contentType: upstream.content_type,
            provider: upstream.execution.provider,
            model: upstream.execution.model,
            sizeBytes: stored.sizeBytes,
            objectKey,
          },
        },
      });
    });

    const url = await this.storage.createDownloadUrl(objectKey);
    return {
      imageId,
      contentType: upstream.content_type,
      sizeBytes: stored.sizeBytes,
      provider: upstream.execution.provider,
      model: upstream.execution.model,
      url,
    };
  }

  /**
   * 公开图片访问入口（契约 GET /images/{imageId}）：按 image.read 权限
   * （由 PermissionGuard 校验）与 Resource(IMAGE) 归属校验后返回元数据与
   * 新的短期签名 URL。当前授权范围为 owner-only，ACL 分享留待图片分享功能。
   */
  async getImageAccess(imageId: string): Promise<ImageResult> {
    const context = this.tenantContext.require();
    const image = await this.prisma.managedImage.findFirst({
      where: { tenantId: context.tenantId, id: imageId, deletedAt: null },
      select: {
        id: true,
        createdAt: true,
        prompt: true,
        model: true,
        contentType: true,
        fileObjectId: true,
        resource: { select: { id: true, ownerMembershipId: true, deletedAt: true } },
      },
    });
    if (!image || image.resource.deletedAt) {
      throw new NotFoundException({ code: 'IMAGE_NOT_FOUND', message: '图片不存在或已被删除' });
    }
    if (image.resource.ownerMembershipId !== context.membershipId) {
      throw new ForbiddenException({
        code: 'IMAGE_ACCESS_DENIED',
        message: '缺少 image.read 权限或图片不在授权范围内',
      });
    }
    const fileObject = await this.prisma.fileObject.findUnique({
      where: { id: image.fileObjectId },
      select: { objectKey: true, sizeBytes: true },
    });
    if (!fileObject) {
      throw new NotFoundException({ code: 'IMAGE_NOT_FOUND', message: '图片不存在或已被删除' });
    }
    const url = await this.storage.createDownloadUrl(fileObject.objectKey);
    return {
      id: image.id,
      resourceId: image.resource.id,
      mimeType: image.contentType as ImageResult['mimeType'],
      sizeBytes: Number(fileObject.sizeBytes),
      url,
      prompt: image.prompt,
      model: image.model,
      createdAt: image.createdAt,
    };
  }

  /** 幂等回放：同一 tool_call_id 已执行成功时返回原资源与新的短期 URL。 */
  private async findExecutedImage(tenantId: string, toolCallId: string): Promise<GeneratedImage | null> {
    const draft = await this.prisma.aIActionDraft.findFirst({
      where: { tenantId, toolCallId, status: DraftStatus.EXECUTED },
      orderBy: { createdAt: 'desc' },
      select: { executedResourceId: true },
    });
    if (!draft?.executedResourceId) return null;

    const image = await this.prisma.managedImage.findFirst({
      where: { tenantId, id: draft.executedResourceId, deletedAt: null },
      select: { id: true, contentType: true, fileObjectId: true, provider: true, model: true },
    });
    if (!image) return null;

    const fileObject = await this.prisma.fileObject.findUnique({
      where: { id: image.fileObjectId },
      select: { objectKey: true, sizeBytes: true },
    });
    if (!fileObject) return null;

    const url = await this.storage.createDownloadUrl(fileObject.objectKey);
    return {
      imageId: image.id,
      contentType: image.contentType,
      sizeBytes: Number(fileObject.sizeBytes),
      provider: image.provider,
      model: image.model,
      url,
    };
  }
}

function extensionOf(contentType: string): string {
  switch (contentType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
}
