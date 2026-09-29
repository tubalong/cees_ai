import { Type } from 'class-transformer';
import {
    IsEnum,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import { DocumentVisibility } from '@prisma/client';

export class ListDocumentsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    keyword?: string;

    @IsOptional()
    @IsEnum(DocumentVisibility)
    visibility?: DocumentVisibility;

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

export class CreateDocumentDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title!: string;

    @IsString()
    @MaxLength(1_000_000)
    content!: string;

    @IsEnum(DocumentVisibility)
    visibility!: DocumentVisibility;
}

export class UpdateDocumentDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(1_000_000)
    content?: string;

    @IsOptional()
    @IsEnum(DocumentVisibility)
    visibility?: DocumentVisibility;

    @IsInt()
    @Min(1)
    version!: number;
}

export class DeleteDocumentQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    version!: number;
}

export const DOCUMENT_EXPORT_TEMPLATES = [
    'business-standard',
    'editorial-modern',
    'executive-dark',
    'product-story',
    'academic-clean',
    'minimal-mono',
] as const;

export type DocumentExportTemplate = typeof DOCUMENT_EXPORT_TEMPLATES[number];

export class ExportDocumentQueryDto {
    @IsOptional()
    @IsIn(DOCUMENT_EXPORT_TEMPLATES)
    template: DocumentExportTemplate = 'editorial-modern';
}
