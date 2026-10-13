// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 반 엔진이 확인한 기기 등록 여부만 사용합니다. 기기 키나 토큰을 취급하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered']);

export async function decide(request) {
  const registered = request.deviceRegistered === true;

  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: registered ? 'allow' : 'deny',
    reasonCode: registered ? 'approved' : 'device_not_registered',
    ruleIds: [RULE_IDS[0]],
  };
}
