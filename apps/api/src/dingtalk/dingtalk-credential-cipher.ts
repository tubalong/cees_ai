import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class DingTalkCredentialCipher {
    encrypt(value: string): string {
        const initializationVector = randomBytes(12);
        const cipher = createCipheriv(ALGORITHM, this.key(), initializationVector);
        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const authenticationTag = cipher.getAuthTag();
        return [initializationVector, authenticationTag, ciphertext]
            .map((part) => part.toString('base64url'))
            .join('.');
    }

    decrypt(value: string): string {
        const parts = value.split('.');
        if (parts.length !== 3) throw new Error('DingTalk credential ciphertext is invalid');
        const [initializationVector, authenticationTag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
        const decipher = createDecipheriv(ALGORITHM, this.key(), initializationVector);
        decipher.setAuthTag(authenticationTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    }

    private key(): Buffer {
        const raw = process.env.DINGTALK_CREDENTIAL_ENCRYPTION_KEY?.trim();
        if (!raw) throw new Error('DINGTALK_CREDENTIAL_ENCRYPTION_KEY is required');
        const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
        if (key.length !== 32) {
            throw new Error('DINGTALK_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64');
        }
        return key;
    }
}

