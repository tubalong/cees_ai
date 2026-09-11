import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

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
