import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEmail,
    IsEnum,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import {
    HrAttendanceStatus,
    HrEmployeeChangeStatus,
    HrEmployeeChangeType,
    HrLeaveRequestStatus,
    HrLeaveUnit,
    HrOvertimeRequestStatus,
    HrProfileStatus,
} from '@prisma/client';
import { OmitType, PartialType } from '@nestjs/swagger';

export class CursorQueryDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
    limit = 20;

    @IsOptional() @IsUUID()
    cursor?: string;
}

export class ListHrProfilesQueryDto extends CursorQueryDto {
    @IsOptional() @IsString() @MaxLength(100)
    keyword?: string;

    @IsOptional() @IsUUID()
    departmentId?: string;
}

export class CreateHrProfileDto {
    @IsUUID() membershipId!: string;
    @IsOptional() @IsString() @MaxLength(64) employeeNo?: string | null;
    @IsOptional() @IsUUID() departmentId?: string | null;
    @IsOptional() @IsString() @MaxLength(120) position?: string | null;
    @IsOptional() @IsString() @MaxLength(32) employmentType?: string | null;
    @IsOptional() @IsUUID() managerMembershipId?: string | null;
    @IsOptional() @IsDateString() entryDate?: string | null;
    @IsOptional() @IsDateString() leaveDate?: string | null;
    @IsOptional() @IsString() @MaxLength(64) phone?: string | null;
    @IsOptional() @IsEmail() @MaxLength(120) email?: string | null;
    @IsOptional() @IsString() @MaxLength(32) idType?: string | null;
    @IsOptional() @IsString() @MaxLength(64) idNumber?: string | null;
    @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string | null;
    @IsOptional() @IsString() @MaxLength(64) emergencyContactPhone?: string | null;
    @IsOptional() @IsString() @MaxLength(64) educationLevel?: string | null;
    @IsOptional() @IsString() @MaxLength(64) costCenter?: string | null;
    @IsOptional() @IsString() @MaxLength(64) jobLevel?: string | null;
    @IsOptional() @IsDateString() probationEndDate?: string | null;
    @IsOptional() @IsDateString() regularDate?: string | null;
    @IsOptional() @IsString() @MaxLength(160) workLocation?: string | null;
}

export class UpdateHrProfileDto extends PartialType(OmitType(CreateHrProfileDto, ['membershipId'] as const)) {
    @IsOptional() @IsEnum(HrProfileStatus) status?: HrProfileStatus;
    @IsInt() @Min(1) version!: number;
}

export class CreateHrLeaveTypeDto {
    @IsString() @MinLength(1) @MaxLength(64) code!: string;
    @IsString() @MinLength(1) @MaxLength(120) name!: string;
    @IsEnum(HrLeaveUnit) unit!: HrLeaveUnit;
    @IsBoolean() paid!: boolean;
    @IsOptional() @IsNumber() @Min(0) defaultDays?: number | null;
    @IsOptional() @IsBoolean() enabled = true;
}

export class UpdateHrLeaveTypeDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(64) code?: string;
    @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
    @IsOptional() @IsEnum(HrLeaveUnit) unit?: HrLeaveUnit;
    @IsOptional() @IsBoolean() paid?: boolean;
    @IsOptional() @IsNumber() @Min(0) defaultDays?: number | null;
    @IsOptional() @IsBoolean() enabled?: boolean;
    @IsInt() @Min(1) version!: number;
}

