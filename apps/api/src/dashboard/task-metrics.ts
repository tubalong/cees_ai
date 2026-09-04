export interface TaskMetricInput {
  status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
  dueDate: Date | null;
}

export function calculateTaskMetrics(tasks: TaskMetricInput[], now: Date): { total: number; overdue: number; completionRate: number } {
  const active = tasks.filter((task) => task.status !== 'CANCELLED');
  const overdue = active.filter((task) => task.dueDate && task.dueDate < now && task.status !== 'DONE').length;
  const done = active.filter((task) => task.status === 'DONE').length;
  return { total: active.length, overdue, completionRate: active.length === 0 ? 0 : done / active.length };
}