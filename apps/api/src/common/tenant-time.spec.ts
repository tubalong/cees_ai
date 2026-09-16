import {
    addLocalDays,
    calendarYear,
    dateKeyToUtcMidnight,
    isValidTimeZone,
    localDateKey,
    shiftLocalDateKey,
    startOfLocalDay,
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
});
