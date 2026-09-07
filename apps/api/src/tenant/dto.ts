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
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import { MembershipStatus } from '@prisma/client';

export class UpdateTenantDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsInt()
    @Min(1)
    version!: number;
}

export class ListTenantMembersQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @IsEnum(MembershipStatus)
    status?: MembershipStatus;

    @IsOptional()
    @IsUUID()
    roleId?: string;

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

export class UpdateTenantMemberDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    displayName?: string;

    @IsOptional()
    @IsUUID()
    departmentId?: string | null;

    @IsOptional()
    @IsEnum(MembershipStatus)
    status?: MembershipStatus;

    @IsInt()
    @Min(1)
    version!: number;
}

export class ReplaceTenantMemberRolesDto {
    @IsArray()
    @ArrayUnique()
    @ArrayMaxSize(100)
    @IsUUID(undefined, { each: true })
    roleIds!: string[];

    @IsInt()
    @Min(1)
    version!: number;
}
