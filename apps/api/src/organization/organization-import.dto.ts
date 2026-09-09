import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
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
    ValidateNested,
} from 'class-validator';
import { ACCOUNT_MAX_LENGTH, ACCOUNT_MIN_LENGTH, ACCOUNT_PATTERN } from '../auth/account';

export const ORGANIZATION_IMPORT_MAX_DEPARTMENTS = 200;
export const ORGANIZATION_IMPORT_MAX_MEMBERS = 500;
export const ORGANIZATION_IMPORT_MAX_DEPTH = 10;

const CLIENT_REF_PATTERN = /^[A-Za-z0-9_-]+$/;
const NON_BLANK_PATTERN = /\S/;
const DEPARTMENT_NAME_PATTERN = /^(?!\s*$)[^/]+$/;

export class OrganizationImportDepartmentDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    @Matches(CLIENT_REF_PATTERN)
    clientRef!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    @Matches(DEPARTMENT_NAME_PATTERN)
    name!: string;

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    @Matches(CLIENT_REF_PATTERN)
    parentClientRef?: string | null;

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

export class OrganizationImportMemberDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    @Matches(CLIENT_REF_PATTERN)
    clientRef!: string;

    @IsString()
    @MinLength(ACCOUNT_MIN_LENGTH)
    @MaxLength(ACCOUNT_MAX_LENGTH)
    @Matches(ACCOUNT_PATTERN)
    account!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    @Matches(NON_BLANK_PATTERN)
    displayName!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    @Matches(CLIENT_REF_PATTERN)
    departmentClientRef!: string;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    roleIds?: string[];
}

export class OrganizationImportDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    defaultRoleIds!: string[];

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(ORGANIZATION_IMPORT_MAX_DEPARTMENTS)
    @ValidateNested({ each: true })
    @Type(() => OrganizationImportDepartmentDto)
    departments!: OrganizationImportDepartmentDto[];

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(ORGANIZATION_IMPORT_MAX_MEMBERS)
    @ValidateNested({ each: true })
    @Type(() => OrganizationImportMemberDto)
    members!: OrganizationImportMemberDto[];

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(30)
    activationExpiresInDays = 7;
}
