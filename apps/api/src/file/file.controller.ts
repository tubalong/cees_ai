import {
    Body,
    Controller,
    Headers,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { CreateUploadSessionDto } from './dto';
import { FileService } from './file.service';
import { FileMetadataResult, UploadSessionResult } from './file.types';

@ApiTags('file')
@ApiBearerAuth()
@Controller('upload-sessions')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class FileController {
    constructor(private readonly fileService: FileService) { }

    /**
     * 创建短时 COS PUT URL。客户端只提交文件元数据；Bucket、租户目录和完整
     * 对象键始终由服务端确定。
     */
    @Post()
    @ApiOperation({
        summary: '创建单文件 COS 直传会话',
        description: 'Bucket、租户目录和完整对象键全部由服务端生成，客户端只提交文件元数据。',
    })
    @ApiHeader({
        name: 'Idempotency-Key',
        required: true,
        description: '同一成员重试同一上传请求时复用的幂等键',
    })
    @ApiCreatedResponse({ description: '已创建单文件直传会话' })
    createUploadSession(
        @Headers('idempotency-key') idempotencyKey: string | undefined,
        @Body() input: CreateUploadSessionDto,
    ): Promise<UploadSessionResult> {
        return this.fileService.createUploadSession(idempotencyKey, input);
    }

    /**
     * API 从 COS 读取对象元数据，并与当前租户成员创建的会话校验一致后，
     * 才会完成上传并创建正式文件记录。
     */
    @Post(':uploadSessionId/complete')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: '校验并完成 COS 直传会话',
        description: '服务端通过 COS HEAD 校验对象存在、大小和 Content-Type 后才创建正式文件记录。',
    })
    @ApiOkResponse({ description: 'COS 对象校验通过并已登记正式文件' })
    completeUploadSession(
        @Param('uploadSessionId', new ParseUUIDPipe()) uploadSessionId: string,
    ): Promise<FileMetadataResult> {
        return this.fileService.completeUploadSession(uploadSessionId);
    }
}
