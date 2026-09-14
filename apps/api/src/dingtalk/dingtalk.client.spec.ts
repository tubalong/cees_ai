import { BadGatewayException } from '@nestjs/common';
import { DingTalkClient } from './dingtalk.client';

describe('DingTalkClient', () => {
    const client = new DingTalkClient();
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock as unknown as typeof fetch;
        process.env.DINGTALK_API_BASE_URL = 'https://dingtalk.test';
    });

    afterAll(() => {
        delete process.env.DINGTALK_API_BASE_URL;
    });

    it('获取凭证并递归部门、分页人员且合并重复人员', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: 'token-1' }))
            .mockResolvedValueOnce(jsonResponse({ errcode: 0, result: [{ dept_id: 2, parent_id: 1, name: '研发部', order: 10 }] }))
            .mockResolvedValueOnce(jsonResponse({ errcode: 0, result: [] }))
            .mockResolvedValueOnce(jsonResponse({ errcode: 0, result: { list: [{ userid: 'u-1', name: '张三', dept_id_list: [1], active: true }], has_more: false } }))
            .mockResolvedValueOnce(jsonResponse({ errcode: 0, result: { list: [{ userid: 'u-1', name: '张三', dept_id_list: [2], title: '工程师', active: true }, { userid: 'u-2', name: '李四', dept_id_list: [2], active: false }], has_more: false } }));

        await expect(client.fetchOrganization({ appKey: 'app-key', appSecret: 'secret' })).resolves.toEqual({
            departments: [{
                externalDepartmentId: '2',
                parentExternalDepartmentId: '1',
                name: '研发部',
                displayOrder: 10,
            }],
            users: [
                {
                    externalUserId: 'u-1',
                    unionId: null,
                    name: '张三',
                    title: '工程师',
                    jobNumber: null,
                    departmentExternalIds: ['1', '2'],
                    active: true,
                    admin: false,
                    boss: false,
                },
                {
                    externalUserId: 'u-2',
                    unionId: null,
                    name: '李四',
                    title: null,
                    jobNumber: null,
                    departmentExternalIds: ['2'],
                    active: false,
                    admin: false,
                    boss: false,
                },
            ],
        });
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(fetchMock.mock.calls[0][0]).toBe('https://dingtalk.test/gettoken?appkey=app-key&appsecret=secret');
    });

    it('将钉钉错误转换为 BadGatewayException', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid app' }));

        const error = await client.verify({ appKey: 'app-key', appSecret: 'secret' }).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(BadGatewayException);
        expect(error).toMatchObject({ response: { code: 'DINGTALK_40001', message: 'invalid app' } });
    });
});

function jsonResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: async () => body,
    } as Response;
}
