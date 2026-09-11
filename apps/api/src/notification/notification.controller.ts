import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { ListNotificationsQueryDto } from './dto';
import { NotificationService } from './notification.service';
import { NotificationListResult, NotificationResult } from './notification.types';

@ApiTags('notification')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
@RequirePermissions('notification.read')
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    @Get()
    @ApiOkResponse({ description: '\u5f53\u524d\u6210\u5458\u7684\u901a\u77e5\u5217\u8868' })
    list(@Query() query: ListNotificationsQueryDto): Promise<NotificationListResult> {
        return this.notificationService.list(query);
    }

    @Get('unread-count')
    @ApiOkResponse({ description: '\u5f53\u524d\u6210\u5458\u7684\u672a\u8bfb\u901a\u77e5\u6570' })
    unreadCount(): Promise<{ unreadCount: number }> {
        return this.notificationService.unreadCount();
    }

    @Post('read-all')
    @ApiOkResponse({ description: '\u5df2\u6279\u91cf\u6807\u8bb0\u901a\u77e5\u4e3a\u5df2\u8bfb' })
    markAllRead(): Promise<{ updatedCount: number }> {
        return this.notificationService.markAllRead();
    }

    @Post(':notificationId/read')
    @ApiOkResponse({ description: '\u901a\u77e5\u5df2\u6807\u8bb0\u4e3a\u5df2\u8bfb' })
    markRead(@Param('notificationId', new ParseUUIDPipe()) notificationId: string): Promise<NotificationResult> {
        return this.notificationService.markRead(notificationId);
    }
}
