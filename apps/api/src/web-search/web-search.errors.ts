export type WebSearchErrorCode =
  | 'WEB_SEARCH_NOT_CONFIGURED'
  | 'WEB_SEARCH_TIMEOUT'
  | 'WEB_SEARCH_UNAVAILABLE'
  | 'WEB_SEARCH_INVALID_RESPONSE';

export class WebSearchError extends Error {
  constructor(
    public readonly code: WebSearchErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WebSearchError';
  }
}
