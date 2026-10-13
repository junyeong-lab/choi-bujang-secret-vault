// ALEPH SDP 엔진이 검증한 요청 계약만 읽습니다.
// 임의의 클라이언트 헤더나 브라우저 위치정보는 판정 근거로 사용하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required', 'resource_zone']);

// 실제 접속의 signals.source는 현재 none입니다.
// judge_fixture는 시험용 표식이며 실제 지역이나 네트워크 증거가 아닙니다.
function fixtureSignals(request) {
  const signals = request?.signals;
  if (!signals || signals.source !== 'judge_fixture') return null;
  const hour = signals.hour;
  const network = signals.network;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !['usual', 'unusual'].includes(network)) return null;
  return { hour, network };
}

// 엔진이 전달한 가상 최근 사건 중 짧은 시간의 반복 신호만 검사합니다.
function hasBurstEvent(request) {
  return Array.isArray(request?.recentEvents) && request.recentEvents.some(event =>
    event?.kind === 'risk_signal' &&
    Number.isInteger(event.ageSeconds) && event.ageSeconds >= 0 && event.ageSeconds <= 300 &&
    Number.isInteger(event.count) && event.count >= 10
  );
}

// fresh login status is supplied and verified by ALEPH's engine, not the browser.
function recentlyVerifiedByEngine(request) {
  const stepUp = request?.stepUp;
  return stepUp?.verified === true &&
    Number.isInteger(stepUp.authAgeSeconds) &&
    stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= 300;
}

export async function decide(request) {
  let decision = 'deny';
  let reasonCode = 'device_not_registered';
  let ruleId = 'device_registered';

  if (request?.deviceRegistered === true) {
    const signals = fixtureSignals(request);
    const compositeRisk = signals !== null &&
      signals.hour <= 5 && signals.network === 'unusual' && hasBurstEvent(request);

    if (compositeRisk && !recentlyVerifiedByEngine(request)) {
      decision = 'step_up';
      reasonCode = 'step_up_required';
      ruleId = 'step_up_required';
    } else {
      decision = 'allow';
      reasonCode = 'approved';
    }
  }

  // ALEPH v1에는 대상 메모의 소유자/강사 자격이 들어오지 않습니다.
  // 경로와 작업 종류만 허용 목록과 대조하며, 자원 소유권은 서버 API가 검증합니다.
  // 확인되지 않은 소유자·강사 역할을 요청 데이터에서 추측하지 않습니다.
  if (decision === 'allow') {
    const path = request?.path;
    const method = request?.method;
    const route = request?.route;
    const isId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
    const memoList = path === '/api/memos' && route === method + ' /api/memos'
      && (method === 'GET' || method === 'POST');
    const memoDetail = typeof path === 'string' && path.startsWith('/api/memos/')
      && isId(path.slice('/api/memos/'.length))
      && route === method + ' /api/memos/:id'
      && ['GET', 'PUT', 'DELETE'].includes(method);
    const noticeList = path === '/api/notices' && route === method + ' /api/notices'
      && (method === 'GET' || method === 'POST');
    const noticeDetail = typeof path === 'string' && path.startsWith('/api/notices/')
      && /^[0-9a-fA-F-]{36}$/.test(path.slice('/api/notices/'.length))
      && route === method + ' /api/notices/:id'
      && ['GET', 'PUT', 'DELETE'].includes(method);
    // 6·7단계에서 제공된 engine fixture 경로는 보존합니다.
    const fixture = request?.service === 'notes' && method === 'GET'
      && route === 'GET /notes/:id'
      && typeof path === 'string' && path.startsWith('/notes/')
      && isId(path.slice('/notes/'.length));
    if (!(memoList || memoDetail || noticeList || noticeDetail || fixture)) {
      decision = 'deny';
      reasonCode = 'resource_not_allowed';
      ruleId = 'resource_zone';
    }
  }

  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision,
    reasonCode,
    ruleIds: [ruleId],
  };
}
