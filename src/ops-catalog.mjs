// Stage 12 student-authored verification plan, not the unpublished official
// 41-attack judge catalogue. Only the explicitly allowlisted read probes run.
const C=[
[1,'공개 정적 메모 차단','금지','GET','/data.json',404,'public'],
[2,'비로그인 메모 목록 차단','금지','GET','/api/memos',401,'public'],
[3,'비로그인 메모 상세 차단','금지','GET','/api/memos/00000000-0000-4000-8000-000000000000',401,'public'],
[4,'비로그인 공지 목록 차단','금지','GET','/api/notices',401,'public'],
[5,'비로그인 기기 상태 차단','금지','GET','/api/device',401,'public'],
[6,'승인된 기기 메모 목록','정상','GET','/api/memos',200,'approved'],
[7,'승인된 기기 상태 확인','정상','GET','/api/device',200,'approved'],
[8,'승인된 사용자 공지 목록','정상','GET','/api/notices',200,'approved'],
[9,'PWA 설치 정보 공개','정상','GET','/manifest.webmanifest',200,'public'],
[10,'배포 식별정보 공개','정상','GET','/aleph.json',200,'public'],
[11,'위조 서명 토큰 거부','금지'],[12,'원본 자료 직접 익명 조회 차단','금지'],
[13,'타인 메모 읽기 차단','금지'],[14,'타인 메모 수정 차단','금지'],
[15,'본인 메모 추가','정상'],[16,'본인 메모 변경','정상'],[17,'본인 메모 삭제','정상'],
[18,'강사 공지 무권한 수정 차단','금지'],[19,'미등록 기기 접근 차단','금지'],
[20,'기기 승인 대기 중 자료 차단','금지'],[21,'기기 승인 회수 후 차단','금지'],
[22,'기기 승인 만료 후 차단','금지'],[23,'설치 배지로 승인 위조 차단','금지'],
[24,'오프라인 보호 자료 정리','금지'],[25,'서명 후 요청 경로 변조 차단','금지'],
[26,'이상 접속 추가 인증 요청','금지'],[27,'재인증 후 정상 요청','정상'],
[28,'120회 정상 읽기 탐지 관찰','정상'],[29,'121회 폭주 탐지 회수 제안','금지'],
[30,'타인 자료 구역 접근 차단','금지'],[31,'공지 자료 구역 권한 차단','금지'],
[32,'정책 사본 임의 수정 탐지','금지'],[33,'백업 내용 위조 탐지','금지'],
[34,'복구 사본 검증','정상'],[35,'본인 메모 단건 복원','정상'],
[36,'타인 메모 복원 차단','금지'],[37,'복구 해시 불일치 차단','금지'],
[38,'복구 감사 기록 보존','정상'],[39,'복구 이후 재시험 수행','정상'],
[40,'앱 서명 없는 보호 요청 차단','금지'],[41,'서명 후 수정 본문 변조 차단','금지']
];
export const OPS_CHECKS=Object.freeze(C.map(([n,label,kind,method=null,path=null,expectedHttp=null,scope=null])=>Object.freeze({
  attackId:'stage12_check_'+String(n).padStart(2,'0'),
  label,kind,method,path,expectedHttp,scope,
  expected:expectedHttp===null
    ? '실제 심판 계약 또는 별도 격리 시험 필요'
    : 'HTTP '+expectedHttp,
  official:false
})));
export const RUNNABLE=Object.freeze(OPS_CHECKS.filter(item=>
  item.method==='GET' && ['public','approved'].includes(item.scope) &&
  Number.isInteger(item.expectedHttp)));
