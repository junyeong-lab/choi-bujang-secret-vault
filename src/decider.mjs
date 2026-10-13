// ALEPH SDP 엔진이 검증한 요청 계약만 읽습니다.
// 임의의 클라이언트 헤더나 브라우저 위치정보는 판정 근거로 사용하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required']);

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

  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision,
    reasonCode,
    ruleIds: [ruleId],
  };
}
