// 9단계: 반 엔진에서 검증해 전달한 가상 조회 사건만 대상으로 합니다.
// 계약에 없는 deviceId, network, location이나 클라이언트 신원 정보를 만들어 내지 않습니다.
// 토큰·메모·실명·원본 사건은 저장하거나 로그로 남기지 않습니다.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_NORMAL_READS = 120;

// Input fields are limited to { at, method, identity: { sub } }.
// The returned proposal belongs to this separate detector, never to decide(request).
export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');

  const readsBySubject = new Map();
  for (const event of events) {
    if (event?.method !== 'GET') continue;
    const subject = event?.identity?.sub;
    const at = event?.at;
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 256 ||
        typeof at !== 'string') continue;

    const time = Date.parse(at);
    if (!Number.isFinite(time)) continue;

    let times = readsBySubject.get(subject);
    if (!times) {
      times = [];
      readsBySubject.set(subject, times);
    }
    times.push(time);
  }

  // Sort each pseudonymous user's GET events so unordered delivery cannot
  // hide a 10-minute burst. Other users' events never share this window.
  let earliest = null;
  for (const [subject, times] of readsBySubject) {
    if (times.length <= MAX_NORMAL_READS) continue;
    times.sort((a, b) => a - b);
    let start = 0;
    for (let end = 0; end < times.length; end += 1) {
      while (times[end] - times[start] > WINDOW_MS) start += 1;
      if (end - start + 1 > MAX_NORMAL_READS) {
        if (!earliest || times[end] < earliest.at ||
            (times[end] === earliest.at && subject < earliest.subject)) {
          earliest = { at: times[end], subject };
        }
        break;
      }
    }
  }

  if (!earliest) return { action: 'observe' };
  // Contract only provides a pseudonymous subject, not an authenticated
  // device identifier. This is a proposal; it does not revoke anything.
  return { action: 'propose_revocation', reasonCode: 'burst_read', subject: earliest.subject };
}
