import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingCredentialCipher } from './tencent-meeting-credential-cipher';

describe('TencentMeetingCredentialCipher', () => {
    const config = { encryptionKey: jest.fn(() => Buffer.alloc(32, 7)) } as unknown as TencentMeetingConfig;
    const cipher = new TencentMeetingCredentialCipher(config);

    it('使用认证加密保存 Token 且密文不包含明文', () => {
        const encrypted = cipher.encrypt('access-token-secret');

        expect(encrypted).not.toContain('access-token-secret');
        expect(cipher.decrypt(encrypted)).toBe('access-token-secret');
    });

    it('拒绝被篡改的密文', () => {
        const encrypted = cipher.encrypt('refresh-token-secret');
        const parts = encrypted.split('.');
        const ciphertext = Buffer.from(parts[2], 'base64url');
        ciphertext[0] ^= 1;
        const tampered = `${parts[0]}.${parts[1]}.${ciphertext.toString('base64url')}`;

        expect(() => cipher.decrypt(tampered)).toThrow();
    });
});
