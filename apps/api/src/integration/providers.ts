export interface NotificationProvider {
  send(input: Record<string, unknown>): Promise<{ providerMessageId: string }>;
}

export interface AttendanceProvider {
  listAttendance(input: { tenantId: string; from: Date; to: Date }): Promise<Record<string, unknown>[]>;
}

export class InAppNotificationProvider implements NotificationProvider {
  async send(): Promise<{ providerMessageId: string }> {
    return { providerMessageId: `in_app_${Date.now()}` };
  }
}