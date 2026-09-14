import { Transform, Type } from 'class-transformer';
import {
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
