import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { FinanceExpenseStatus, FinanceLedgerDirection, FinancePaymentMethod } from '@prisma/client';

export class FinanceCursorQueryDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
    limit = 20;

    @IsOptional() @IsUUID()
    cursor?: string;
}

export class CreateFinanceExpenseCategoryDto {
    @IsString() @MinLength(1) @MaxLength(64) code!: string;
    @IsString() @MinLength(1) @MaxLength(120) name!: string;
    @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
    @IsOptional() @IsBoolean() enabled = true;
}

export class UpdateFinanceExpenseCategoryDto {
    @IsOptional() @IsString() @MinLength(1) @MaxLength(64) code?: string;
    @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
    @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
    @IsOptional() @IsBoolean() enabled?: boolean;
    @IsInt() @Min(1) version!: number;
}

export class DeleteFinanceVersionQueryDto {
    @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class FinanceExpenseItemDto {
    @IsUUID() categoryId!: string;
    @IsString() @MinLength(1) @MaxLength(500) description!: string;
    @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
    @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) taxAmount = 0;
    @IsDateString() occurredAt!: string;
    @IsOptional() @IsString() @MaxLength(200) merchantName?: string | null;
    @IsOptional() @IsString() @MaxLength(120) invoiceNumber?: string | null;
    @IsOptional() @IsString() @MaxLength(120) invoiceType?: string | null;
    @IsOptional() @IsUUID() projectId?: string | null;
    @IsOptional() @IsUUID() departmentId?: string | null;
    @IsOptional() @IsString() @MaxLength(1000) remark?: string | null;
}

export class CreateFinanceExpenseReportDto {
    @IsString() @MinLength(1) @MaxLength(120) title!: string;
    @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
    @IsOptional() @IsString() @Length(3, 3) currency = 'CNY';
    @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => FinanceExpenseItemDto)
    items!: FinanceExpenseItemDto[];
    @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true })
    attachmentIds?: string[];
}

export class UpdateFinanceExpenseReportDto extends CreateFinanceExpenseReportDto {
    @IsInt() @Min(1) version!: number;
}

export class ListFinanceExpenseReportsQueryDto extends FinanceCursorQueryDto {
    @IsOptional() @IsString() @MaxLength(100) keyword?: string;
    @IsOptional() @IsEnum(FinanceExpenseStatus) status?: FinanceExpenseStatus;
    @IsOptional() @IsUUID() requesterMembershipId?: string;
    @IsOptional() @IsUUID() departmentId?: string;
    @IsOptional() @IsUUID() projectId?: string;
    @IsOptional() @IsUUID() categoryId?: string;
    @IsOptional() @IsDateString() dateFrom?: string;
    @IsOptional() @IsDateString() dateTo?: string;
}

export class FinanceExpenseVersionDto {
    @IsInt() @Min(1) version!: number;
}

export class FinanceExpenseActionDto extends FinanceExpenseVersionDto {
    @IsOptional() @IsString() @MaxLength(1000) reason?: string | null;
}

export class ReviewFinanceExpenseReportDto extends FinanceExpenseVersionDto {
    @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
    @IsOptional() @IsString() @MaxLength(2000) comment?: string | null;
}

export class MarkFinanceExpenseReportPaidDto extends FinanceExpenseVersionDto {
    @IsDateString() paidAt!: string;
    @IsEnum(FinancePaymentMethod) paymentMethod!: FinancePaymentMethod;
    @IsString() @MinLength(1) @MaxLength(120) paymentReference!: string;
    @IsOptional() @IsString() @MaxLength(1000) comment?: string | null;
}

export class FinanceExpenseSummaryQueryDto {
    @IsDateString() dateFrom!: string;
    @IsDateString() dateTo!: string;
    @IsOptional() @IsUUID() departmentId?: string;
    @IsOptional() @IsUUID() projectId?: string;
    @IsOptional() @IsString() @Length(3, 3) currency = 'CNY';
}

export class FinanceProjectSpendQueryDto {
    @IsUUID() projectId!: string;
    @IsOptional() @IsDateString() dateFrom?: string;
    @IsOptional() @IsDateString() dateTo?: string;
    @IsOptional() @IsString() @Length(3, 3) currency = 'CNY';
}

export class FinanceLedgerRowDto {
    @IsInt() @Min(1) rowNumber!: number;
    @IsDateString() occurredOn!: string;
    @IsEnum(FinanceLedgerDirection) direction!: FinanceLedgerDirection;
    @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
    @IsString() @Length(3, 3) currency = 'CNY';
    @IsOptional() @IsString() @MaxLength(64) categoryCode?: string | null;
    @IsOptional() @IsString() @MaxLength(120) categoryName?: string | null;
    @IsOptional() @IsUUID() departmentId?: string | null;
    @IsOptional() @IsUUID() projectId?: string | null;
    @IsOptional() @IsString() @MaxLength(200) counterparty?: string | null;
    @IsOptional() @IsString() @MaxLength(500) summary?: string | null;
    @IsString() @MinLength(1) @MaxLength(120) voucherNo!: string;
}

export class CreateFinanceLedgerImportDto {
    @IsString() @MinLength(1) @MaxLength(255) fileName!: string;
    @IsOptional() @IsIn(['XLSX', 'CSV']) format = 'XLSX';
    @IsDateString() periodStart!: string;
    @IsDateString() periodEnd!: string;
    /** 可选：原始上传文件对应的文件对象 ID；只有用户勾选「留档原文件」时才携带。 */
    @IsOptional() @IsUUID() sourceFileObjectId?: string;
    @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => FinanceLedgerRowDto)
    rows!: FinanceLedgerRowDto[];
}

/** 导入历史与收支明细共用同一套游标分页参数。 */
export class ListFinanceLedgerImportsQueryDto extends FinanceCursorQueryDto { }

export class ListFinanceLedgerEntriesQueryDto extends FinanceCursorQueryDto {
    @IsOptional() @IsEnum(FinanceLedgerDirection) direction?: FinanceLedgerDirection;
    @IsOptional() @IsDateString() dateFrom?: string;
    @IsOptional() @IsDateString() dateTo?: string;
    @IsOptional() @IsUUID() departmentId?: string;
    @IsOptional() @IsUUID() projectId?: string;
    @IsOptional() @IsString() @MaxLength(120) category?: string;
}
