import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { DeleteUserMemoryQueryDto, UpdateUserMemoryDto } from './dto';
import { UserMemoryService } from './user-memory.service';
import type { UserMemoryResult } from './user-memory.types';

@ApiTags('user')
@ApiBearerAuth()
@Controller('user-memories')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class UserMemoryController {
    constructor(private readonly userMemoryService: UserMemoryService) { }

    @Get()
    @ApiOkResponse({ description: '当前成员的用户级记忆列表' })
    @ApiUnauthorizedResponse({ description: '登录状态或租户成员身份无效' })
    list(): Promise<UserMemoryResult[]> {
        return this.userMemoryService.list();
    }

    @Patch(':memoryId')
    @ApiOkResponse({ description: '修改后的记忆' })
    @ApiUnauthorizedResponse({ description: '登录状态或租户成员身份无效' })
    update(
        @Param('memoryId', new ParseUUIDPipe()) memoryId: string,
        @Body() input: UpdateUserMemoryDto,
    ): Promise<UserMemoryResult> {
        return this.userMemoryService.update(memoryId, input);
    }

    @Delete(':memoryId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '记忆已软删除' })
    @ApiUnauthorizedResponse({ description: '登录状态或租户成员身份无效' })
    async remove(
        @Param('memoryId', new ParseUUIDPipe()) memoryId: string,
        @Query() query: DeleteUserMemoryQueryDto,
    ): Promise<void> {
        await this.userMemoryService.remove(memoryId, query.version);
    }
}
