import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString,
  IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';

export class ProjectWorkflowVersionDto {
  @IsInt() @Min(1) version!: number;
}

export class CreateProjectDecisionDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(10000) problem!: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(10000) background?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(10000) recommendation?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(10000) conclusion?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(10000) rationale?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(2000, { each: true }) risks: string[] = [];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(2000, { each: true }) nextActions: string[] = [];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined, { each: true }) participantMembershipIds: string[] = [];
  @IsOptional() @IsUUID() sourceConversationId?: string | null;
}

export class UpdateProjectDecisionDto extends CreateProjectDecisionDto {
  @IsInt() @Min(1) version!: number;
}

export class PublishProjectDecisionDto extends ProjectWorkflowVersionDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(10000) conclusion?: string | null;
}

export class CreateProjectMilestoneDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(10000) objective!: string;
  @IsDateString({ strict: true }) targetDate!: string;
  @IsUUID() ownerMembershipId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(2000, { each: true }) acceptanceCriteria!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined, { each: true }) taskIds: string[] = [];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID(undefined, { each: true }) decisionIds: string[] = [];
}

export class UpdateProjectMilestoneDto extends CreateProjectMilestoneDto {
  @IsInt() @Min(1) version!: number;
}

export class CompleteProjectMilestoneDto extends ProjectWorkflowVersionDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(5000) acceptanceNote?: string | null;
}

export class CancelProjectMilestoneDto extends ProjectWorkflowVersionDto {
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

export class ReopenProjectMilestoneDto extends ProjectWorkflowVersionDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(2000) reason?: string | null;
}

export class CreateProjectRepositoryDto {
  @IsString() @MinLength(1) @MaxLength(500) url!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) defaultBranch = 'main';
}

export class UpdateProjectRepositoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) url?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) defaultBranch?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsInt() @Min(1) version!: number;
}

export class ListProjectActivitiesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit = 100;
}

export class ProjectRepositoryVersionQueryDto {
  @Type(() => Number) @IsInt() @Min(1) version!: number;
}
