import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Min,
} from 'class-validator';
import { AclSubjectType } from '@prisma/client';

export class CreateResourceAclDto {
    @IsEnum(AclSubjectType)
    subjectType!: AclSubjectType;

    @IsUUID()
    subjectId!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(20)
    @ArrayUnique()
    @IsString({ each: true })
    @Matches(/^document\.(read|update|delete|share)$/, { each: true })
    permissionCodes!: string[];

    @IsOptional()
    @IsDateString()
    expiresAt?: string | null;
}

export class DeleteResourceAclQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}
