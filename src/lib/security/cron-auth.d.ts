export function isCronRequestAuthorized(
  headers: Pick<Headers, 'get'>,
  secret?: string
): boolean;
