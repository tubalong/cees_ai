import { calculateTaskMetrics } from './task-metrics';

describe('task metrics', () => {
  it('calculates overdue tasks without counting done or cancelled tasks', () => {
    const now = new Date('2025-01-10T00:00:00Z');
    const result = calculateTaskMetrics([
      { status: 'TODO', dueDate: new Date('2025-01-09T00:00:00Z') },
      { status: 'DONE', dueDate: new Date('2025-01-08T00:00:00Z') },
      { status: 'CANCELLED', dueDate: new Date('2025-01-07T00:00:00Z') },
    ], now);
    expect(result).toEqual({ total: 2, overdue: 1, completionRate: 0.5 });
  });
});