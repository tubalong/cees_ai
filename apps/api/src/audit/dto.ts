import { Type } from 'class-transformer';
import {
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
} from 'class-validator';
import { AuditOutcome } from '@prisma/client';

export class ListAuditEventsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    action?: string;

    @IsOptional()
    @IsEnum(AuditOutcome)
    outcome?: AuditOutcome;

    @IsOptional()
    @IsUUID()
    actorId?: string;

    @IsOptional()
    @IsUUID()
    membershipId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    resourceType?: string;

    @IsOptional()
    @IsUUID()
    resourceId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    requestId?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 50;

    @IsOptional()
    @IsUUID()
    cursor?: string;
}
