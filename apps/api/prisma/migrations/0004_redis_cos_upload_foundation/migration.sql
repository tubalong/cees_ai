-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('ATTACHMENT');

COMMENT ON TYPE "FilePurpose" IS '文件用途，当前仅支持普通附件';

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'FAILED');

COMMENT ON TYPE "UploadSessionStatus" IS '上传会话状态：待上传、已完成、已过期或失败';

-- AlterTable
ALTER TABLE "file_objects"
ADD COLUMN "original_name" TEXT NOT NULL,
ADD COLUMN "purpose" "FilePurpose" NOT NULL DEFAULT 'ATTACHMENT',
ADD COLUMN "storage_provider" TEXT NOT NULL DEFAULT 'TENCENT_COS',
ADD COLUMN "bucket" TEXT NOT NULL,
ADD COLUMN "region" TEXT NOT NULL,
ADD COLUMN "etag" TEXT;

COMMENT ON COLUMN "file_objects"."original_name" IS '上传时的原始文件名，仅作为元数据保存，不参与 COS 对象键生成';
COMMENT ON COLUMN "file_objects"."purpose" IS '文件用途，当前为普通附件';
COMMENT ON COLUMN "file_objects"."storage_provider" IS '对象存储提供商标识';
COMMENT ON COLUMN "file_objects"."bucket" IS '对象所在的 COS Bucket';
COMMENT ON COLUMN "file_objects"."region" IS '对象所在的 COS 地域';
COMMENT ON COLUMN "file_objects"."etag" IS 'COS 返回的对象 ETag，用于对象标识和后续一致性校验';

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "purpose" "FilePurpose" NOT NULL DEFAULT 'ATTACHMENT',
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "expected_size_bytes" BIGINT NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'TENCENT_COS',
    "bucket" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "upload_sessions" IS '客户端直传 COS 前由 API 创建的短期上传会话';
COMMENT ON COLUMN "upload_sessions"."id" IS '上传会话 UUID';
COMMENT ON COLUMN "upload_sessions"."tenant_id" IS '上传会话所属租户 UUID';
COMMENT ON COLUMN "upload_sessions"."file_id" IS '预先生成的正式文件 UUID，完成上传后作为 file_objects 主键';
COMMENT ON COLUMN "upload_sessions"."created_by" IS '创建上传会话的用户 UUID';
COMMENT ON COLUMN "upload_sessions"."created_by_membership_id" IS '创建上传会话的租户成员身份 UUID';
COMMENT ON COLUMN "upload_sessions"."idempotency_key" IS '同一租户成员创建上传会话时使用的幂等键';
COMMENT ON COLUMN "upload_sessions"."request_fingerprint" IS '规范化上传请求的 SHA-256 指纹，用于识别幂等键参数冲突';
COMMENT ON COLUMN "upload_sessions"."purpose" IS '文件用途，当前为普通附件';
COMMENT ON COLUMN "upload_sessions"."original_name" IS '客户端提供的原始文件名，仅保存为元数据';
COMMENT ON COLUMN "upload_sessions"."mime_type" IS '创建会话时声明并在上传完成时通过 COS HEAD 校验的 Content-Type';
COMMENT ON COLUMN "upload_sessions"."expected_size_bytes" IS '创建会话时声明并在上传完成时校验的预期字节数';
COMMENT ON COLUMN "upload_sessions"."storage_provider" IS '对象存储提供商标识';
COMMENT ON COLUMN "upload_sessions"."bucket" IS '本次上传使用的 COS Bucket';
COMMENT ON COLUMN "upload_sessions"."region" IS '本次上传使用的 COS 地域';
COMMENT ON COLUMN "upload_sessions"."object_key" IS '服务端生成的 COS 对象键，客户端不得指定';
COMMENT ON COLUMN "upload_sessions"."status" IS '上传会话当前状态';
COMMENT ON COLUMN "upload_sessions"."expires_at" IS '上传会话及其预签名上传权限的失效时间';
COMMENT ON COLUMN "upload_sessions"."completed_at" IS 'COS 对象校验通过并完成正式文件登记的时间';
COMMENT ON COLUMN "upload_sessions"."failure_code" IS '上传会话失败或过期时记录的稳定失败代码';
COMMENT ON COLUMN "upload_sessions"."created_at" IS '上传会话创建时间';
COMMENT ON COLUMN "upload_sessions"."updated_at" IS '上传会话最后更新时间';

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_bucket_object_key_key" ON "file_objects"("bucket", "object_key");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_file_id_key" ON "upload_sessions"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_idempotency_key"
ON "upload_sessions"("tenant_id", "created_by_membership_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_bucket_object_key_key" ON "upload_sessions"("bucket", "object_key");

-- CreateIndex
CREATE INDEX "upload_sessions_tenant_id_status_expires_at_idx"
ON "upload_sessions"("tenant_id", "status", "expires_at");
