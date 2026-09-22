import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TencentMeetingController } from './tencent-meeting.controller';
import { TencentMeetingGatewayService } from './tencent-meeting-gateway.service';
import { TencentMeetingService } from './tencent-meeting.service';

describe('TencentMeetingController', () => {
    const completeAuthorization = jest.fn();
    const service = { completeAuthorization } as unknown as TencentMeetingService;
    const gateway = {} as TencentMeetingGatewayService;
    const controller = new TencentMeetingController(service, gateway);

    beforeEach(() => jest.clearAllMocks());

    it('回调成功页面不包含授权码或 Token', async () => {
        completeAuthorization.mockResolvedValue({
            success: true,
            title: '腾讯会议连接成功',
            message: '授权已完成，可以关闭此页面并返回 CEES。',
        });
        const response = responseMock();

        await controller.completeAuthorization(
            { state: 's'.repeat(43), auth_code: 'sensitive-auth-code' },
            { headers: { 'x-request-id': 'request-1' } } as unknown as Request,
            response.value,
        );

        expect(response.send).toHaveBeenCalled();
        const html = response.send.mock.calls[0][0] as string;
        expect(html).not.toContain('sensitive-auth-code');
        expect(html).not.toContain('access_token');
    });

    it('回调失败页面只展示受控错误', async () => {
        completeAuthorization.mockRejectedValue(new BadRequestException({
            code: 'OAUTH_STATE_INVALID',
            message: '授权请求无效，请返回 CEES 重新连接',
        }));
        const response = responseMock();

        await controller.completeAuthorization(
            { state: 's'.repeat(43), auth_code: 'secret-code' },
            { headers: {} } as unknown as Request,
            response.value,
        );

        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.send.mock.calls[0][0]).not.toContain('secret-code');
    });
});

function responseMock() {
    const send = jest.fn();
    const type = jest.fn(() => ({ send }));
    const status = jest.fn(() => ({ type }));
    return { value: { status } as unknown as Response, status, type, send };
}
