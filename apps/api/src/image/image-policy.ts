/** Shared policy for images that may enter an Assistant multimodal request. */
export const ASSISTANT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AssistantImageMimeType = (typeof ASSISTANT_IMAGE_MIME_TYPES)[number];

export const ASSISTANT_MAX_IMAGE_COUNT = 8;
export const ASSISTANT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(ASSISTANT_IMAGE_MIME_TYPES);

export function normalizeImageMimeType(value: string): string {
  return value.trim().toLowerCase().split(';', 1)[0] ?? '';
}

export function isSupportedImageMimeType(value: string): value is AssistantImageMimeType {
  return SUPPORTED_IMAGE_MIME_TYPES.has(normalizeImageMimeType(value));
}
