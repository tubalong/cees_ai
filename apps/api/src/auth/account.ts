import { pinyin } from 'pinyin-pro';

export const ACCOUNT_MIN_LENGTH = 3;
export const ACCOUNT_MAX_LENGTH = 32;
export const ACCOUNT_PATTERN = /^[a-zA-Z0-9]+$/;

const RESERVED_ACCOUNTS = new Set([
    'admin',
    'administrator',
    'platform',
    'root',
    'support',
    'system',
]);

export function normalizeAccount(account: string): string {
    return account.trim().toLowerCase();
}

export function generateAccountFromDisplayName(displayName: string): string {
    const transliterated = pinyin(displayName.trim(), { toneType: 'none', type: 'array' }).join('');
    const normalized = transliterated.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const base = normalized || 'user';
    return base.slice(0, ACCOUNT_MAX_LENGTH).padEnd(ACCOUNT_MIN_LENGTH, '0');
}

export function isReservedAccount(account: string): boolean {
    return RESERVED_ACCOUNTS.has(normalizeAccount(account));
}

export function appendAccountSuffix(account: string, suffix: number): string {
    const suffixText = String(suffix);
    return `${account.slice(0, ACCOUNT_MAX_LENGTH - suffixText.length)}${suffixText}`;
}
