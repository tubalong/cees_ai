import {
    addLocalDays,
    calendarYear,
    dateKeyToUtcMidnight,
    isValidTimeZone,
    localDateKey,
    localDateTimeText,
    shiftLocalDateKey,
    startOfLocalDay,
    timeZoneOffsetText,
} from './tenant-time';

describe('tenant time helpers', () => {
    it('accepts IANA identifiers and rejects unknown ones', () => {
        expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
        expect(isValidTimeZone('UTC')).toBe(true);
        expect(isValidTimeZone('Mars/Phobos')).toBe(false);
        expect(isValidTimeZone('')).toBe(false);
    });

    it('resolves the calendar year in the tenant time zone', () => {
        const instant = new Date('2026-12-31T16:30:00.000Z');

        expect(calendarYear('Asia/Shanghai', instant)).toBe(2027);
        expect(calendarYear('UTC', instant)).toBe(2026);
    });

    it('resolves local day boundaries and day keys', () => {
        const instant = new Date('2026-09-11T23:30:00.000Z');

        expect(startOfLocalDay('Asia/Shanghai', instant).toISOString()).toBe('2026-09-11T16:00:00.000Z');
        expect(addLocalDays('Asia/Shanghai', instant, 1).toISOString()).toBe('2026-09-12T16:00:00.000Z');
        expect(localDateKey('Asia/Shanghai', instant)).toBe('2026-09-12');
        expect(localDateKey('UTC', instant)).toBe('2026-09-11');
        expect(shiftLocalDateKey('Asia/Shanghai', instant, -1)).toBe('2026-09-11');
    });

    it('bridges a business date key to the stored UTC midnight instant', () => {
        expect(dateKeyToUtcMidnight('2026-09-11').toISOString()).toBe('2026-09-11T00:00:00.000Z');
        expect(() => dateKeyToUtcMidnight('not-a-date')).toThrow(RangeError);
    });

    it('renders the local wall-clock time and UTC offset used by the AI connector clock', () => {
        const instant = new Date('2026-09-29T06:03:00.000Z');

        expect(localDateTimeText('Asia/Shanghai', instant)).toBe('2026-09-29T14:03:00');
        expect(timeZoneOffsetText('Asia/Shanghai', instant)).toBe('+08:00');
        expect(localDateTimeText('UTC', instant)).toBe('2026-09-29T06:03:00');
        expect(timeZoneOffsetText('UTC', instant)).toBe('+00:00');
    });

    it('keeps the local calendar month across the UTC month boundary', () => {
        // UTC 还是 8 月 31 日，租户本地已经是 9 月 1 日；连接器规划必须按租户时区取月份。
        const instant = new Date('2026-08-31T16:30:00.000Z');

        expect(localDateTimeText('Asia/Shanghai', instant)).toBe('2026-09-01T00:30:00');
        expect(timeZoneOffsetText('Asia/Shanghai', instant)).toBe('+08:00');
    });
});
