import {
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import {
    AICreditCapabilityKind,
    AICreditConfigStatus,
    AICreditMeterType,
} from '@prisma/client';

export const AI_CREDIT_CAPABILITY_CODE_PATTERN = /^[a-z][a-z0-9-]*$/;

export class CreateAICreditCapabilityDto {
    @IsString()
    @Matches(AI_CREDIT_CAPABILITY_CODE_PATTERN)
    @MaxLength(40)
    code!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsEnum(AICreditMeterType)
    meterType: AICreditMeterType = AICreditMeterType.TOKEN;

    @IsOptional()
    @IsEnum(AICreditCapabilityKind)
    capabilityKind: AICreditCapabilityKind = AICreditCapabilityKind.TIER_GATED;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    permissionCode?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder: number = 0;
}

export class UpdateAICreditCapabilityDto {
    @IsOptional()
    @IsString()
    @Matches(AI_CREDIT_CAPABILITY_CODE_PATTERN)
    @MaxLength(40)
    code?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsEnum(AICreditMeterType)
    meterType?: AICreditMeterType;

    @IsOptional()
    @IsEnum(AICreditCapabilityKind)
    capabilityKind?: AICreditCapabilityKind;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    permissionCode?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @IsOptional()
    @IsEnum(AICreditConfigStatus)
    status?: AICreditConfigStatus;

    @IsInt()
    @Min(1)
    version!: number;
}
