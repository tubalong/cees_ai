import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateUploadSessionDto {
    @ApiProperty({ enum: ['attachment'], description: '基础版本仅支持普通附件' })
    @IsString()
    @IsIn(['attachment'])
    purpose!: 'attachment';

    @ApiProperty({ maxLength: 255, description: '原始文件名，仅保存为元数据，不参与 COS 路径生成' })
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    fileName!: string;

    @ApiProperty({ example: 'application/pdf', maxLength: 255 })
    @IsString()
    @MinLength(3)
    @MaxLength(255)
    contentType!: string;

    @ApiProperty({ minimum: 1, maximum: 524_288_000, description: '文件字节数' })
    @IsInt()
    @Min(1)
    @Max(524_288_000)
    sizeBytes!: number;
}
