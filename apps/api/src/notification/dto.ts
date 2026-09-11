import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID, Max, IsInt, Min } from 'class-validator';

export class ListNotificationsQueryDto {
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    unreadOnly = false;

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
