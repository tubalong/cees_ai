export interface ImageResult {
    id: string;
    resourceId: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    sizeBytes: number;
    url: string;
    prompt: string | null;
    model: string | null;
    createdAt: Date;
}
