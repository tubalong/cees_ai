/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AuthMembership = {
    id: string;
    account: string;
    status: AuthMembership.status;
    roles: Array<string>;
};
export namespace AuthMembership {
    export enum status {
        ACTIVE = 'ACTIVE',
    }
}

