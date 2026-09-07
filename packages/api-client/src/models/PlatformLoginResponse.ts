/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PlatformAdministratorIdentity } from './PlatformAdministratorIdentity';
import type { TokenPairResponse } from './TokenPairResponse';
export type PlatformLoginResponse = (TokenPairResponse & {
    administrator: PlatformAdministratorIdentity;
});

