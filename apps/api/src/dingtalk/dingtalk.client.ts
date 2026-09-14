import { BadGatewayException, Injectable } from '@nestjs/common';
import {
    DingTalkCredentials,
    DingTalkDepartmentSnapshot,
    DingTalkOrganizationSnapshot,
    DingTalkUserSnapshot,
} from './dingtalk.types';

interface DingTalkResponse {
    errcode?: number;
    errmsg?: string;
    result?: unknown;
    access_token?: string;
}

@Injectable()
export class DingTalkClient {
    async verify(credentials: DingTalkCredentials): Promise<void> {
        await this.getAccessToken(credentials);
    }

    async fetchOrganization(credentials: DingTalkCredentials): Promise<DingTalkOrganizationSnapshot> {
        const accessToken = await this.getAccessToken(credentials);
        const departments = await this.listAllDepartments(accessToken);
        const users = await this.listAllUsers(accessToken, departments);
        return { departments, users };
    }

    private async getAccessToken(credentials: DingTalkCredentials): Promise<string> {
        const query = new URLSearchParams({ appkey: credentials.appKey, appsecret: credentials.appSecret });
        const response = await this.request(`/gettoken?${query.toString()}`, { method: 'GET' });
        if (typeof response.access_token !== 'string' || !response.access_token) {
            throw this.upstreamError('DINGTALK_ACCESS_TOKEN_INVALID', '钉钉未返回有效 Access Token');
        }
        return response.access_token;
    }

    private async listAllDepartments(accessToken: string): Promise<DingTalkDepartmentSnapshot[]> {
        const departments: DingTalkDepartmentSnapshot[] = [];
        const pendingDepartmentIds = ['1'];
        const visited = new Set<string>();
        while (pendingDepartmentIds.length > 0) {
            const parentDepartmentId = pendingDepartmentIds.shift()!;
            if (visited.has(parentDepartmentId)) continue;
            visited.add(parentDepartmentId);
            if (visited.size > 10_000) {
                throw this.upstreamError('DINGTALK_DEPARTMENT_LIMIT_EXCEEDED', '钉钉部门数量超过同步上限');
            }
            const response = await this.request(`/topapi/v2/department/listsub?access_token=${encodeURIComponent(accessToken)}`, {
                method: 'POST',
                body: JSON.stringify({ dept_id: toDingTalkId(parentDepartmentId) }),
            });
            const children = Array.isArray(response.result)
                ? response.result
                : isRecord(response.result) && Array.isArray(response.result.list)
                    ? response.result.list
                    : [];
            for (const item of children) {
                if (!isRecord(item)) continue;
                const externalDepartmentId = externalId(item.dept_id);
                const name = stringValue(item.name);
                if (!externalDepartmentId || !name) continue;
                departments.push({
                    externalDepartmentId,
                    parentExternalDepartmentId: externalId(item.parent_id) ?? parentDepartmentId,
                    name,
                    displayOrder: integerValue(item.order),
                });
                pendingDepartmentIds.push(externalDepartmentId);
            }
        }
        return departments;
    }

    private async listAllUsers(
        accessToken: string,
        departments: DingTalkDepartmentSnapshot[],
    ): Promise<DingTalkUserSnapshot[]> {
        const usersById = new Map<string, DingTalkUserSnapshot>();
        const departmentIds = ['1', ...departments.map((department) => department.externalDepartmentId)];
        for (const departmentId of departmentIds) {
            let cursor = 0;
            for (let page = 0; page < 10_000; page += 1) {
                const response = await this.request(`/topapi/v2/user/list?access_token=${encodeURIComponent(accessToken)}`, {
                    method: 'POST',
                    body: JSON.stringify({ dept_id: toDingTalkId(departmentId), cursor, size: 100 }),
                });
                const result = isRecord(response.result) ? response.result : {};
                const items = Array.isArray(result.list) ? result.list : [];
                for (const item of items) {
                    if (!isRecord(item)) continue;
                    const externalUserId = externalId(item.userid);
                    const name = stringValue(item.name);
                    if (!externalUserId || !name) continue;
                    const departmentExternalIds = arrayOfExternalIds(item.dept_id_list);
                    const current = usersById.get(externalUserId);
                    usersById.set(externalUserId, {
                        externalUserId,
                        unionId: stringValue(item.unionid),
                        name,
                        title: stringValue(item.title),
                        jobNumber: stringValue(item.job_number),
                        departmentExternalIds: unique([
                            ...(current?.departmentExternalIds ?? []),
                            ...departmentExternalIds,
                            departmentId,
                        ]),
                        active: booleanValue(item.active, true),
                        admin: booleanValue(item.admin, false),
                        boss: booleanValue(item.boss, false),
                    });
                }
                if (!booleanValue(result.has_more, false)) break;
                const nextCursor = integerValue(result.next_cursor);
                if (nextCursor <= cursor) break;
                cursor = nextCursor;
            }
        }
        return [...usersById.values()];
    }

    private async request(path: string, init: RequestInit): Promise<DingTalkResponse> {
        const baseUrl = process.env.DINGTALK_API_BASE_URL?.trim() || 'https://oapi.dingtalk.com';
        let response: Response;
        try {
            response = await fetch(`${baseUrl}${path}`, {
                ...init,
                headers: { 'content-type': 'application/json', ...init.headers },
                signal: AbortSignal.timeout(30_000),
            });
        } catch {
            throw this.upstreamError('DINGTALK_NETWORK_ERROR', '连接钉钉开放平台失败');
        }
        if (!response.ok) {
            throw this.upstreamError('DINGTALK_HTTP_ERROR', `钉钉开放平台返回 HTTP ${response.status}`);
        }
        const payload = await response.json() as DingTalkResponse;
        if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
            throw this.upstreamError(`DINGTALK_${payload.errcode}`, payload.errmsg || '钉钉开放平台调用失败');
        }
        return payload;
    }

    private upstreamError(code: string, message: string): BadGatewayException {
        return new BadGatewayException({ code, message });
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function externalId(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    return null;
}

function integerValue(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function arrayOfExternalIds(value: unknown): string[] {
    return Array.isArray(value) ? value.map(externalId).filter((item): item is string => item !== null) : [];
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

function toDingTalkId(value: string): string | number {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
}
