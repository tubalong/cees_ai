import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemoryType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateUserMemoryDto {
    @ApiPropertyOptional({
        description: '记忆正文；与 type 至少提供一个',
        minLength: 1,
        maxLength: 200,
    })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    content?: string;

    @ApiPropertyOptional({ description: '记忆类型；与 content 至少提供一个', enum: MemoryType })
    @IsOptional()
    @IsEnum(MemoryType)
    type?: MemoryType;

    @ApiProperty({ description: '当前记忆版本，用于乐观并发控制', minimum: 1 })
    @IsInt()
    @Min(1)
    version!: number;
}

export class DeleteUserMemoryQueryDto {
    @ApiProperty({ description: '当前记忆版本，用于防止并发误删', minimum: 1 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}
