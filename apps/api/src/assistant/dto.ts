import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  Matches,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  ConnectorContextInput,
  ConnectorRoutingCandidateInput,
  ConnectorRoutingProvider,
  ConnectorRoutingState,
  DingTalkConnectorToolInput,
  PublicTurnMode,
  TencentMeetingConnectorToolInput,
  WeComConnectorToolInput,
  GitHubConnectorToolInput,
  PageAssistantContextInput,
  GenerationOptionsInput,
} from './assistant.types';

export class ConnectorContextDto implements ConnectorContextInput {
  @ApiProperty({ enum: ['DINGTALK', 'TENCENT_MEETING', 'WECOM', 'GITHUB', 'LOCAL_SYSTEM'] })
  @IsIn(['DINGTALK', 'TENCENT_MEETING', 'WECOM', 'GITHUB', 'LOCAL_SYSTEM'])
  provider!: ConnectorContextInput['provider'];

  @ApiProperty({ maxLength: 120, pattern: '^[A-Za-z][A-Za-z0-9._-]{0,119}$' })
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9._-]{0,119}$/)
  @MaxLength(120)
  toolId!: string;

  @ApiProperty({ maxLength: 240 })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  toolName!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  fetchedAt!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  data!: Record<string, unknown>;
}

export class DingTalkConnectorToolDto implements DingTalkConnectorToolInput {
  @ApiProperty({ maxLength: 80, pattern: '^dws_read_[a-f0-9]{16}$' })
  @IsString()
  @Matches(/^dws_read_[a-f0-9]{16}$/)
  @MaxLength(80)
  toolId!: string;

  @ApiProperty({ maxLength: 240 })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  parameters!: Record<string, unknown>;
}

export class PlanDingTalkConnectorRequestDto {
  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  query!: string;

  @ApiProperty({ type: [DingTalkConnectorToolDto], maxItems: 1500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1500)
  @Type(() => DingTalkConnectorToolDto)
  @ValidateNested({ each: true })
  tools!: DingTalkConnectorToolDto[];
}

export class TencentMeetingConnectorToolDto implements TencentMeetingConnectorToolInput {
  @ApiProperty({ maxLength: 120, pattern: '^[A-Za-z][A-Za-z0-9._-]{0,119}$' })
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9._-]{0,119}$/)
  @MaxLength(120)
  toolId!: string;

  @ApiProperty({ maxLength: 240 })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  parameters!: Record<string, unknown>;

  @ApiProperty({ enum: ['READ', 'WRITE', 'DESTRUCTIVE'] })
  @IsIn(['READ', 'WRITE', 'DESTRUCTIVE'])
  riskLevel!: 'READ' | 'WRITE' | 'DESTRUCTIVE';

  @ApiProperty()
  @IsBoolean()
  requiresConfirmation!: boolean;
}

export class PlanTencentMeetingConnectorRequestDto {
  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  query!: string;

  @ApiProperty({ type: [TencentMeetingConnectorToolDto], maxItems: 128 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(128)
  @Type(() => TencentMeetingConnectorToolDto)
  @ValidateNested({ each: true })
  tools!: TencentMeetingConnectorToolDto[];
}

export class WeComConnectorToolDto implements WeComConnectorToolInput {
  @ApiProperty({ maxLength: 120, pattern: '^[A-Za-z][A-Za-z0-9._-]{0,119}$' })
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9._-]{0,119}$/)
  @MaxLength(120)
  toolId!: string;

  @ApiProperty({ maxLength: 240 })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  parameters!: Record<string, unknown>;

  @ApiProperty({ enum: ['READ', 'WRITE', 'DESTRUCTIVE'] })
  @IsIn(['READ', 'WRITE', 'DESTRUCTIVE'])
  riskLevel!: 'READ' | 'WRITE' | 'DESTRUCTIVE';

  @ApiProperty()
  @IsBoolean()
  requiresConfirmation!: boolean;
}

export class PlanWeComConnectorRequestDto {
  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  query!: string;

  @ApiProperty({ type: [WeComConnectorToolDto], maxItems: 256 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @Type(() => WeComConnectorToolDto)
  @ValidateNested({ each: true })
  tools!: WeComConnectorToolDto[];
}

export class GitHubOAuthExchangeRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 512 })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  code!: string;

  @ApiProperty({ minLength: 43, maxLength: 256, pattern: '^[A-Za-z0-9._~-]+$' })
  @IsString()
  @MinLength(43)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9._~-]+$/)
  codeVerifier!: string;

  @ApiProperty({ pattern: '^http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}/oauth/github/callback$' })
  @IsString()
  @Matches(/^http:\/\/127\.0\.0\.1:(?:[1-9][0-9]{0,4})\/oauth\/github\/callback$/)
  redirectUri!: string;
}
export class GitHubConnectorToolDto implements GitHubConnectorToolInput {
  @ApiProperty({ maxLength: 120, pattern: '^[A-Za-z][A-Za-z0-9._-]{0,119}$' })
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9._-]{0,119}$/)
  @MaxLength(120)
  toolId!: string;

  @ApiProperty({ maxLength: 240 })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  parameters!: Record<string, unknown>;

  @ApiProperty({ enum: ['READ', 'WRITE', 'DESTRUCTIVE'] })
  @IsIn(['READ', 'WRITE', 'DESTRUCTIVE'])
  riskLevel!: 'READ' | 'WRITE' | 'DESTRUCTIVE';

  @ApiProperty()
  @IsBoolean()
  requiresConfirmation!: boolean;
}