export class DeleteVersionQueryDto {
    @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class ListHrLeaveBalancesQueryDto extends CursorQueryDto {
    @IsOptional() @IsUUID() membershipId?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(2024) @Max(2100) year?: number;
}

export class AdjustHrLeaveBalanceDto {
    @IsUUID() membershipId!: string;
    @IsUUID() leaveTypeId!: string;
    @IsInt() @Min(2024) @Max(2100) year!: number;
    @IsNumber() deltaDays!: number;
    @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ListHrLeaveRequestsQueryDto extends CursorQueryDto {
    @IsOptional() @IsEnum(HrLeaveRequestStatus) status?: HrLeaveRequestStatus;
    @IsOptional() @IsUUID() membershipId?: string;
}

export class CreateHrLeaveRequestDto {
    @IsUUID() leaveTypeId!: string;
    @IsDateString() startAt!: string;
    @IsDateString() endAt!: string;
    /** 可选一致性校验值；服务端按申请时间与假期单位折算后以服务端结果为准。 */
    @IsOptional() @IsNumber() @Min(0.01) durationDays?: number;
    @IsOptional() @IsString() @MaxLength(2000) reason?: string | null;
}

export class ReviewRequestDto {
    @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
    @IsOptional() @IsString() @MaxLength(500) comment?: string | null;
    @IsInt() @Min(1) version!: number;
}

export class CancelHrLeaveRequestDto extends DeleteVersionQueryDto {
    @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}

export class ListHrAttendanceRecordsQueryDto extends CursorQueryDto {
    @IsOptional() @IsUUID() membershipId?: string;
    @IsOptional() @IsDateString() dateFrom?: string;
    @IsOptional() @IsDateString() dateTo?: string;
    @IsOptional() @IsEnum(HrAttendanceStatus) status?: HrAttendanceStatus;
}

export class CreateHrAttendanceRecordDto {
    @IsUUID() membershipId!: string;
    @IsDateString() workDate!: string;
    @IsOptional() @IsDateString() checkInAt?: string | null;
    @IsOptional() @IsDateString() checkOutAt?: string | null;
    @IsEnum(HrAttendanceStatus) status!: HrAttendanceStatus;
    @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class ImportHrAttendanceRecordsDto {
    @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => CreateHrAttendanceRecordDto)
    records!: CreateHrAttendanceRecordDto[];
}

export class UpdateHrAttendanceRecordDto {
    @IsOptional() @IsDateString() checkInAt?: string | null;
    @IsOptional() @IsDateString() checkOutAt?: string | null;
    @IsOptional() @IsEnum(HrAttendanceStatus) status?: HrAttendanceStatus;
    @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
    @IsInt() @Min(1) version!: number;
}

export class ListHrOvertimeRequestsQueryDto extends CursorQueryDto {
    @IsOptional() @IsUUID() membershipId?: string;
    @IsOptional() @IsEnum(HrOvertimeRequestStatus) status?: HrOvertimeRequestStatus;
}

export class CreateHrOvertimeRequestDto {
    @IsDateString() startAt!: string;
    @IsDateString() endAt!: string;
    @IsNumber() @Min(0.01) durationHours!: number;
    @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

export class ListHrEmployeeChangesQueryDto extends CursorQueryDto {
    @IsOptional() @IsUUID() membershipId?: string;
    @IsOptional() @IsEnum(HrEmployeeChangeType) type?: HrEmployeeChangeType;
    @IsOptional() @IsEnum(HrEmployeeChangeStatus) status?: HrEmployeeChangeStatus;
}

export class CreateHrEmployeeChangeDto {
    @IsUUID() membershipId!: string;
    @IsEnum(HrEmployeeChangeType) type!: HrEmployeeChangeType;
    @IsDateString() effectiveDate!: string;
    @IsOptional() @IsUUID() fromDepartmentId?: string | null;
    @IsOptional() @IsUUID() toDepartmentId?: string | null;
    @IsOptional() @IsString() @MaxLength(120) fromPosition?: string | null;
    @IsOptional() @IsString() @MaxLength(120) toPosition?: string | null;
    @IsOptional() @IsUUID() fromManagerMembershipId?: string | null;
    @IsOptional() @IsUUID() toManagerMembershipId?: string | null;
    @IsOptional() @IsString() @MaxLength(2000) reason?: string | null;
}

export class HeadcountReportQueryDto {
    @IsOptional() @IsUUID() departmentId?: string;
    @IsOptional() @IsDateString() asOf?: string;
}

export class LeaveSummaryReportQueryDto {
    @Type(() => Number) @IsInt() @Min(2024) @Max(2100) year!: number;
    @IsOptional() @IsUUID() departmentId?: string;
    @IsOptional() @IsUUID() leaveTypeId?: string;
}

export class DateRangeReportQueryDto {
    @IsDateString() dateFrom!: string;
    @IsDateString() dateTo!: string;
    @IsOptional() @IsUUID() departmentId?: string;
}
