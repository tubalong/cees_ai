import { Type } from 'class-transformer';
import {
    IsEnum,
    IsInt,
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
import { AuditOutcome, TenantStatus } from '@prisma/client';
import { ACCOUNT_MAX_LENGTH, ACCOUNT_MIN_LENGTH, ACCOUNT_PATTERN } from '../auth/account';

export class InitialTenantAdministratorDto {
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
}

export class CreatePlatformTenantDto {
    @IsString()
    @MinLength(2)
    @MaxLength(64)
    @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
    code!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @ValidateNested()
    @Type(() => InitialTenantAdministratorDto)
    initialAdministrator!: InitialTenantAdministratorDto;
}

export class ListPlatformTenantsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @IsEnum(TenantStatus)
    status?: TenantStatus;

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

export class UpdatePlatformTenantDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsInt()
    @Min(1)
    version!: number;
}

export class SuspendPlatformTenantDto {
    @IsString()
    @MinLength(1)
    @MaxLength(500)
    reason!: string;

    @IsInt()
    @Min(1)
    version!: number;
}

export class VersionDto {
    @IsInt()
    @Min(1)
    version!: number;
}

export class AssignPlatformTenantAdministratorDto {
    @IsString()
    @MinLength(ACCOUNT_MIN_LENGTH)
    @MaxLength(ACCOUNT_MAX_LENGTH)
    @Matches(ACCOUNT_PATTERN)
    account!: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    displayName?: string;
}

export class ListPlatformAuditEventsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    action?: string;

    @IsOptional()
    @IsEnum(AuditOutcome)
    outcome?: AuditOutcome;

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
