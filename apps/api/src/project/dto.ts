import { Transform, Type } from 'class-transformer';
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { ProjectMemberRole, ProjectStatus } from '@prisma/client';

const PROJECT_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
const EDITABLE_MEMBER_ROLES = [ProjectMemberRole.MANAGER, ProjectMemberRole.MEMBER] as const;

export class ListProjectsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @IsEnum(ProjectStatus)
    status?: ProjectStatus;

    @IsOptional()
    @IsUUID()
    departmentId?: string;

    @IsOptional()
    @IsUUID()
    ownerMembershipId?: string;

    @IsOptional()
    @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
    @IsBoolean()
    includeArchived = false;

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

export class CreateProjectDto {
    @IsString()
    @MinLength(2)
    @MaxLength(32)
    @Matches(PROJECT_CODE_PATTERN)
    code!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @IsUUID()
    ownerMembershipId?: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsDateString()
    startsAt?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsDateString()
    endsAt?: string | null;
}

export class UpdateProjectDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(32)
    @Matches(PROJECT_CODE_PATTERN)
    code?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsDateString()
    startsAt?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsDateString()
    endsAt?: string | null;

    @IsInt()
    @Min(1)
    version!: number;
}

export class ProjectVersionDto {
    @IsInt()
    @Min(1)
    version!: number;
}

export class ProjectReasonDto extends ProjectVersionDto {
    @IsString()
    @MinLength(1)
    @MaxLength(500)
    reason!: string;
}

export class CompleteProjectDto extends ProjectVersionDto {
    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(2000)
    completionSummary?: string | null;
}

export class AddProjectMemberDto {
    @IsUUID()
    membershipId!: string;

    @IsOptional()
    @IsIn(EDITABLE_MEMBER_ROLES)
    role: ProjectMemberRole = ProjectMemberRole.MEMBER;
}

export class UpdateProjectMemberDto extends ProjectVersionDto {
    @IsIn(EDITABLE_MEMBER_ROLES)
    role!: ProjectMemberRole;
}

export class DeleteProjectQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}

export class TransferProjectOwnerDto extends ProjectVersionDto {
    @IsUUID()
    membershipId!: string;
}
