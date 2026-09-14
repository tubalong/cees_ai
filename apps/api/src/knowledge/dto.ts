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
import { KNOWLEDGE_BASE_MEMBER_PERMISSIONS, KnowledgeBaseMemberPermission } from './knowledge.types';

export class ListKnowledgeBasesQueryDto {
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

export class CreateKnowledgeBaseDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;
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
