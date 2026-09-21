import { Type } from 'class-transformer';
import { DashboardSnapshotPeriod } from '@prisma/client';
import { IsArray, IsDateString, IsEnum, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class DashboardTaskStatisticsQueryDto {
    @IsOptional()
    @IsUUID()
    projectId?: string;

    @IsOptional()
    @IsISO8601()
    from?: string;

    @IsOptional()
    @IsISO8601()
    to?: string;
}

export class DashboardTodosQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(20)
    taskLimit = 5;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(20)
    reportLimit = 5;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(20)
    meetingLimit = 5;
}

export class DashboardUpcomingMeetingsQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 20;
}

export class DashboardTrendsQueryDto {
    @IsArray() @IsString({ each: true }) metrics!: string[];
    @IsEnum(DashboardSnapshotPeriod) period: DashboardSnapshotPeriod = DashboardSnapshotPeriod.DAY;
    @IsDateString() from!: string;
    @IsDateString() to!: string;
}

export class RebuildDashboardSnapshotDto {
    @IsUUID() tenantId!: string;
    @IsDateString() date!: string;
}