export class PlanGitHubConnectorRequestDto {
  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  query!: string;

  @ApiProperty({ type: [GitHubConnectorToolDto], maxItems: 256 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @Type(() => GitHubConnectorToolDto)
  @ValidateNested({ each: true })
  tools!: GitHubConnectorToolDto[];
}

export class ConnectorRoutingCandidateDto implements ConnectorRoutingCandidateInput {
  @ApiProperty({ enum: ['DINGTALK', 'TENCENT_MEETING', 'WECOM', 'GITHUB'] })
  @IsIn(['DINGTALK', 'TENCENT_MEETING', 'WECOM', 'GITHUB'])
  provider!: ConnectorRoutingProvider;

  @ApiProperty({ minLength: 1, maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  displayName!: string;

  @ApiProperty({ minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  capabilitySummary!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  routingExamples?: string[];

  @ApiProperty({ enum: ['NOT_INSTALLED', 'AUTH_REQUIRED', 'PROFILE_REQUIRED', 'READY', 'ERROR'] })
  @IsIn(['NOT_INSTALLED', 'AUTH_REQUIRED', 'PROFILE_REQUIRED', 'READY', 'ERROR'])
  state!: ConnectorRoutingState;

  @ApiPropertyOptional({ minimum: 0, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  toolCount?: number;
}

export class RouteConnectorRequestDto {
  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  query!: string;

  @ApiProperty({ type: [ConnectorRoutingCandidateDto], minItems: 1, maxItems: 8 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @Type(() => ConnectorRoutingCandidateDto)
  @ValidateNested({ each: true })
  connectors!: ConnectorRoutingCandidateDto[];
}

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

  @ApiPropertyOptional({
    description: '会话默认对话执行模式；省略时使用 standard',
    enum: ['standard', 'ultra'],
    default: 'standard',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['standard', 'ultra'])
  mode?: PublicTurnMode;
}

export class UpdateConversationRequestDto {
  @ApiProperty({ description: '新的会话标题', minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  title!: string;

  @ApiPropertyOptional({
    description: '历史兼容字段：不再参与校验（每次发起轮次都会递增会话版本，旧客户端持有的版本必然过期），保留仅为兼容老客户端',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class DeleteConversationQueryDto {
  @ApiProperty({ description: '当前会话版本，用于防止并发误删', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
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
  @ApiPropertyOptional({
    description: '本轮 user 消息正文；可与 imageFileIds 同时提供，至少提供正文或一张图片',
    nullable: true,
    minLength: 1,
    maxLength: 262144,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(262144)
  content?: string | null;

  @ApiPropertyOptional({
    description: '本轮 user 消息引用的已上传图片文件 ID；服务端会校验归属、MIME、大小并在调用模型前生成短期 URL',
    type: [String],
    maxItems: 8,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsUUID(undefined, { each: true })
  imageFileIds?: string[];

  @ApiPropertyOptional({
    description: '本轮 user 消息引用的已上传文档文件 ID；服务端会校验归属并在调用模型前抽取文本注入上下文',
    type: [String],
    maxItems: 8,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsUUID(undefined, { each: true })
  fileIds?: string[];

  @ApiPropertyOptional({
    description: 'Desktop 从本地已授权连接器读取的本轮只读上下文；服务端仅用于回答，不作为业务写入和权限依据',
    type: [ConnectorContextDto],
    maxItems: 5,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Type(() => ConnectorContextDto)
  @ValidateNested({ each: true })
  connectorContexts?: ConnectorContextDto[];
  @ApiPropertyOptional({
    description: '当前管理页面提供的结构化 AI 助手上下文；只用于本轮回答，不作为业务写入或权限依据',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  assistantContext?: PageAssistantContextInput;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: '当前生成图片或文档的结构化界面选项，不作为用户正文保存' })
  @IsOptional()
  @IsObject()
  generationOptions?: GenerationOptionsInput;

  @ApiPropertyOptional({
    description: '本轮对话执行模式；省略时使用会话的默认模式',
    enum: ['standard', 'ultra'],
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['standard', 'ultra'])
  mode?: PublicTurnMode;

  @ApiPropertyOptional({
    description: '本轮是否允许检索知识库；省略时默认关闭，检索范围按用户权限折叠',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  knowledgeBaseEnabled?: boolean;

  @ApiPropertyOptional({
    description: '本轮是否允许联网搜索；省略时默认关闭。关闭时 AI 不获得联网检索工具；'
      + '若用户消息明确提到需要联网，服务端可为本轮自动临时启用并在 started 事件的 capabilities.autoEnabled 回传',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  webSearchEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Desktop 连接器语义路由判定目标不唯一时注入的本轮消歧提示；与 assistantContext 相同，只用于本轮回答'
      + '，不落库、不作为业务写入或权限依据，也不属于 ConnectorContext 事实通道',
    nullable: true,
    minLength: 1,
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  connectorRoutingHint?: string | null;
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
