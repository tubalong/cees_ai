import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const CHAT_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type PublicChatMode = 'standard' | 'ultra';
export type PublicChatMessageRole = 'user' | 'assistant';

export class ChatMessageDto {
  @ApiProperty({ description: '客户端本地生成并保存的消息稳定标识', maxLength: 128 })
  @IsString()
  @Matches(CHAT_IDENTIFIER_PATTERN)
  id!: string;

  @ApiProperty({ description: '本地对话消息角色', enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: PublicChatMessageRole;

  @ApiProperty({ description: '仅用于本次模型调用的消息正文，API 不持久化', maxLength: 262144 })
  @IsString()
  @MinLength(1)
  @MaxLength(262144)
  content!: string;
}

export class ChatRequestDto {
  @ApiProperty({ description: '客户端本地会话标识，仅用于调用关联和 Token 统计', maxLength: 128 })
  @IsString()
  @Matches(CHAT_IDENTIFIER_PATTERN)
  conversationId!: string;

  @ApiProperty({ description: '客户端本地轮次标识；同一轮的压缩和回答调用使用同一值', maxLength: 128 })
  @IsString()
  @Matches(CHAT_IDENTIFIER_PATTERN)
  turnId!: string;

  @ApiPropertyOptional({
    description: '对话执行模式；省略时使用 standard',
    enum: ['standard', 'ultra'],
    default: 'standard',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['standard', 'ultra'])
  mode: PublicChatMode = 'standard';

  @ApiPropertyOptional({
    description: '客户端本地保存的早期历史摘要；省略或 null 表示没有摘要，API 不持久化',
    nullable: true,
    maxLength: 131072,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(131072)
  conversationSummary?: string | null;

  @ApiProperty({
    description: '按时间升序排列的近期消息；最后一条必须是本轮 user 消息',
    type: [ChatMessageDto],
    minItems: 1,
    maxItems: 128,
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}

export class ChatCompactRequestDto {
  @ApiProperty({ description: '客户端本地会话标识，仅用于调用关联和 Token 统计', maxLength: 128 })
  @IsString()
  @Matches(CHAT_IDENTIFIER_PATTERN)
  conversationId!: string;

  @ApiProperty({ description: '本次压缩归属的客户端本地轮次标识', maxLength: 128 })
  @IsString()
  @Matches(CHAT_IDENTIFIER_PATTERN)
  turnId!: string;

  @ApiPropertyOptional({
    description: '客户端本地保存的上一版摘要；省略或 null 表示首次压缩，API 不持久化',
    nullable: true,
    maxLength: 131072,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(131072)
  previousSummary?: string | null;

  @ApiProperty({
    description: '要压缩的本地历史消息，按时间升序排列',
    type: [ChatMessageDto],
    minItems: 1,
    maxItems: 128,
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}
