import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditOutcome,
  DraftStatus,
  FilePurpose,
  ManagedImageStatus,
  Prisma,
  ResourceType,
  ToolCallStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ImageGenerateRequest } from '@cees/ai-service-client';
import { AiServiceGateway } from '../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../database/prisma.service';
import { CosObjectKeyFactory } from '../storage/cos-object-key.factory';
import { STORAGE_PROVIDER, STORAGE_SETTINGS } from '../storage/storage.tokens';
import type { StorageProvider, StorageSettings } from '../storage/storage.types';
import { TenantContext } from '../tenant/tenant-context';
import { ImageResult } from './image.types';
import {
  isSupportedImageMimeType,
  normalizeImageMimeType,
} from './image-policy';

const ACTION_TYPE = 'ai.image.generate';

export interface GenerateImageCommand {
  tenantId: string;
  userId: string;
  membershipId: string;
  requestId: string;
  conversationId: string;
  turnId: string;
  toolCallId: string;
  executionOwner: string;
  executionToken: string;
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
}

interface ImageReservation {
  id: string;
  objectKey: string;
  status: ManagedImageStatus;
  claimed: boolean;
}

/**
 * 图片正式资源入口。先在 PostgreSQL 以 toolCallId 原子预留资源，再调用 Provider，
 * 使用确定性 COS object key 上传，最后把 FileObject/ManagedImage/审计一次提交。
 * 生成结果只返回稳定资源 ID；下载 URL 一律由 GET /images/{id} 按需签发，
 * 事件与消息快照不保存签名 URL，历史图片可随时重新签发恢复。
 */
