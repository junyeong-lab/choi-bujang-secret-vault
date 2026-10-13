// Stable typed resource identifiers for the server to distinguish memo and notice zones.
export function memoResourceId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return 'memo:' + id;
}
export function noticeResourceId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return 'notice:' + id;
}
