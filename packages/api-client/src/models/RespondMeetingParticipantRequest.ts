/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type RespondMeetingParticipantRequest = {
    responseStatus: RespondMeetingParticipantRequest.responseStatus;
    version: number;
};
export namespace RespondMeetingParticipantRequest {
    export enum responseStatus {
        ACCEPTED = 'ACCEPTED',
        DECLINED = 'DECLINED',
        TENTATIVE = 'TENTATIVE',
    }
}