@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiServiceGateway,
    private readonly tenantContext: TenantContext,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(STORAGE_SETTINGS) private readonly storageSettings: StorageSettings,
    private readonly objectKeys: CosObjectKeyFactory,
  ) {}

  async generateImage(command: GenerateImageCommand): Promise<GeneratedImage> {
    const completed = await this.findReadyImage(command.tenantId, command.turnId, command.toolCallId);
    if (completed) return completed;
    await this.requireExecutionClaim(command);

    const reservation = await this.reserveImage(command);
    if (!reservation.claimed) {
      const replay = await this.findReadyImage(command.tenantId, command.turnId, command.toolCallId);
      if (replay) return replay;
      throw new Error(`图片工具调用 ${command.toolCallId} 已存在未完成执行，禁止并发重复生成`);
    }

    let uploadAttempted = false;
    try {
      const generating = await this.advanceImageStatus(
        command,
        reservation.id,
        ManagedImageStatus.PENDING,
        { status: ManagedImageStatus.GENERATING },
      );
      if (!generating) {
        throw new Error('图片生成预留已被取消或恢复流程收束');
      }
      const request: ImageGenerateRequest = {
        request_id: command.requestId,
        tenant_id: command.tenantId,
        user_id: command.userId,
        prompt: command.prompt,
        ...(command.size !== undefined ? { size: command.size } : {}),
        ...(command.quality !== undefined ? { quality: command.quality } : {}),
        ...(command.responseFormat !== undefined ? { response_format: command.responseFormat } : {}),
      };
      // The turn may be cancelled while the reservation is being created.
      // Re-check immediately before the external provider call so a stale
      // worker cannot create a billable side effect after losing its lease.
      await this.requireExecutionClaim(command);
      const upstream = await this.gateway.generateImage(request, {
        membershipId: command.membershipId,
        conversationId: command.conversationId,
        turnId: command.turnId,
        toolCallId: command.toolCallId,
      });
      // Cancellation or lease loss may happen while the provider is running.
      // Do not start a COS upload after the execution claim has been revoked.
      await this.requireExecutionClaim(command);
      const contentType = normalizeImageMimeType(upstream.content_type);
      if (!isSupportedImageMimeType(contentType)) {
        throw new Error(`ai-service 返回了不支持的图片 MIME 类型：${upstream.content_type}`);
      }
      const body = decodeBase64Image(upstream.data_base64);
      if (body.byteLength > this.storageSettings.maxUploadBytes) {
        throw new Error(`生成图片超过服务端允许的 ${this.storageSettings.maxUploadBytes} 字节上限`);
      }

      const uploading = await this.advanceImageStatus(
        command,
        reservation.id,
        ManagedImageStatus.GENERATING,
        {
          status: ManagedImageStatus.UPLOADING,
          provider: upstream.execution.provider,
          model: upstream.execution.model,
          contentType,
          failureCode: null,
          failureMessage: null,
        },
      );
      if (!uploading) {
        throw new Error('图片生成完成时工具执行权已失效，拒绝上传');
      }

      uploadAttempted = true;
      const stored = await this.storage.putObject({
        objectKey: reservation.objectKey,
        body,
        contentType,
      });
      const finalized = await this.finalizeImage(command, reservation, upstream, stored);
      return finalized;
    } catch (error) {
      // 事务响应丢失时先确认 READY，避免误删已经提交成功的正式对象。
      const persisted = await this.findReadyImage(command.tenantId, command.turnId, command.toolCallId).catch(() => null);
      if (persisted) return persisted;

      let orphaned = false;
      if (uploadAttempted) {
        try {
          await this.storage.deleteObject(reservation.objectKey);
        } catch (cleanupError) {
          orphaned = true;
          this.logger.error(
            `failed to clean orphaned image object ${reservation.objectKey}: ${String(cleanupError)}`,
          );
        }
      }
      await this.markImageFailure(command, reservation.id, error, orphaned).catch((recordError) => {
        this.logger.error(`failed to persist image failure ${reservation.id}: ${String(recordError)}`);
      });
      throw error;
    }
  }

  async getImageAccess(imageId: string): Promise<ImageResult> {
    const context = this.tenantContext.require();
    const image = await this.prisma.managedImage.findFirst({
      where: {
        tenantId: context.tenantId,
        id: imageId,
        status: ManagedImageStatus.READY,
        deletedAt: null,
      },
      select: {
        id: true,
        createdAt: true,
        prompt: true,
        model: true,
        contentType: true,
        fileObject: { select: { objectKey: true, sizeBytes: true } },
        resource: { select: { id: true, ownerMembershipId: true, deletedAt: true } },
      },
    });
    if (!image || image.resource.deletedAt || !image.fileObject || !image.contentType) {
      throw new NotFoundException({ code: 'IMAGE_NOT_FOUND', message: '图片不存在、尚未就绪或已被删除' });
    }
    if (image.resource.ownerMembershipId !== context.membershipId) {
      throw new ForbiddenException({
        code: 'IMAGE_ACCESS_DENIED',
        message: '缺少 image.read 权限或图片不在授权范围内',
      });
    }
    const url = await this.storage.createDownloadUrl(image.fileObject.objectKey);
    return {
      id: image.id,
      resourceId: image.resource.id,
      mimeType: image.contentType as ImageResult['mimeType'],
      sizeBytes: Number(image.fileObject.sizeBytes),
      url,
      prompt: image.prompt,
      model: image.model,
      createdAt: image.createdAt,
    };
  }

  /** 后台重试删除已标记 ORPHANED 的确定性对象；删除成功后收束为 FAILED。 */
  async cleanupOrphanedImages(limit = 100): Promise<number> {
    const candidates = await this.prisma.managedImage.findMany({
      where: { status: ManagedImageStatus.ORPHANED },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true, objectKey: true },
    });
    let cleaned = 0;
    for (const candidate of candidates) {
      try {
        await this.storage.deleteObject(candidate.objectKey);
        const updated = await this.prisma.managedImage.updateMany({
          where: { id: candidate.id, status: ManagedImageStatus.ORPHANED },
          data: {
            status: ManagedImageStatus.FAILED,
            failureCode: 'ORPHAN_OBJECT_CLEANED',
            failureMessage: '孤儿 COS 对象已由后台任务清理',
          },
        });
        cleaned += updated.count;
      } catch (error) {
        this.logger.error(`orphan image cleanup failed for ${candidate.id}: ${String(error)}`);
      }
    }
    return cleaned;
  }

  private async requireExecutionClaim(command: GenerateImageCommand): Promise<void> {
    const now = new Date();
    const claim = await this.prisma.toolCall.findFirst({
      where: {
        id: command.toolCallId,
        tenantId: command.tenantId,
        turnId: command.turnId,
        status: ToolCallStatus.EXECUTING,
        executionToken: command.executionToken,
        leaseExpiresAt: { gt: now },
        turn: {
          is: {
            status: 'RUNNING',
            executionOwner: command.executionOwner,
            leaseExpiresAt: { gt: now },
          },
        },
      },
      select: { id: true },
    });
    if (!claim) throw new Error('图片工具执行权已失效，拒绝产生外部副作用');
  }

  /**
   * 在检查工具租约的同一条 UPDATE 中推进图片状态，避免取消/恢复流程
   * 在检查与状态写入之间把已失败的预留重新推进到 GENERATING/UPLOADING。
   */
  private async advanceImageStatus(
    command: GenerateImageCommand,
    imageId: string,
    expectedStatus: ManagedImageStatus,
    data: Prisma.ManagedImageUpdateManyMutationInput,
  ): Promise<boolean> {
    const now = new Date();
    const updated = await this.prisma.managedImage.updateMany({
      where: {
        id: imageId,
        tenantId: command.tenantId,
        toolCallId: command.toolCallId,
        status: expectedStatus,
        deletedAt: null,
        resource: { is: { tenantId: command.tenantId, deletedAt: null } },
        toolCall: {
          is: {
            id: command.toolCallId,
            tenantId: command.tenantId,
            status: ToolCallStatus.EXECUTING,
            executionToken: command.executionToken,
            leaseExpiresAt: { gt: now },
            turn: {
              is: {
                id: command.turnId,
                status: 'RUNNING',
                executionOwner: command.executionOwner,
                leaseExpiresAt: { gt: now },
              },
            },
          },
        },
      },
      data,
    });
    return updated.count === 1;
  }

  private async reserveImage(command: GenerateImageCommand): Promise<ImageReservation> {
    const imageId = randomUUID();
    const objectKey = this.objectKeys.buildGeneratedImageKey({
      tenantId: command.tenantId,
      toolCallId: command.toolCallId,
    });
    try {
      await this.prisma.$transaction(async (transaction) => {
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
            toolCallId: command.toolCallId,
            status: ManagedImageStatus.PENDING,
            objectKey,
            prompt: command.prompt,
            size: command.size ?? null,
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
              objectKey,
            },
            status: DraftStatus.DRAFT,
            toolCallId: command.toolCallId,
            createdBy: command.userId,
            updatedBy: command.userId,
          },
        });
      });
      return { id: imageId, objectKey, status: ManagedImageStatus.PENDING, claimed: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.managedImage.findUnique({
        where: { toolCallId: command.toolCallId },
        select: { id: true, objectKey: true, status: true },
      });
      if (!existing) throw error;
      return { ...existing, claimed: false };
    }
  }

  private async finalizeImage(
    command: GenerateImageCommand,
    reservation: ImageReservation,
    upstream: Awaited<ReturnType<AiServiceGateway['generateImage']>>,
    stored: { sizeBytes: number; etag: string | null },
  ): Promise<GeneratedImage> {
    const fileId = reservation.id;
    const contentType = normalizeImageMimeType(upstream.content_type);
    await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const claim = await transaction.toolCall.findFirst({
        where: {
          id: command.toolCallId,
          tenantId: command.tenantId,
          turnId: command.turnId,
          status: ToolCallStatus.EXECUTING,
          executionToken: command.executionToken,
          leaseExpiresAt: { gt: now },
          turn: {
            is: {
              status: 'RUNNING',
              executionOwner: command.executionOwner,
              leaseExpiresAt: { gt: now },
            },
          },
        },
        select: { id: true },
      });
      if (!claim) throw new Error('图片生成完成时工具执行权已失效');

      await transaction.fileObject.upsert({
        where: { id: fileId },
        create: {
          id: fileId,
          tenantId: command.tenantId,
          originalName: `generated-${reservation.id}.${extensionOf(contentType)}`,
          purpose: FilePurpose.GENERATED_IMAGE,
          storageProvider: 'TENCENT_COS',
          bucket: this.storageSettings.bucket,
          region: this.storageSettings.region,
          objectKey: reservation.objectKey,
          mimeType: contentType,
          sizeBytes: BigInt(stored.sizeBytes),
          etag: stored.etag,
          createdBy: command.userId,
          updatedBy: command.userId,
        },
        update: {
          objectKey: reservation.objectKey,
          mimeType: contentType,
          sizeBytes: BigInt(stored.sizeBytes),
          etag: stored.etag,
          updatedBy: command.userId,
          deletedAt: null,
        },
      });
      const activated = await transaction.managedImage.updateMany({
        where: {
          id: reservation.id,
          tenantId: command.tenantId,
          toolCallId: command.toolCallId,
          status: ManagedImageStatus.UPLOADING,
          deletedAt: null,
          resource: { is: { tenantId: command.tenantId, deletedAt: null } },
        },
        data: {
          status: ManagedImageStatus.READY,
          fileObjectId: fileId,
          provider: upstream.execution.provider,
          model: upstream.execution.model,
          contentType,
          readyAt: new Date(),
          failureCode: null,
          failureMessage: null,
          updatedBy: command.userId,
        },
      });
      if (activated.count !== 1) {
        throw new Error('图片资源状态已被取消或恢复流程收束，拒绝覆盖为 READY');
      }
      await transaction.aIActionDraft.upsert({
        where: { toolCallId: command.toolCallId },
        create: {
          tenantId: command.tenantId,
          userId: command.userId,
          actionType: ACTION_TYPE,
          payload: imageActionPayload(command, upstream, reservation.objectKey, stored.sizeBytes),
          status: DraftStatus.EXECUTED,
          toolCallId: command.toolCallId,
          executedResourceType: 'IMAGE',
          executedResourceId: reservation.id,
          createdBy: command.userId,
          updatedBy: command.userId,
        },
        update: {
          payload: imageActionPayload(command, upstream, reservation.objectKey, stored.sizeBytes),
          status: DraftStatus.EXECUTED,
          executedResourceType: 'IMAGE',
          executedResourceId: reservation.id,
          updatedBy: command.userId,
          deletedAt: null,
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
          resourceId: reservation.id,
          requestId: command.requestId,
          metadata: {
            toolCallId: command.toolCallId,
            contentType,
            provider: upstream.execution.provider,
            model: upstream.execution.model,
            sizeBytes: stored.sizeBytes,
            objectKey: reservation.objectKey,
          },
        },
      });
    });
    return {
      imageId: reservation.id,
      contentType,
      sizeBytes: stored.sizeBytes,
      provider: upstream.execution.provider,
      model: upstream.execution.model,
    };
  }

  private async markImageFailure(
    command: GenerateImageCommand,
    imageId: string,
    error: unknown,
    orphaned: boolean,
  ): Promise<void> {
    const code = errorCode(error);
    const message = error instanceof Error ? error.message : '图片生成失败';
    await this.prisma.$transaction(async (transaction) => {
      const failed = await transaction.managedImage.updateMany({
        where: {
          id: imageId,
          tenantId: command.tenantId,
          toolCallId: command.toolCallId,
          status: {
            in: [
              ManagedImageStatus.PENDING,
              ManagedImageStatus.GENERATING,
              ManagedImageStatus.UPLOADING,
            ],
          },
        },
        data: {
          status: orphaned ? ManagedImageStatus.ORPHANED : ManagedImageStatus.FAILED,
          failureCode: code,
          failureMessage: message,
          updatedBy: command.userId,
        },
      });
      // finalizeImage may have committed READY between the catch-path replay
      // check and this transaction. In that case the failure path must become
      // a no-op: never hide a READY resource or overwrite an EXECUTED draft.
      if (failed.count !== 1) return;
      // Keep the failed ManagedImage row for audit/reconciliation, but hide
      // the formal Resource so a failed generation cannot look usable.
      await transaction.resource.updateMany({
        where: { id: imageId, tenantId: command.tenantId, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: command.userId, version: { increment: 1 } },
      });
      await transaction.aIActionDraft.upsert({
        where: { toolCallId: command.toolCallId },
        create: {
          tenantId: command.tenantId,
          userId: command.userId,
          actionType: ACTION_TYPE,
          payload: { prompt: command.prompt, imageId, orphaned },
          status: DraftStatus.FAILED,
          toolCallId: command.toolCallId,
          executedResourceType: 'IMAGE',
          executedResourceId: imageId,
          createdBy: command.userId,
          updatedBy: command.userId,
        },
        update: {
          status: DraftStatus.FAILED,
          payload: { prompt: command.prompt, imageId, orphaned },
          executedResourceType: 'IMAGE',
          executedResourceId: imageId,
          updatedBy: command.userId,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: command.tenantId,
          actorUserId: command.userId,
          actorMembershipId: command.membershipId,
          action: 'IMAGE_GENERATION_FAILED',
          outcome: AuditOutcome.FAILURE,
          resourceType: 'IMAGE',
          resourceId: imageId,
          requestId: command.requestId,
          metadata: { toolCallId: command.toolCallId, code, orphaned },
        },
      });
    });
  }

  private async findReadyImage(
    tenantId: string,
    turnId: string,
    toolCallId: string,
  ): Promise<GeneratedImage | null> {
    const image = await this.prisma.managedImage.findFirst({
      where: {
        tenantId,
        toolCallId,
        toolCall: { is: { tenantId, turnId } },
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        contentType: true,
        provider: true,
        model: true,
        fileObject: { select: { sizeBytes: true, objectKey: true } },
        resource: { select: { deletedAt: true } },
      },
    });
    if (
      !image
      || image.tenantId !== tenantId
      || image.status !== ManagedImageStatus.READY
      || !image.contentType
      || !image.provider
      || !image.model
      || !image.fileObject
      || !image.fileObject.objectKey
      || image.resource.deletedAt
    ) {
      return null;
    }
    return {
      imageId: image.id,
      contentType: image.contentType,
      sizeBytes: Number(image.fileObject.sizeBytes),
      provider: image.provider,
      model: image.model,
    };
  }
}

function imageActionPayload(
  command: GenerateImageCommand,
  upstream: Awaited<ReturnType<AiServiceGateway['generateImage']>>,
  objectKey: string,
  sizeBytes: number,
): Prisma.InputJsonObject {
  const contentType = normalizeImageMimeType(upstream.content_type);
  return {
    prompt: command.prompt,
    size: command.size ?? null,
    quality: command.quality ?? null,
    contentType,
    provider: upstream.execution.provider,
    model: upstream.execution.model,
    objectKey,
    sizeBytes,
  };
}

function extensionOf(contentType: string): string {
  switch (contentType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'IMAGE_GENERATION_FAILED';
}

function decodeBase64Image(value: string): Buffer {
  const normalized = value.replace(/\s+/g, '');
  if (
    !normalized
    || normalized.length % 4 === 1
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error('ai-service 返回了无效的图片 Base64 数据');
  }
  const body = Buffer.from(normalized, 'base64');
  if (body.byteLength === 0) throw new Error('ai-service 返回了空图片');
  return body;
}
