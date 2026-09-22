import {
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../../tenant/tenant-context.interceptor';
import { TenantGuard } from '../../tenant/tenant.guard';
import { AssistantActionDraftService, type ActionDraftResolution } from '../drafts/assistant-action-draft.service';

/**
 * 写操作确认端点。刻意与 `/conversations/*` 分开：确认/取消是「对已有草稿的决策」，
 * 不属于会话资源本身；同时避免与轮次订阅的长连接路由混在一起。
 *
 * 两个端点都只接受 draftId：参数快照存在服务端，客户端无法在确认时替换业务参数。
 */
@ApiTags('Conversation')
@ApiBearerAuth()
@Controller('assistant/action-drafts')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class AssistantActionDraftController {
    constructor(private readonly drafts: AssistantActionDraftService) { }

    @Post(':draftId/confirm')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '确认并执行 AI 写操作草稿' })
    @ApiOkResponse({ description: '草稿已执行；重复确认返回同一结果' })
    confirm(@Param('draftId', new ParseUUIDPipe()) draftId: string): Promise<ActionDraftResolution> {
        return this.drafts.confirm(draftId);
    }

    @Post(':draftId/cancel')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: '取消 AI 写操作草稿' })
    @ApiOkResponse({ description: '草稿已取消，未产生任何业务写入' })
    cancel(@Param('draftId', new ParseUUIDPipe()) draftId: string): Promise<ActionDraftResolution> {
        return this.drafts.cancel(draftId);
    }
}
