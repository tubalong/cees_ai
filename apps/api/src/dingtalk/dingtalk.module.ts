import { Module } from '@nestjs/common';
import { DingTalkClient } from './dingtalk.client';
import { DingTalkController } from './dingtalk.controller';
import { DingTalkCredentialCipher } from './dingtalk-credential-cipher';
import { DingTalkService } from './dingtalk.service';

@Module({
    controllers: [DingTalkController],
    providers: [DingTalkClient, DingTalkCredentialCipher, DingTalkService],
    exports: [DingTalkService],
})
export class DingTalkModule { }

