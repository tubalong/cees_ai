/**
 * 租户时区工具：把绝对时刻换算成租户本地日历，用于业务日界线与项目编码年份。
 *
 * 只依赖运行时的 Intl（Node 24 自带完整 ICU），不引入第三方时区库；
 * 所有函数都要求调用方显式传入 IANA 时区，避免隐式依赖服务器本地时区。
 */

export const DEFAULT_TENANT_TIMEZONE = 'Asia/Shanghai';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** 校验是否为运行时可识别的 IANA 时区标识。 */
export function isValidTimeZone(value: string): boolean {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 64) return false;
    if (formatterCache.has(normalized)) return true;
    try {
        formatterCache.set(normalized, createFormatter(normalized));
        return true;
    } catch {
        return false;
    }
}

/** 该时刻在租户时区中属于哪个自然年，用于项目编码年份与跨年重置。 */
export function calendarYear(timeZone: string, instant: Date): number {
    return localParts(timeZone, instant).year;
}

/** 该时刻所属租户本地自然日的起点（本地 00:00 对应的绝对时刻）。 */
export function startOfLocalDay(timeZone: string, instant: Date): Date {
    const { year, month, day } = localParts(timeZone, instant);
    return zonedWallClockToInstant(timeZone, year, month, day);
}

/** 该时刻所属租户本地自然日偏移若干天后的本地自然日起点。 */
export function addLocalDays(timeZone: string, instant: Date, days: number): Date {
    const { year, month, day } = localParts(timeZone, instant);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return zonedWallClockToInstant(timeZone, shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** 该时刻在租户时区中的自然日，格式为 `YYYY-MM-DD`（用于去重键等业务标识）。 */
export function localDateKey(timeZone: string, instant: Date): string {
    return formatDateKey(localParts(timeZone, instant));
}

/** 该时刻所属租户本地自然日偏移若干天后的自然日标识，格式为 `YYYY-MM-DD`。 */
export function shiftLocalDateKey(timeZone: string, instant: Date, days: number): string {
    const { year, month, day } = localParts(timeZone, instant);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return formatDateKey({
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    });
}

/**
 * 把 `YYYY-MM-DD` 业务日期标识还原成该标识对应的存储时刻。
 * 日报和周报的 `periodStart` 约定为日期标识的 UTC 零点（见 `parseDate`），
 * 因此按租户时区推导业务日期后必须再用本函数换回存储时刻。
 */
export function dateKeyToUtcMidnight(dateKey: string): Date {
    const parsed = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new RangeError(`无法解析业务日期 ${dateKey}`);
    return parsed;
}

/** 把租户本地 YYYY-MM-DD 的 00:00 换算为绝对时刻。 */
export function startOfLocalDate(timeZone: string, dateKey: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) throw new RangeError(`无法解析业务日期 ${dateKey}`);
    return zonedWallClockToInstant(timeZone, Number(match[1]), Number(match[2]), Number(match[3]));
}

interface LocalParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

function formatDateKey(parts: Pick<LocalParts, 'year' | 'month' | 'day'>): string {
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function createFormatter(timeZone: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatter(timeZone: string): Intl.DateTimeFormat {
    const cached = formatterCache.get(timeZone);
    if (cached) return cached;
    const created = createFormatter(timeZone);
    formatterCache.set(timeZone, created);
    return created;
}

function localParts(timeZone: string, instant: Date): LocalParts {
    const parts = formatter(timeZone).formatToParts(instant);
    const read = (type: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'): number => {
        const value = parts.find((part) => part.type === type)?.value;
        if (value === undefined) throw new RangeError(`无法解析时区 ${timeZone} 的本地时间`);
        return Number(value);
    };
    return {
        year: read('year'),
        month: read('month'),
        day: read('day'),
        hour: read('hour'),
        minute: read('minute'),
        second: read('second'),
    };
}

/** 该时刻的时区偏移（本地墙钟时间减绝对时刻）。 */
function offsetMilliseconds(timeZone: string, instant: Date): number {
    const { year, month, day, hour, minute, second } = localParts(timeZone, instant);
    const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * 把租户本地墙钟时间的 00:00 换成绝对时刻。
 * 两轮偏移修正可以覆盖夏令时切换；中国标准时间没有夏令时，第二轮是恒等变换。
 */
function zonedWallClockToInstant(timeZone: string, year: number, month: number, day: number): Date {
    const wallClock = Date.UTC(year, month - 1, day);
    const firstPass = wallClock - offsetMilliseconds(timeZone, new Date(wallClock));
    const secondPass = wallClock - offsetMilliseconds(timeZone, new Date(firstPass));
    return new Date(secondPass);
}
