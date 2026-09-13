import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { PublicTurnMode } from './assistant.types';

export class CreateConversationRequestDto {
  @ApiPropertyOptional({
    description: '会话标题；省略时服务端在首轮完成后根据首条消息自动生成',
    nullable: true,
    minLength: 1,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  title?: string | null;
}

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ description: '每页数量，默认 20，最大 100', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: '分页游标，上一页返回的 nextCursor', maxLength: 256 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  cursor?: string;
}

export class CreateTurnRequestDto {
  @ApiProperty({ description: '本轮 user 消息正文；历史消息与摘要由服务端加载', minLength: 1, maxLength: 262144 })
  @IsString()
  @MinLength(1)
  @MaxLength(262144)
  content!: string;

  @ApiPropertyOptional({
    description: '对话执行模式；省略时使用 standard',
    enum: ['standard', 'ultra'],
    default: 'standard',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['standard', 'ultra'])
  mode: PublicTurnMode = 'standard';
}

export class ReplayTurnEventsQueryDto {
  @ApiPropertyOptional({
    description: '已收到的最后事件序号；省略时从首个事件开始重放',
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSeq = 0;
}
