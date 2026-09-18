import { Type } from 'class-transformer';
import {
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import {
    KNOWLEDGE_BASE_MEMBER_PERMISSIONS,
    KNOWLEDGE_BASE_VISIBILITY_SCOPES,
    KNOWLEDGE_DOCUMENT_SOURCE_TYPES,
    KNOWLEDGE_DOCUMENT_VISIBILITY_SCOPES,
    KnowledgeBaseMemberPermission,
    KnowledgeBaseVisibilityScope,
    KnowledgeDocumentSourceType,
    KnowledgeDocumentVisibilityScope,
} from './knowledge.types';

export class ListKnowledgeBasesQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    /** 只列出当前用户达到该成员权限的知识库（转存目标库选择）；省略时按可见范围返回。 */
    @IsOptional()
    @IsIn(KNOWLEDGE_BASE_MEMBER_PERMISSIONS)
    permission?: KnowledgeBaseMemberPermission;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 20;

    @IsOptional()
    @IsUUID()
    cursor?: string;
}

export class CreateKnowledgeBaseDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    /** 库级归属，默认 PRIVATE（仅成员可见）。DEPARTMENT 必填 departmentId，PROJECT 必填 projectId。 */
    @IsOptional()
    @IsIn(KNOWLEDGE_BASE_VISIBILITY_SCOPES)
    visibilityScope?: KnowledgeBaseVisibilityScope;

    @IsOptional()
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @IsUUID()
    projectId?: string | null;
}

export class UpdateKnowledgeBaseDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    /** 修改库级归属；与锚点配套校验（DEPARTMENT 必填 departmentId，PROJECT 必填 projectId）。 */
    @IsOptional()
    @IsIn(KNOWLEDGE_BASE_VISIBILITY_SCOPES)
    visibilityScope?: KnowledgeBaseVisibilityScope;

    @IsOptional()
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @IsUUID()
    projectId?: string | null;

    @IsInt()
    @Min(1)
    version!: number;
}

export class DeleteKnowledgeBaseQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}

export class CreateKnowledgeBaseMemberDto {
    @IsUUID()
    membershipId!: string;

    @IsIn(KNOWLEDGE_BASE_MEMBER_PERMISSIONS)
    permission!: KnowledgeBaseMemberPermission;
}

export class UpdateKnowledgeBaseMemberDto {
    @IsIn(KNOWLEDGE_BASE_MEMBER_PERMISSIONS)
    permission!: KnowledgeBaseMemberPermission;
}

export class ListKnowledgeBaseMembersQueryDto {
    @IsOptional()
    @IsUUID()
    cursor?: string;
}

export class ListKnowledgeDocumentsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 20;

    @IsOptional()
    @IsUUID()
    cursor?: string;
}

export class CreateKnowledgeDocumentDto {
    /** 人工上传路径：已上传完成的文件对象 ID；与 sourceType/sourceId 二选一。 */
    @IsOptional()
    @IsUUID()
    fileObjectId?: string;

    /** 转存路径（块 7c）：来源类型，与 sourceId 配套。 */
    @IsOptional()
    @IsIn(KNOWLEDGE_DOCUMENT_SOURCE_TYPES)
    sourceType?: KnowledgeDocumentSourceType;

    /** 转存路径：来源资源 ID（附件 FileObject / AI 文档 / 对话消息）。 */
    @IsOptional()
    @IsUUID()
    sourceId?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    name?: string;

    @IsIn(KNOWLEDGE_DOCUMENT_VISIBILITY_SCOPES)
    visibilityScope!: KnowledgeDocumentVisibilityScope;

    @IsOptional()
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @IsUUID()
    projectId?: string | null;
}

export class CreateKnowledgeDocumentVersionDto {
    @IsUUID()
    fileObjectId!: string;

    @IsIn(KNOWLEDGE_DOCUMENT_VISIBILITY_SCOPES)
    visibilityScope!: KnowledgeDocumentVisibilityScope;

    @IsOptional()
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @IsUUID()
    projectId?: string | null;
}

export class QueryKnowledgeBaseDto {
    @IsString()
    @MinLength(1)
    @MaxLength(4096)
    query!: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(64)
    indexVersion?: string;
}
