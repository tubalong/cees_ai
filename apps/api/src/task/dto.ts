import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { TaskPriority, TaskStatus } from '@prisma/client';

const TRANSITION_TARGETS = [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.DONE, TaskStatus.CANCELLED] as const;

export class ListTasksQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @IsEnum(TaskStatus)
    status?: TaskStatus;

    @IsOptional()
    @IsEnum(TaskPriority)
    priority?: TaskPriority;

    @IsOptional()
    @IsUUID()
    assigneeMembershipId?: string;

    @IsOptional()
    @IsUUID()
    parentId?: string;

    @IsOptional()
    @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
    @IsBoolean()
    rootOnly = false;

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

export class CreateTaskDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title!: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(10000)
    description?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    parentId?: string | null;

    @IsOptional()
    @IsEnum(TaskPriority)
    priority: TaskPriority = TaskPriority.MEDIUM;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsDateString()
    dueDate?: string | null;

    @IsUUID()
    ownerMembershipId!: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(100)
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    collaboratorMembershipIds: string[] = [];

    @IsOptional()
    @IsUUID()
    decisionId?: string | null;
}

export class UpdateTaskDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title?: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(10000)
    description?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    parentId?: string | null;

    @IsOptional()
    @IsEnum(TaskPriority)
    priority?: TaskPriority;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsDateString()
    dueDate?: string | null;

    @IsInt()
    @Min(1)
    version!: number;
}

export class TaskTransitionDto {
    @IsIn(TRANSITION_TARGETS)
    status!: TaskStatus;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(500)
    reason?: string | null;

    @IsInt()
    @Min(1)
    version!: number;
}

export class ReplaceTaskAssigneesDto {
    @IsUUID()
    ownerMembershipId!: string;

    @IsArray()
    @ArrayMaxSize(100)
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    collaboratorMembershipIds!: string[];

    @IsInt()
    @Min(1)
    version!: number;
}

export class ListTaskEntriesQueryDto {
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

export class CreateTaskCommentDto {
    @IsString()
    @MinLength(1)
    @MaxLength(5000)
    content!: string;
}

export class UpdateTaskCommentDto extends CreateTaskCommentDto {
    @IsInt()
    @Min(1)
    version!: number;
}

export class AddTaskAttachmentDto {
    @IsUUID()
    fileObjectId!: string;
}

export class TaskVersionQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}
