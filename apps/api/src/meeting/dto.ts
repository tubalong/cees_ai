import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUrl,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import {
    MeetingAttendanceStatus,
    MeetingParticipantRole,
    MeetingResponseStatus,
    MeetingStatus,
} from '@prisma/client';

const TRANSITION_TARGETS = [
    MeetingStatus.SCHEDULED,
    MeetingStatus.IN_PROGRESS,
    MeetingStatus.COMPLETED,
    MeetingStatus.CANCELLED,
] as const;
const RESPONSE_TARGETS = [
    MeetingResponseStatus.ACCEPTED,
    MeetingResponseStatus.DECLINED,
    MeetingResponseStatus.TENTATIVE,
] as const;

export class MeetingAgendaItemDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title!: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(2000)
    description: string | null = null;

    @IsInt()
    @Min(0)
    @Max(100000)
    sortOrder!: number;
}

export class MeetingMinutesActionItemDto {
    @IsString()
    @MinLength(1)
    @MaxLength(500)
    title!: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    ownerMembershipId: string | null = null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsDateString()
    dueDate: string | null = null;
}

export class MeetingMinutesContentDto {
    @IsString()
    @MaxLength(20000)
    summary!: string;

    @IsArray()
    @ArrayMaxSize(100)
    @IsString({ each: true })
    @MinLength(1, { each: true })
    @MaxLength(1000, { each: true })
    decisions!: string[];

    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => MeetingMinutesActionItemDto)
    actionItems!: MeetingMinutesActionItemDto[];

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(50000)
    notes: string | null = null;
}

export class ListMeetingsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @IsEnum(MeetingStatus)
    status?: MeetingStatus;

    @IsOptional()
    @IsUUID()
    projectId?: string;

    @IsOptional()
    @IsUUID()
    departmentId?: string;

    @IsOptional()
    @IsDateString()
    startsFrom?: string;

    @IsOptional()
    @IsDateString()
    startsTo?: string;

    @IsOptional()
    @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
    @IsBoolean()
    includeCancelled = false;

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

export class CreateMeetingDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title!: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(5000)
    description: string | null = null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    projectId: string | null = null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    departmentId: string | null = null;

    @IsDateString()
    startsAt!: string;

    @IsInt()
    @Min(1)
    @Max(1440)
    durationMinutes!: number;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(500)
    location: string | null = null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUrl()
    @MaxLength(2048)
    meetingUrl: string | null = null;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => MeetingAgendaItemDto)
    agenda: MeetingAgendaItemDto[] = [];
}

export class UpdateMeetingDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title?: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(5000)
    description?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    projectId?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @IsDateString()
    startsAt?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(1440)
    durationMinutes?: number;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(500)
    location?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUrl()
    @MaxLength(2048)
    meetingUrl?: string | null;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => MeetingAgendaItemDto)
    agenda?: MeetingAgendaItemDto[];

    @IsInt()
    @Min(1)
    version!: number;
}

export class MeetingTransitionDto {
    @IsIn(TRANSITION_TARGETS)
    status!: MeetingStatus;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(1000)
    reason?: string | null;

    @IsInt()
    @Min(1)
    version!: number;
}

export class AddMeetingParticipantDto {
    @IsUUID()
    membershipId!: string;

    @IsOptional()
    @IsEnum(MeetingParticipantRole)
    role: MeetingParticipantRole = MeetingParticipantRole.PARTICIPANT;
}

export class UpdateMeetingParticipantDto {
    @IsOptional()
    @IsEnum(MeetingParticipantRole)
    role?: MeetingParticipantRole;

    @IsOptional()
    @IsEnum(MeetingAttendanceStatus)
    attendanceStatus?: MeetingAttendanceStatus;

    @IsInt()
    @Min(1)
    version!: number;
}

export class RespondMeetingParticipantDto {
    @IsIn(RESPONSE_TARGETS)
    responseStatus!: MeetingResponseStatus;

    @IsInt()
    @Min(1)
    version!: number;
}

export class UpsertMeetingMinutesDto {
    @ValidateNested()
    @Type(() => MeetingMinutesContentDto)
    content!: MeetingMinutesContentDto;

    @IsOptional()
    @IsInt()
    @Min(1)
    version?: number;
}

export class MeetingVersionDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}
