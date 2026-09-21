import { Type } from 'class-transformer';
import {
    ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional,
    IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { WorkReportStatus, WorkReportType } from '@prisma/client';

export class WorkReportContentDto {
    @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(2000, { each: true })
    completedItems!: string[];
    @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(2000, { each: true })
    plannedItems!: string[];
    @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(2000, { each: true })
    blockers!: string[];
    @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(5000)
    remarks: string | null = null;
}

abstract class CreateWorkReportDto {
    @IsUUID() reviewerMembershipId!: string;
    @ValidateNested() @Type(() => WorkReportContentDto) content!: WorkReportContentDto;
    @IsOptional() @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined, { each: true }) projectIds: string[] = [];
    @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined, { each: true }) taskIds: string[] = [];
}

export class CreateDailyWorkReportDto extends CreateWorkReportDto {
    @IsDateString({ strict: true }) reportDate!: string;
}

export class CreateWeeklyWorkReportDto extends CreateWorkReportDto {
    @IsDateString({ strict: true }) weekStartDate!: string;
}

export class UpdateWorkReportDto extends CreateWorkReportDto {
    @IsInt() @Min(1) version!: number;
}

export class WorkReportVersionDto {
    @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class ReviewWorkReportDto {
    @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
    @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(5000) comment: string | null = null;
    @IsInt() @Min(1) version!: number;
}

export class ListWorkReportsQueryDto {
    @IsOptional() @IsEnum(WorkReportType) type?: WorkReportType;
    @IsOptional() @IsEnum(WorkReportStatus) status?: WorkReportStatus;
    @IsOptional() @IsUUID() authorMembershipId?: string;
    @IsOptional() @IsUUID() reviewerMembershipId?: string;
    @IsOptional() @IsUUID() projectId?: string;
    @IsOptional() @IsDateString({ strict: true }) periodFrom?: string;
    @IsOptional() @IsDateString({ strict: true }) periodTo?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
    @IsOptional() @IsUUID() cursor?: string;
}

export class WorkReportStatisticsQueryDto {
    @IsOptional() @IsEnum(WorkReportType) type?: WorkReportType;
    @IsOptional() @IsDateString({ strict: true }) periodFrom?: string;
    @IsOptional() @IsDateString({ strict: true }) periodTo?: string;
}
