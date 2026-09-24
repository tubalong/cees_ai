import {
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
    AICreditConfigStatus,
    AICreditSubscriptionDuration,
} from '@prisma/client';

export const AI_CREDIT_TIER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const AI_CREDIT_MONEY_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

export class AICreditTierPriceInputDto {
    @IsEnum(AICreditSubscriptionDuration)
    duration!: AICreditSubscriptionDuration;

    @IsString()
    @Matches(AI_CREDIT_MONEY_PATTERN)
    tierPrice!: string;

    @IsString()
    @Matches(AI_CREDIT_MONEY_PATTERN)
    unitPrice!: string;
}

export class CreateAICreditTierDto {
    @IsString()
    @Matches(AI_CREDIT_TIER_CODE_PATTERN)
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

    @IsString()
    @Matches(AI_CREDIT_MONEY_PATTERN)
    monthlyBaseCredits!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => AICreditTierPriceInputDto)
    prices!: AICreditTierPriceInputDto[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(40, { each: true })
    capabilityCodes?: string[];
}

export class UpdateAICreditTierDto {
    @IsInt()
    @Min(1)
    version!: number;

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
    @IsString()
    @Matches(AI_CREDIT_MONEY_PATTERN)
    monthlyBaseCredits?: string;

    @IsOptional()
    @IsEnum(AICreditConfigStatus)
    status?: AICreditConfigStatus;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => AICreditTierPriceInputDto)
    prices?: AICreditTierPriceInputDto[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @MaxLength(40, { each: true })
    capabilityCodes?: string[];
}
