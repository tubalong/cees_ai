import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayUnique,
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import { DataScope } from '@prisma/client';

export class ListRolesQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

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

export class CreateRoleDto {
    @IsString()
    @MinLength(2)
    @MaxLength(64)
    @Matches(/^[a-z][a-z0-9_:-]*$/)
    code!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsEnum(DataScope)
    dataScope!: DataScope;
}

export class UpdateRoleDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string | null;

    @IsOptional()
    @IsEnum(DataScope)
    dataScope?: DataScope;

    @IsInt()
    @Min(1)
    version!: number;
}

export class ReplaceRolePermissionsDto {
    @IsArray()
    @ArrayUnique()
    @ArrayMaxSize(100)
    @IsUUID(undefined, { each: true })
    permissionIds!: string[];

    @IsInt()
    @Min(1)
    version!: number;
}

export class DeleteRoleQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}
