import { Type } from 'class-transformer';
import {
    IsDefined,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { DepartmentStatus, MembershipStatus } from '@prisma/client';

export class ListDepartmentsQueryDto {
    @IsOptional()
    @IsEnum(DepartmentStatus)
    status?: DepartmentStatus;
}

export class CreateDepartmentDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    parentId?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(2147483647)
    sortOrder = 0;
}

export class UpdateDepartmentDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    parentId?: string | null;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(2147483647)
    sortOrder?: number;

    @IsOptional()
    @IsEnum(DepartmentStatus)
    status?: DepartmentStatus;

    @IsInt()
    @Min(1)
    version!: number;
}

export class DeleteDepartmentQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}

export class ListDepartmentMembersQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @IsEnum(MembershipStatus)
    status?: MembershipStatus;

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

export class AssignMemberDepartmentDto {
    @IsDefined()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    departmentId!: string | null;

    @IsInt()
    @Min(1)
    version!: number;
}
