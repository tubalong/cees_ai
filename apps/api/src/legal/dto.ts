import { Type } from 'class-transformer';
import {
    ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional,
    IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { LegalContractStatus, LegalContractType } from '@prisma/client';

export class LegalCursorQueryDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
    limit = 20;

    @IsOptional() @IsUUID()
    cursor?: string;
}

export class CreateLegalContractDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(64) contractNo?: string;
    @IsString() @MinLength(1) @MaxLength(160) name!: string;
    @IsString() @MinLength(1) @MaxLength(160) counterparty!: string;
    @IsEnum(LegalContractType) type!: LegalContractType;
    @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount?: number | null;
    @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency = 'CNY';
    @IsDateString() startDate!: string;
    @IsOptional() @IsDateString() endDate?: string | null;
    @IsOptional() @IsDateString() signedAt?: string | null;
    @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
    @IsUUID() ownerMembershipId!: string;
    @IsOptional() @IsUUID() departmentId?: string | null;
    @IsOptional() @IsUUID() projectId?: string | null;
    @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) renewalReminderDays = 30;
    @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true })
    attachmentIds: string[] = [];
}

export class UpdateLegalContractDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(64) contractNo?: string;
    @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
    @IsOptional() @IsString() @MinLength(1) @MaxLength(160) counterparty?: string;
    @IsOptional() @IsEnum(LegalContractType) type?: LegalContractType;
    @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount?: number | null;
    @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
    @IsOptional() @IsDateString() startDate?: string;
    @IsOptional() @IsDateString() endDate?: string | null;
    @IsOptional() @IsDateString() signedAt?: string | null;
    @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
    @IsOptional() @IsUUID() ownerMembershipId?: string;
    @IsOptional() @IsUUID() departmentId?: string | null;
    @IsOptional() @IsUUID() projectId?: string | null;
    @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) renewalReminderDays?: number;
    @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true })
    attachmentIds?: string[];
    @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class ListLegalContractsQueryDto extends LegalCursorQueryDto {
    @IsOptional() @IsString() @MaxLength(100) keyword?: string;
    @IsOptional() @IsEnum(LegalContractStatus) status?: LegalContractStatus;
    @IsOptional() @IsEnum(LegalContractType) type?: LegalContractType;
    @IsOptional() @IsUUID() ownerMembershipId?: string;
    @IsOptional() @IsUUID() departmentId?: string;
    @IsOptional() @IsUUID() projectId?: string;
    @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
    @IsOptional() @IsDateString() endDateFrom?: string;
    @IsOptional() @IsDateString() endDateTo?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) expiringWithinDays?: number;
}

export class LegalContractVersionQueryDto {
    @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class LegalContractActionDto {
    @IsOptional() @IsString() @MaxLength(1000) comment?: string | null;
    @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class RenewLegalContractDto extends LegalContractActionDto {
    @IsDateString() newEndDate!: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) renewalReminderDays?: number;
}

export class TerminateLegalContractDto {
    @IsDateString() effectiveDate!: string;
    @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
    @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class LegalContractSummaryQueryDto {
    @IsOptional() @IsDateString() asOf?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) expiringWithinDays = 30;
}
