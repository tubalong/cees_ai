import { Type } from 'class-transformer';
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
} from 'class-validator';
import { MembershipStatus } from '@prisma/client';
import { ACCOUNT_MAX_LENGTH, ACCOUNT_MIN_LENGTH, ACCOUNT_PATTERN } from '../auth/account';

export class UpdateTenantDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(64)
    timezone?: string;

    @IsInt()
    @Min(1)
    version!: number;
}

export class ListTenantMembersQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @IsEnum(MembershipStatus)
    status?: MembershipStatus;

    @IsOptional()
    @IsUUID()
    roleId?: string;

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

export class UpdateTenantMemberDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    displayName?: string;

    @IsOptional()
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @IsIn([MembershipStatus.ACTIVE, MembershipStatus.DISABLED])
    status?: MembershipStatus;

    @IsInt()
    @Min(1)
    version!: number;
}

export class AccountSuggestionDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    displayName!: string;
}

export class UpdateTenantMemberAccountDto {
    @IsString()
    @MinLength(ACCOUNT_MIN_LENGTH)
    @MaxLength(ACCOUNT_MAX_LENGTH)
    @Matches(ACCOUNT_PATTERN)
    account!: string;

    @IsInt()
    @Min(1)
    version!: number;
}

export class ReplaceTenantMemberRolesDto {
    @IsArray()
    @ArrayUnique()
    @ArrayMaxSize(100)
    @IsUUID(undefined, { each: true })
    roleIds!: string[];

    @IsInt()
    @Min(1)
    version!: number;
}
