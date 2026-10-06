import { ApiError, badRequest } from './errors.mjs';

export function page(rows, params) {
  const limitText = params.get('limit'), limit = limitText === null ? 20 : Number(limitText);
  const order = params.get('order') ?? 'asc';
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (limitText !== null && !/^[0-9]+$/.test(limitText)) || !['asc', 'desc'].includes(order)) throw badRequest('limit must be 1..100 and order must be asc or desc');
  const ordered = order === 'desc' ? [...rows].reverse() : rows;
  const after = params.get('after');
  const offset = after === null ? 0 : ordered.findIndex(row => row.id === after) + 1;
  if (after !== null && offset === 0) throw new ApiError(400, 'invalid_cursor', 'Cursor not present in this authorized collection');
  const data = ordered.slice(offset, offset + limit);
  return { object: 'list', data, has_more: offset + data.length < ordered.length, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null };
}
