export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const badRequest = message => new ApiError(400, 'invalid_request', message);
export const forbidden = () => new ApiError(403, 'permission_denied', 'The credential does not allow this operation');
export function identifier(value) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,127}$/u.test(value)) throw badRequest('Invalid identifier');
  return value;
}
export function object(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !keys.includes(key))) throw badRequest('Unexpected request fields');
  return value;
}
