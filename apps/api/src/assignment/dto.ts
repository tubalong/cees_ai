import { Type } from 'class-transformer';
import {
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import {
    AssignmentPolicyDomain,
    AssignmentPolicyFallbackMode,
    AssignmentPolicyLevel,
} from '@prisma/client';

export class AssignmentCandidatePoolDto {
    @IsArray()
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    membershipIds: string[] = [];

    @IsArray()
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    departmentIds: string[] = [];

    @IsArray()
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    projectIds: string[] = [];
}

export class ListAssignmentPoliciesQueryDto {
    @IsOptional()
    @IsEnum(AssignmentPolicyDomain)
    domain?: AssignmentPolicyDomain;

    @IsOptional()
    @IsUUID()
    projectId?: string;

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

export class CreateAssignmentPolicyDto {
    @IsEnum(AssignmentPolicyDomain)
    domain!: AssignmentPolicyDomain;

    @IsEnum(AssignmentPolicyLevel)
    level!: AssignmentPolicyLevel;

    @IsOptional()
    @IsUUID()
    projectId?: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    @Type(() => AssignmentCandidatePoolDto)
    @ValidateNested()
    candidatePool!: AssignmentCandidatePoolDto;

    @IsBoolean()
    skipOnLeave!: boolean;

    @IsEnum(AssignmentPolicyFallbackMode)
    fallbackMode!: AssignmentPolicyFallbackMode;

    @IsOptional()
    @IsBoolean()
    enabled = true;
}

export class UpdateAssignmentPolicyDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    @IsOptional()
    @Type(() => AssignmentCandidatePoolDto)
    @ValidateNested()
    candidatePool?: AssignmentCandidatePoolDto;

    @IsOptional()
    @IsBoolean()
    skipOnLeave?: boolean;

    @IsOptional()
    @IsEnum(AssignmentPolicyFallbackMode)
    fallbackMode?: AssignmentPolicyFallbackMode;

    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsInt()
    @Min(1)
    version!: number;
}

export class AssignmentPolicyResolveContextDto {
    @IsString()
    @MinLength(1)
    @MaxLength(64)
    sourceType!: string;

    @IsUUID()
    sourceId!: string;
}

export class AssignmentPolicyAvailabilityWindowDto {
    @IsDateString()
    startAt!: string;

    @IsDateString()
    endAt!: string;
}

export class ResolveAssignmentPolicyDto {
    @IsEnum(AssignmentPolicyDomain)
    domain!: AssignmentPolicyDomain;

    @IsOptional()
    @IsUUID()
    projectId?: string;

    @IsOptional()
    @Type(() => AssignmentPolicyResolveContextDto)
    @ValidateNested()
    context?: AssignmentPolicyResolveContextDto;

    @IsOptional()
    @Type(() => AssignmentPolicyAvailabilityWindowDto)
    @ValidateNested()
    availabilityWindow?: AssignmentPolicyAvailabilityWindowDto;
}

export class DeleteAssignmentPolicyQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}
