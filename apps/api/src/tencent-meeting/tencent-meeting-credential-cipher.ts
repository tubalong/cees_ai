import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { TencentMeetingConfig } from './tencent-meeting.config';

const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class TencentMeetingCredentialCipher {
    constructor(private readonly config: TencentMeetingConfig) { }

    encrypt(value: string): string {
        const initializationVector = randomBytes(12);
        const cipher = createCipheriv(ALGORITHM, this.config.encryptionKey(), initializationVector);
        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const authenticationTag = cipher.getAuthTag();
        return [initializationVector, authenticationTag, ciphertext]
            .map((part) => part.toString('base64url'))
            .join('.');
    }

    decrypt(value: string): string {
        const parts = value.split('.');
        if (parts.length !== 3) throw new Error('Tencent Meeting credential ciphertext is invalid');
        const [initializationVector, authenticationTag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
        const decipher = createDecipheriv(ALGORITHM, this.config.encryptionKey(), initializationVector);
        decipher.setAuthTag(authenticationTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    }
}
