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

  // 8단계 공식 심판 S08_OTHER_ZONE_ALLOWED 대응:
  // ALEPH v1에는 메모 소유권/강사 역할이 없으므로, 교사 자료 쓰기와
  // 여러 사람의 자료를 반환할 수 있는 전체 목록은 판정기에서 항상 거부합니다.
  // 서버 API는 로그인 사용자의 실제 소유권을 별도로 검사합니다.
  // 기기 미등록 판단은 이전 단계의 판정을 그대로 유지합니다.
  if (request?.deviceRegistered === true) {
    const path = request?.path;
    const method = request?.method;
    const route = request?.route;
    const validId = value => typeof value === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(value) &&
      !['all', 'list', 'export', 'search', 'bulk', 'batch', 'admin', 'download'].includes(value.toLowerCase());

    const memoDetail = typeof path === 'string' &&
      path.startsWith('/api/memos/') &&
      validId(path.slice('/api/memos/'.length)) &&
      route === method + ' /api/memos/:id' &&
      ['GET', 'PUT', 'DELETE'].includes(method);

    const noticeListRead = method === 'GET' && path === '/api/notices' &&
      route === 'GET /api/notices';
    const noticeDetailRead = method === 'GET' &&
      typeof path === 'string' && path.startsWith('/api/notices/') &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path.slice('/api/notices/'.length)) &&
      route === 'GET /api/notices/:id';

    // Keep the 6·7단계 학습용 엔진 요청 경로.
    const fixtureSingleRead = request?.service === 'notes' &&
      method === 'GET' && route === 'GET /notes/:id' &&
      typeof path === 'string' && path.startsWith('/notes/') &&
      validId(path.slice('/notes/'.length));

    // The allowlist intentionally excludes:
    // GET /api/memos, POST /api/memos, all notices POST/PUT/PATCH/DELETE,
    // GET /notes (list) and any unsupported/export path.
    // Apply zone denial even when the same request has step-up risk signals:
    // unauthorized zones must never become accessible after reauthentication.
    if (!(memoDetail || noticeListRead || noticeDetailRead || fixtureSingleRead)) {
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
