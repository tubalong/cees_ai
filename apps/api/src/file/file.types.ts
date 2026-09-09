export interface UploadSessionResult {
    uploadSessionId: string;
    fileId: string;
    purpose: 'attachment';
    uploadMode: 'single';
    status: 'PENDING';
    expiresAt: Date;
    upload: {
        method: 'PUT';
        url: string;
        headers: Record<string, string>;
    };
}

export interface FileMetadataResult {
    id: string;
    purpose: 'attachment';
    fileName: string;
    contentType: string;
    sizeBytes: number;
    etag: string | null;
    createdAt: Date;
}
