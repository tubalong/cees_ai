import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayUnique,
    IsArray,
    IsEnum,
    IsInt,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { DingTalkIntegrationStatus } from '@prisma/client';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;

export class CreateDingTalkIntegrationDto {
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    @Matches(IDENTIFIER_PATTERN)
    corpId!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(128)
    appKey!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(512)
    appSecret!: string;
}

export class UpdateDingTalkIntegrationDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    appKey?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(512)
    appSecret?: string;

    @IsOptional()
    @IsEnum(DingTalkIntegrationStatus)
    @IsIn([DingTalkIntegrationStatus.ACTIVE, DingTalkIntegrationStatus.DISABLED])
    status?: DingTalkIntegrationStatus;

    @IsInt()
    @Min(1)
    version!: number;
}

export class ListDingTalkOrganizationQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 50;

    @IsOptional()
    @IsUUID()
    cursor?: string;

    @IsOptional()
    @Transform(({ value }) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.toLowerCase() === 'true';
        return false;
    })
    includeDeleted = false;
}

export class ListDingTalkSyncJobsQueryDto {
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

export class DingTalkDepartmentMappingResolutionDto {
    @IsUUID()
    dingtalkDepartmentId!: string;

    @IsString()
    @IsIn(['BIND_EXISTING', 'CREATE', 'SKIP'])
    action!: 'BIND_EXISTING' | 'CREATE' | 'SKIP';

    @IsOptional()
    @IsUUID()
    departmentId?: string;
}

export class DingTalkUserMappingResolutionDto {
    @IsUUID()
    dingtalkUserId!: string;

    @IsString()
    @IsIn(['BIND_EXISTING', 'CREATE', 'SKIP'])
    action!: 'BIND_EXISTING' | 'CREATE' | 'SKIP';

    @IsOptional()
    @IsUUID()
    membershipId?: string;

    @IsOptional()
    @IsString()
    @MinLength(3)
    @MaxLength(32)
    @Matches(/^[a-zA-Z0-9]+$/)
    account?: string;
}

export class DingTalkRoleAssignmentDto {
    @IsUUID()
    roleId!: string;

    @IsArray()
    @ArrayUnique()
    @ArrayMaxSize(1000)
    @IsUUID(undefined, { each: true })
    dingtalkUserIds!: string[];
}

export class PreviewDingTalkMappingDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(30)
    activationExpiresInDays = 7;

    @IsOptional()
    createMissingDepartments = true;

    @IsOptional()
    createMissingMembers = true;
}

export class ApplyDingTalkMappingDto extends PreviewDingTalkMappingDto {
    @IsOptional()
    @Type(() => DingTalkDepartmentMappingResolutionDto)
    @ValidateNested({ each: true })
    departmentResolutions: DingTalkDepartmentMappingResolutionDto[] = [];

    @IsOptional()
    @Type(() => DingTalkUserMappingResolutionDto)
    @ValidateNested({ each: true })
    userResolutions: DingTalkUserMappingResolutionDto[] = [];

    @IsOptional()
    @Type(() => DingTalkRoleAssignmentDto)
    @ValidateNested({ each: true })
    roleAssignments?: DingTalkRoleAssignmentDto[] = [];
}
