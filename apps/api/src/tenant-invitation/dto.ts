import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayUnique,
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
    Matches,
} from 'class-validator';
import { TenantInvitationStatus } from '@prisma/client';
import { ACCOUNT_MAX_LENGTH, ACCOUNT_MIN_LENGTH, ACCOUNT_PATTERN } from '../auth/account';

export class ListTenantInvitationsQueryDto {
    @IsOptional()
    @IsEnum(TenantInvitationStatus)
    status?: TenantInvitationStatus;

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

export class CreateTenantInvitationDto {
    @IsOptional()
    @IsString()
    @MinLength(ACCOUNT_MIN_LENGTH)
    @MaxLength(ACCOUNT_MAX_LENGTH)
    @Matches(ACCOUNT_PATTERN)
    account?: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    displayName!: string;

    @IsArray()
    @ArrayUnique()
    @ArrayMaxSize(100)
    @IsUUID(undefined, { each: true })
    roleIds!: string[];
}

export class AcceptTenantInvitationDto {
    @IsString()
    @MinLength(2)
    @MaxLength(64)
    @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
    tenantCode!: string;

    @IsString()
    @MinLength(ACCOUNT_MIN_LENGTH)
    @MaxLength(ACCOUNT_MAX_LENGTH)
    @Matches(ACCOUNT_PATTERN)
    account!: string;

    @IsString()
    @MinLength(32)
    @MaxLength(512)
    invitationToken!: string;

    @IsString()
    @MinLength(8)
    @MaxLength(128)
    password!: string;
}
