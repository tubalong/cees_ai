import { Module } from '@nestjs/common';
import { TencentMeetingClient } from './tencent-meeting.client';
import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingController } from './tencent-meeting.controller';
import { TencentMeetingCredentialCipher } from './tencent-meeting-credential-cipher';
import { TencentMeetingGatewayService } from './tencent-meeting-gateway.service';
import { TencentMeetingService } from './tencent-meeting.service';

@Module({
    controllers: [TencentMeetingController],
    providers: [TencentMeetingClient, TencentMeetingConfig, TencentMeetingCredentialCipher, TencentMeetingService, TencentMeetingGatewayService],
    exports: [TencentMeetingGatewayService, TencentMeetingService],
})
export class TencentMeetingModule { }
