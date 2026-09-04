import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('system')
@Controller('health')
export class HealthController {
    @Get()
    @ApiOperation({ summary: '服务健康检查' })
    health(): { status: string; service: string } {
        return { status: 'ok', service: 'api' };
    }
}