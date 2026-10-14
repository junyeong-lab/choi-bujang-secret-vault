// Do not return tokens, private keys, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(config.step)) {
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
    cache: 'no-store',
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

  if (config.step === 1) return [staticCheck];

  const apiResponse = await request('/api/memos');

  if (config.step === 2) {
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

  async function checkDenied(response, target) {
    let validError = false;
    try {
      const data = await response.json();
      validError = data && !Array.isArray(data)
        && typeof data.error === 'string' && data.error.length > 0
        && !('notes' in data) && !('body' in data) && !('content' in data);
    } catch {
      validError = false;
    }
    if (![401, 403].includes(response.status) || !validError) {
      throw new Error(`3단계 비로그인 ${target} 차단 점검 실패: HTTP ${response.status} 또는 JSON 오류 형식을 확인하세요.`);
    }
    return `인증 없는 요청 거부 및 JSON 오류 확인 (HTTP ${response.status})`;
  }

  if (visible) {
    throw new Error('3단계 공개 정적 파일에서 가상 메모가 확인됩니다.');
  }
  const listObserved = await checkDenied(apiResponse, '목록 조회');
  const detailResponse = await request('/api/memos/00000000-0000-4000-8000-000000000000');
  const detailObserved = await checkDenied(detailResponse, '단건 조회');

  if (config.step === 4 || config.step === 5 || config.step === 6 || config.step === 7 || config.step === 8 || config.step === 9 || config.step === 10 || config.step === 11 || config.step === 12) {
const dbUrl = config.step >= 5
  ? new URL(config.originalApiUrl)
  : new URL(
      '/rest/v1/vault_memos?select=id',
      config.identityProvider.issuer
    );

    const publishableKey = 'sb_publishable_iFlkHbEhjHxdGno2O31DEg_STSayiu2';

    const dbResponse = await fetch(dbUrl, {
      headers: { apikey: publishableKey },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (![401, 403].includes(dbResponse.status)) {
      throw new Error(
        `4단계 Data API 익명 접근 점검 실패: HTTP ${dbResponse.status}`
      );
    }

    const results = [
      staticCheck,
      {
        attackId: 'anonymous_api_read',
        expected: '비로그인 메모 목록 조회 거부',
        observed: listObserved,
      },
      {
        attackId: 'anonymous_memo_detail_read',
        expected: '비로그인 메모 단건 조회 거부',
        observed: detailObserved,
      },
      {
        attackId: 'anonymous_direct_data_api',
        expected: 'Publishable key만 사용한 Data API 조회 거부',
        observed: `직접 Data API 요청 거부 (HTTP ${dbResponse.status})`,
      },
    ];
    if(config.step >= 12){
      const ops=await request('/api/ops');
      const result=await checkDenied(ops,'작전실 무단 접근');
      const page=await request('/ops.html');
      results.push({
        attackId:'stage12_ops_anonymous_denied',
        expected:'로그인 없는 작전실 API 접근 거부',
        observed:result
      },{
        attackId:'stage12_room_public_shell',
        expected:'탈환 작전실 공개 껍데기 HTTP 200 (실제 내역은 인증 후 표시)',
        observed:'HTTP '+page.status+' (공개 화면·실제 서버 자료는 분리)'
      });
      await page.body?.cancel();
    }
    return results;
  }

  return [
    staticCheck,
    {
      attackId: 'anonymous_api_read',
      expected: '비로그인 메모 목록 조회 거부(HTTP 401/403, JSON 오류)',
      observed: listObserved,
    },
    {
      attackId: 'anonymous_memo_detail_read',
      expected: '비로그인 메모 단건 조회 거부(HTTP 401/403, JSON 오류)',
      observed: detailObserved,
    },
  ];
}
