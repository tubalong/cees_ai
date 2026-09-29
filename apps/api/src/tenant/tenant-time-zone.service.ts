import { Injectable } from '@nestjs/common';
import { DEFAULT_TENANT_TIMEZONE, isValidTimeZone } from '../common/tenant-time';
import { PrismaService } from '../database/prisma.service';

/**
 * 租户时区解析。
 *
 * AI 连接器规划需要把「今天/本周/这个月」这类相对表达换算成具体日期，必须使用
 * 租户本地时区而不是服务器时区，否则跨时区租户会算错查询窗口。只读取
 * `Tenant.timezone`（见 `0030_tenant_timezone` 迁移），不改变任何数据。
 */
@Injectable()
export class TenantTimeZoneService {
    constructor(private readonly prisma: PrismaService) { }

    /** 租户时区缺失或非法时回退到平台默认时区。 */
    async resolve(tenantId: string): Promise<string> {
        const tenant = await this.prisma.tenant.findFirst({
            where: { id: tenantId, deletedAt: null },
            select: { timezone: true },
        });
        const timezone = tenant?.timezone?.trim();
        if (!timezone || !isValidTimeZone(timezone)) return DEFAULT_TENANT_TIMEZONE;
        return timezone;
    }
}
