// Do not return tokens, private keys, or note bodies.
export async function runAttackChecks(config) {
  if (config.step !== 1 && config.step !== 2) {
    throw new Error('이 단계의 공격 점검을 구현해 주세요.');
  }

  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('실제 배포 주소를 확인해 주세요.');
  }

  if (
    app.protocol !== 'https:' ||
    app.username ||
    app.password ||
    app.search ||
    app.hash ||
    app.pathname !== '/' ||
    app.hostname.endsWith('.example')
  ) {
    throw new Error('실제 HTTPS 배포 주소가 필요합니다.');
  }

  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) {
    throw new Error('가상 메모 확인 표시가 필요합니다.');
  }

  const request = async (path) => fetch(new URL(path, app), {
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });

  const staticResponse = await request('/data.json');
  let visible = false;

  if (staticResponse.ok) {
    try {
      const data = await staticResponse.json();
      visible = data?.sampleMarker === config.sampleMarker
        && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is not evidence of exposed notes.
    }
  }

  const staticCheck = {
    attackId: 'anonymous_note_read',
    expected: config.step === 1
      ? '로그인 없이 공개 정적 파일의 가상 메모 조회 가능'
      : '공개 정적 파일에서 가상 메모 조회 불가',
    observed: visible
      ? '공개 정적 파일에서 가상 메모 확인'
      : `공개 정적 파일에서 가상 메모 미확인 (HTTP ${staticResponse.status})`,
  };

  if (config.step === 1) {
    return [staticCheck];
  }

  const apiResponse = await request('/api/memos');

  if (!apiResponse.ok) {
    throw new Error(`서버 API 점검 실패: HTTP ${apiResponse.status}`);
  }

  const apiData = await apiResponse.json();
  const count = Array.isArray(apiData.notes) ? apiData.notes.length : 0;

  if (visible || count !== 4) {
    throw new Error('2단계 공개 파일 및 서버 API 점검 결과를 확인해 주세요.');
  }

  return [
    staticCheck,
    {
      attackId: 'anonymous_api_read',
      expected: '인증 없이 서버 API의 가상 메모 4건 조회 가능',
      observed: `인증 없는 API 요청에서 가상 메모 ${count}건 확인 (HTTP ${apiResponse.status})`,
    },
  ];
}