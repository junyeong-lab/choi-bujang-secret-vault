# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.



## 2단계 — 자료를 코드 밖으로 옮깁니다

가상 메모 네 건은 공개 정적 파일(`data.json`)이 아니라 Supabase `public.vault\_memos`에 저장합니다. 브라우저는 `GET /api/memos`만 요청합니다. Vercel 서버 함수는 `SUPABASE\_URL`, `SUPABASE\_SECRET\_KEY`를 서버 환경변수에서 읽습니다. 서버 비밀키는 브라우저 번들, 공개 저장소, API 응답, 로그에 넣지 않습니다. `public/data.json`을 생성하거나 공개하지 않습니다.

**현재 남은 약점:** 2단계의 `/api/memos`는 공개 API입니다. 주소를 아는 누구나 호출해 가상 메모 네 건을 읽을 수 있습니다. 이는 사용자별 접근 통제가 아니며 3단계에서 인증과 권한 검사를 추가해야 합니다. 실제 개인정보나 비밀 메모를 저장하지 않습니다.

검증: (1) 배포된 화면에 카드 4개 표시 (2) `/data.json`에 가상 메모 문장이 없어야 함 (3) `/api/memos`에는 키가 없어야 함 (4) `/aleph.json` 유지 (5) 빌드 결과에 `public/data.json` 미생성 (6) GitHub 최신 파일과 과거 커밋/배포 기록을 구분해서 검사.

### 공개 메모 노출 점검 및 기록 (2단계)

아래 점검은 **새로 빌드·배포한 현재 상태**와 **GitHub 기본 브랜치의 최신 커밋**을 대상으로 합니다. 정확한 메모 본문 4개를 검사 대상으로 사용합니다. 문장 검색은 제목만 검색하는 것으로 대체하지 않습니다. 사용자 PC 또는 CI에서 검증하고 결과만 기록하세요.

1. 로컬 원본 `data.json`에서 메모의 `content` 네 값을 확인합니다. 이 원본은 별도 보관하고 공개 배포와 커밋에 포함하지 않습니다. API 저장 데이터가 일치하는지 별도로 점검합니다.
2. 새 빌드 산출물(`dist/`, `build/` 또는 실제 배포 출력 폴더)에서 네 문장을 **문자열 그대로** 검색합니다. 정적 HTML·JS·JSON을 모두 포함하고, 매치가 있다면 파일과 위치를 기록합니다. 어떤 폴더가 실제 배포되는지 빌드 설정을 먼저 확인합니다. `/aleph.json` 생성 여부도 확인합니다.
3. 배포 주소의 `/data.json`을 직접 열어 HTTP 상태와 응답 본문을 확인합니다. `404`이거나, `200`이면 메모 4문장과 가상 메모 목록이 없어야 합니다. 메인 화면에서는 카드 4개가 보이는지, `/api/memos`는 응답하는지 따로 확인합니다. `/api/memos`가 메모를 반환하는 것은 **이번 단계에서 의도된 공개 상태**이며 보호되었다는 뜻이 아닙니다.
4. GitHub 저장소의 **기본 브랜치 최신 커밋 SHA**를 기록하고, 그 커밋의 소스·`public/`·추적되는 빌드 파일에서 동일한 네 문장을 검색합니다. 로컬 `git grep -n -F -f <검사용\_문장목록\_파일> <최신커밋\_SHA> -- .` 명령으로 검사할 수 있습니다. 테스트용 SQL 원본/개인용 검사용 문장목록 파일은 공개 저장소에 올리지 않습니다. README에 쓴 검색 명령이나 안내 문장을 오탐으로 집계하지 않도록 실제 메모 본문을 기준으로 확인합니다.
5. 배포에서 비밀키 노출 여부는 브라우저 개발자도구 Network 응답과 JS 번들, 공개 저장소를 검사합니다. **환경변수의 비밀키 실제 값을 화면·README·로그·검사용 결과물에 붙여넣지 않습니다.** 공개 API 호출에서 결과 데이터만 반환되는지 확인합니다.
6. 과거 공개 커밋과 과거 Vercel 배포는 최신 버전의 메모 제거만으로 사라지지 않습니다. 이전 SHA·배포 URL의 접근 가능 여부를 별도로 확인하고, 남아 있거나 확인되지 않았다면 **과거 노출이 해소되었다고 주장하지 않습니다.**

#### 확인 기록

|검사 대상|대상/버전|검색 결과 또는 상태|판정|
|-|-|-|-|
|로컬 최신 정적 빌드|빌드 폴더 / 시각: 미기록|미실행|미검증|
|배포 `/data.json`|배포 URL / 시각: 미기록|미실행|미검증|
|배포 화면 카드 수|배포 URL / 시각: 미기록|미실행|미검증|
|GitHub 최신 파일|기본 브랜치 / SHA: 미기록|미실행|미검증|
|배포 `/aleph.json`|배포 URL / 시각: 미기록|미실행|미검증|
|서버 API 공개 접근|`/api/memos`|인증 없이 읽기 가능한 설계(실동작 미검증)|**남은 약점: 인증·인가 없음**|
|브라우저/응답/로그 비밀키 노출|검사 전|미실행|미검증|
|과거 공개 커밋·배포 접근|과거 버전: 미기록|접근성 미확인; 노출 해소 단정 불가|별도 확인 필요|

**완료 판정 원칙:** 새로운 정적 산출물·GitHub 최신 파일에서 메모 4문장이 검색되지 않고, 배포 `/data.json`에도 존재하지 않으며, UI에서 4개 카드가 표시되고 공개 API의 위험이 위 표에 기록되어야 합니다. 최신 상태 검증에 합격하더라도 과거 공개 커밋·과거 배포의 노출 해소 여부는 별개의 문제입니다.



## 3단계 — 진짜 로그인과 가상 메모 CRUD



Supabase Auth 이메일·비밀번호 로그인과 로그아웃을 구현했습니다. 브라우저는 공식 Supabase SDK로 받은 로그인 세션의 토큰을 자료 API에 전달합니다. 서버는 `src/verify-login.mjs`를 사용해 요청 토큰을 검증하며, 검증에 실패하거나 토큰이 없으면 자료를 반환하지 않고 HTTP 401 JSON 오류를 반환합니다. 브라우저가 보낸 userId와 role을 신뢰하지 않습니다.



로그인 사용자는 `GET /api/memos`, `POST /api/memos`, `GET /api/memos/:id`, `PUT /api/memos/:id`, `DELETE /api/memos/:id`를 통해 가상 메모를 조회·추가·수정·삭제할 수 있습니다. POST는 `{id,title,body}`를 받고, id를 생략하면 서버가 UUID를 생성해 `{id}`를 반환합니다. 새 메모의 `owner\\\_id`는 검증된 사용자 ID로 저장합니다. 존재하지 않는 메모의 단건 GET은 404를 반환합니다.



\*\*남은 약점:\*\* 이번 단계는 인증만 구현했습니다. 메모 소유자 검사는 아직 적용하지 않았으므로 로그인한 다른 사용자가 타인의 메모에 접근하거나 수정할 수 있습니다. 사용자별 소유권 인가는 4단계에서 구현합니다. 실제 개인정보는 저장하지 않습니다.



\### 3단계 실행 및 확인



\- 로컬 빌드: `npm run build -- --local`

\- Vercel 배포: GitHub `main` 브랜치의 최신 커밋을 배포하고 Deployments에서 Ready 상태를 확인합니다.

\- 배포 주소: https://choi-bujang-secret-vault-pi.vercel.app/

\- 시크릿 창에서 로그인 없이 메모 목록이 표시되지 않는지 확인합니다.

\- 비로그인 `GET /api/memos`는 HTTP 401 및 `{"error":"unauthorized"}` JSON을 반환하는지 확인합니다.

\- A 테스트 계정으로 로그인해 가상 메모 추가·수정·삭제를 확인합니다.

\- 인증된 요청으로 존재하지 않는 메모 ID 조회 시 HTTP 404를 확인합니다. 삭제한 특정 메모 ID의 재조회는 별도 미검증입니다.

\- `/aleph.json` 응답 및 첫 화면의 `X-Content-Type-Options: nosniff` 헤더를 확인합니다.

\- 서버 전용 키는 Vercel 환경변수에만 두고 브라우저와 제출 묶음에 포함하지 않습니다. 브라우저 HTML에서 서버 키 패턴이 검색되지 않음을 확인했지만 공개 리소스 전체의 전수 검사는 미실행입니다.



\### 3단계 실제 확인 기록 (2026-10-11)



\- 배포 커밋: `cbea47c` (3단계 CRUD UUID 생성 오류 수정)

\- A 계정 로그인·로그아웃: 성공

\- 가상 메모 추가·수정·삭제: 성공, 기존 가상 메모 4건 유지

\- 비로그인 목록 조회: HTTP 401 JSON 오류 확인

\- 비로그인 개별 조회: HTTP 401 JSON 오류 확인

\- 인증된 존재하지 않는 메모 조회: HTTP 404 확인

\- 배포 `/aleph.json`: step 3, 커밋 `cbea47c` 확인

\- 첫 화면 보안 헤더: `X-Content-Type-Options: nosniff` 확인

\- 타인 메모 소유권 검사 및 심판 공식 판정: 미실행

## 4단계 — 사용자별 메모 소유권 검증과 접근통제

### 구현 내용

3단계의 로그인 인증 기능을 유지하면서, 로그인한 사용자가 본인 소유 메모에만 접근하도록 서버 API에 소유권 검증을 추가했습니다.

- `api/memos.mjs`: 메모 목록 조회 시 검증된 사용자 ID와 `owner_id`가 일치하는 메모만 반환합니다.
- `api/memos/[id].mjs`: 개별 메모 조회(GET)·수정(PUT)·삭제(DELETE) 시 메모 ID와 소유자 ID를 함께 확인합니다.
- 메모 생성(POST): 클라이언트가 전달한 소유자 정보가 아닌 검증된 로그인 사용자 ID를 `owner_id`로 저장합니다.
- 다른 사용자 소유의 메모는 조회·수정·삭제 대상에서 제외하며, 개별 요청에는 HTTP 404를 반환합니다.
- 비로그인 API 요청은 기존처럼 HTTP 401로 거부합니다.

### Supabase GRANT 및 RLS

`public.vault_memos` 테이블의 RLS가 활성화된 것을 확인했습니다.

`authenticated` 역할에 SELECT·INSERT·UPDATE·DELETE 권한을 부여하고, 각 작업에 대해 `owner_id = auth.uid()` 조건을 적용했습니다.

- SELECT: 본인 메모만 조회
- INSERT: 본인 UUID를 소유자로 하는 메모만 생성
- UPDATE: 수정 전후 모두 본인 소유 조건 확인
- DELETE: 본인 메모만 삭제
- `anon`: 테이블 권한 없음 확인

서버 API는 서버 전용 키로 Data API에 접근하므로 RLS만 신뢰하지 않고 서버에서도 소유권 조건을 적용합니다.

### 실행 및 재현 방법

1. 로컬에서 `npm run build -- --local`을 실행합니다.
2. GitHub `main` 브랜치를 Vercel에 배포하고 Production 상태가 Ready인지 확인합니다.
3. 배포 주소 `https://choi-bujang-secret-vault-pi.vercel.app/`에 A 계정으로 로그인해 기존 가상 메모 4건을 확인합니다.
4. B 계정으로 로그인해 A의 메모가 목록에 나타나지 않는지 확인합니다.
5. B의 인증된 요청으로 A의 메모 ID에 GET·PUT·DELETE를 각각 실행하고 HTTP 404인지 확인합니다.
6. A 계정으로 다시 로그인해 기존 메모가 변경되거나 삭제되지 않았는지 확인합니다.
7. `src/attack-check.mjs`의 자동 점검으로 공개 정적 파일, 비로그인 서버 API, 비로그인 직접 Data API 접근 결과를 확인합니다.

테스트에는 가상 메모만 사용하며 비밀번호, JWT, 서버 비밀키와 실제 개인정보를 기록하지 않습니다.

### 4단계 실제 확인 기록 (2026-10-11)

- 서버 API 소유권 필터 배포 커밋: `c225a61`
- Vercel Production 배포: Ready 확인
- A 계정 기존 가상 메모 4건 조회: 성공
- B 계정에서 A의 메모 목록 조회: 노출되지 않음
- B 계정에서 A의 메모 직접 조회(GET): HTTP 404
- B 계정에서 A의 메모 수정(PUT): HTTP 404
- B 계정에서 A의 메모 삭제(DELETE): HTTP 404
- A 계정 재로그인 후 기존 메모 4건 보존: 확인
- Supabase RLS: SELECT·INSERT·UPDATE·DELETE 정책

### 4단계 최종 검증 및 저장점 기록 (2026-10-11)

**최종 배포 커밋:** `97f2b41` — 4단계 메모 소유자 변경 차단

**A/B 계정 접근통제**
- A 계정: 본인 메모 4건 조회 및 가상 메모 추가·수정·삭제 성공
- B 계정: 본인 메모 1건 조회 및 가상 메모 추가·수정·삭제 성공
- A 계정에서 B 소유 메모 직접 조회: HTTP 404
- B 계정에서 A 소유 메모 조회·수정·삭제: HTTP 404
- PUT 요청에서 `owner_id` 변경 시도: HTTP 403
- 테스트 메모 정리 후 A의 4건과 B의 1건 보존 확인

**Supabase 최소 권한 및 RLS**
- `public.vault_memos`에 대해 기존 권한 REVOKE ALL 후 필요한 CRUD 권한만 GRANT
- `anon`: SELECT·INSERT·UPDATE·DELETE 및 기타 테이블 권한 없음
- `authenticated`: SELECT·INSERT·UPDATE·DELETE만 허용
- `information_schema.role_table_grants`와 `has_table_privilege` 적용 전후 비교 완료
- RLS 정책 4개 확인: SELECT·DELETE는 USING, INSERT는 WITH CHECK, UPDATE는 USING과 WITH CHECK에 `auth.uid() = owner_id` 적용
- 서버 API에서도 검증된 사용자 ID로 소유권 확인

**100점 추가 조건 자체 점검**
- 비로그인 `GET /api/memos`: HTTP 401 및 JSON `{"error":"unauthorized"}`
- 배포 `/aleph.json`: 정상 접근, step 4 및 커밋 `97f2b41` 확인
- 첫 화면 보안 헤더: `X-Content-Type-Options: nosniff` 확인

**다시 실행 및 검증하는 방법**
1. `npm run build -- --local`로 로컬 빌드를 실행합니다.
2. GitHub `main` 브랜치를 Vercel에 배포하고 Production Ready 상태를 확인합니다.
3. 배포 주소 `https://choi-bujang-secret-vault-pi.vercel.app/`에서 A와 B로 각각 로그인해 본인 메모만 조회되는지 확인합니다.
4. 시험 메모를 추가·수정·삭제하고 상대방 메모 ID로 요청할 때 접근이 거부되는지 확인합니다.
5. `npm run bundle`을 실행해 제출 JSON과 실제 자동 공격 점검 결과를 확인합니다.

**판정 범위:** 위 결과는 직접 수행한 학습용 테스트 및 자체 점검 기록입니다. 공식 심판의 채점 결과는 아닙니다.

## 5단계 — 자료 요청을 서버 한곳으로 모읍니다

### 구현 내용

- 브라우저의 메모 조회·추가·수정·삭제 요청은 Vercel 서버 함수 `/api/memos` 및 `/api/memos/:id`를 통해 처리합니다.
- Supabase `public.vault_memos` 테이블의 `PUBLIC`, `anon`, `authenticated` 직접 권한을 철회했습니다.
- 서버 함수의 로그인 검증, `owner_id` 기반 소유권 검사, 서버 전용 DB 접근 설정을 유지했습니다.
- `aleph.config.json`의 `originalApiUrl`에 쿼리 없는 원본 Data API HTTPS 경로를 등록하고 `step`을 5로 변경했습니다.
- 추가 가점 대응을 위해 브라우저의 Supabase 공개 키를 제거하고 서버 로그인·로그아웃·세션 확인 함수를 구현했습니다. 기존 Bearer 인증 경로도 보존했습니다.

### 실제 검증 기록 (2026-10-11)

**기존 Production 환경**
- A 계정 메모 조회·추가·수정·삭제 성공
- 테스트 메모 삭제 후 기존 A 메모 4건 보존
- 권한 철회 후 `anon` 및 `authenticated`의 테이블 직접 CRUD 권한 제거 확인
- 공개 키로 원본 Data API 직접 요청: HTTP 401
- 비로그인 서버 메모 API 요청: HTTP 401

**Preview 환경 — `test-stage5-auth`, 커밋 `e50d59f`**
- 서버 로그인 및 새로고침 후 세션 유지 성공
- A 계정 메모 조회·추가·수정·삭제 성공
- 테스트 메모 삭제 후 기존 A 메모 4건 보존
- 로그아웃 후 비로그인 메모 조회: HTTP 401
- B 계정 본인 메모 1건만 조회, A 소유 메모 직접 조회: HTTP 404
- 배포 HTML에서 Supabase 공개 키 및 브라우저 SDK 흔적 미확인
- 첫 화면 응답: HTTP 200, `X-Content-Type-Options: nosniff` 확인

**자동 자체 점검**
- 공개 정적 메모 파일: HTTP 404
- 비로그인 메모 목록 및 단건 조회: HTTP 401
- Supabase 원본 Data API 직접 조회: HTTP 401
- `npm run test:r5`: 2개 통과, 실패 0개
- 로컬 빌드 및 변경된 JavaScript 문법 검사 통과

### 다시 실행 및 확인하는 방법

1. `npm run build -- --local`로 로컬 빌드를 실행합니다.
2. Vercel Preview에서 A/B 계정의 로그인, 새로고침, 메모 CRUD 및 로그아웃을 확인합니다.
3. 비로그인 메모 요청과 타인 소유 메모 요청이 각각 HTTP 401, 404로 차단되는지 확인합니다.
4. Supabase SQL Editor에서 `public.vault_memos`의 직접 권한이 철회되어 있는지 확인합니다.
5. `npm run bundle`로 제출 JSON과 자동 점검 결과를 확인합니다.

**판정 범위:** 위 내용은 직접 수행한 자체 점검 기록입니다. 새로운 서버 인증 방식의 Production 배포 및 5단계 공식 심판 채점은 아직 진행하지 않았습니다. 기존 심판용 Bearer 인증의 실제 회귀 시험도 별도로 필요합니다.


## XDR-01 보너스 — 무차별 로그인 공격 탐지

### 구현 내용

Wazuh 형식의 학습용 경보를 분석하여 무차별 로그인 공격을 탐지하고 대응하도록 구현했습니다.

- `read-alerts.mjs`: 경보에서 필요한 정보 추출
- `patterns.json`: MITRE ATT&CK T1110.001 및 T1110.003 기반 탐지 패턴 2개
- `decide.mjs`: 경보를 block, alert, record로 분류
- `respond.mjs`: 공격 IP의 15분 임시 차단 규칙 및 알림 로그 관리
- `ztna-bridge.mjs`: XDR 차단 규칙과 기존 ZTNA 판정기를 연결하는 학습용 모듈

### 검증 결과

Wazuh 학습용 경보 28건을 대상으로 다음 결과를 확인했습니다.

| 구분 | 결과 |
|---|---|
| 명확한 공격 | block 10건 |
| 의심 이벤트 | alert 9건 |
| 정상 이벤트 | record 9건 |
| 정상 이벤트 오차단 | 0건 |

학습용 ZTNA 연결 테스트에서도 공격 탐지, 임시 차단, 15분 후 기존 정책 전달을 확인했습니다. 3개 테스트 모두 PASS입니다.

### 다시 실행하는 방법

저장소 루트에서 실행합니다.

```powershell
npm run xdr:run -- brute-force
```

결과는 `xdr/brute-force/result.json`에 저장됩니다.

### 구현 범위 및 한계

- 기존 `src/decider.mjs`의 ZTNA 판정 규칙은 수정하지 않았습니다.
- 임시 차단 규칙은 실행 중인 프로세스의 메모리에 저장되므로 재시작하면 유지되지 않습니다.
- `ztna-bridge.mjs`는 학습용 연결 모듈이며 실제 ALEPH 운영 ZTNA 엔진에는 연결되지 않았습니다.
- 위 검증 결과는 로컬 실습 결과이며 공식 심판의 채점 결과가 아닙니다.


## XDR-02 보너스 — 웹 주입 공격 탐지

### 구현 내용

Wazuh 형식의 학습용 웹 접근 경보를 분석하여 SQL 주입, 스크립트 삽입, 경로 탐색, 명령 구분자 반복 시도를 탐지하는 모듈을 구현했습니다.

- `xdr/web-injection/read-alerts.mjs`: 경보에서 시각·출발 주소·계정·규칙 수준·설명 추출
- `xdr/web-injection/patterns.json`: MITRE ATT&CK T1190 기반 탐지 패턴 4개
- `xdr/web-injection/decide.mjs`: 경보를 block·alert·record로 분류하는 독립형 판정기
- `xdr/web-injection/respond.mjs`: 15분 임시 차단 후보 생성 및 경보 로그 기록
- `xdr/web-injection/result.json`: 경보별 판정 결과 저장
- `xdr/web-injection/ztna-bridge.mjs`: XDR 임시 차단 규칙을 기존 ZTNA 판정기에 전달하는 학습용 연결 모듈

### 검증 결과

학습용 Wazuh 경보 26건을 대상으로 다음 결과를 확인했습니다.

| 구분 | 결과 |
|---|---|
| 명확한 공격 | block 8건 |
| 의심 이벤트 | alert 9건 |
| 정상 이벤트 | record 9건 |
| 정상 이벤트 오차단 | 0건 |

추가 검증:
- 읽기 모듈에서 원본 경보 26건과 추출된 경보 26건 일치
- 판정기 문법 검사 및 import 문 없음 확인
- 임시 차단 규칙의 근거 경보 ID 기록 확인
- 15분 후 임시 차단 규칙 만료 확인
- 정상·의심 이벤트 추가 차단 0건 확인
- ZTNA 학습용 연동 테스트 3/3 PASS
  - 공격 IP의 임시 차단 확인
  - 정상 IP는 기존 ZTNA 정책으로 전달
  - 15분 만료 후 기존 ZTNA 정책으로 전달

### 다시 실행하는 방법

저장소 루트에서 다음 명령어를 실행합니다.

```powershell
npm run xdr:run -- web-injection
```

결과는 `xdr/web-injection/result.json`에 저장됩니다.

### 구현 범위 및 한계

- 기존 ZTNA 판정기인 `src/decider.mjs`의 규칙은 변경하지 않았습니다.
- 임시 차단 규칙은 실행 중인 프로세스의 메모리에만 저장됩니다.
- `respond.mjs`는 학습용 차단 후보를 생성하며, 실제 ALEPH 운영 ZTNA 엔진과의 자동 연동은 구현하지 않았습니다.
- 검증 결과는 로컬 실습 결과이며 공식 심판의 채점 결과는 아닙니다.

## 6단계 — 등록한 기기만 자료실에 들어옵니다

### 현재 구현

- `src/decider.mjs`는 ALEPH 판정 요청의 `deviceRegistered`가 정확히 `true`일 때에만 `allow`와 `approved`를 반환합니다.
- `false` 또는 누락된 기기 등록 상태는 `deny`와 `device_not_registered`로 거부합니다. 구현된 규칙 ID는 `device_registered`입니다.
- 입력과 응답은 `docs/DECIDER_REQUEST.md` 계약을 따릅니다. 별도 기기 인증서, CA 또는 서명 키를 생성하지 않습니다.
- 이 코드는 ALEPH 학생 판정기용이며 기존 자료실 브라우저 로그인에 기기 등록 기능을 새로 추가한 것은 아닙니다. 실제 엔진은 판정기에 전달하기 전 별도로 기기를 검사합니다.

### 다시 확인하는 방법

저장소 루트에서 다음 명령으로 가상 판정 요청을 확인합니다.

```powershell
npm run decider:test
```

예상 출력: `통과 · 등록 기기의 정상 요청`, `통과 · 미등록 기기의 가상 요청`. 미등록 요청은 반드시 `deny` / `device_not_registered`가 되어야 합니다.

별도 프로그램 설치는 필요하지 않습니다. 가상 요청 테스트 성공은 실제 심판 판정이나 운영 환경 기기 인증을 증명하지 않습니다. 기존 배포 화면의 로그인과 자료 표시 여부는 별도로 확인해야 합니다.

### 저장점 기록

- 6단계 규칙 및 제출 설정 반영. `npm run decider:test`는 GitHub에 반영하기 전 동일 코드와 저장소 테스트 스크립트의 격리 복제본에서 2개 항목 통과를 확인했습니다.
- 6단계 GitHub Actions에서 `npm run decider:test`와 `npm run bundle`이 성공했으며, 사용자가 공식 심판 100점을 확인했습니다. 6단계 최종 검증 커밋: `67fb3c6`.

## 7단계 — 평소와 다른 접속은 다시 확인합니다

### 구현한 정책과 입력 출처

- `src/decider.mjs`: 6단계 `device_registered` 규칙 보존. 미등록 기기는 기존대로 `deny` / `device_not_registered`입니다.
- `signals.source === 'judge_fixture'`인 **심판 가상 사건**에서만 시각·네트워크 조합을 평가합니다. 실제 엔진 요청은 현재 `source: 'none'`, 지역·네트워크는 `unknown`이며, 가상 신호를 실제 위치 증거로 취급하지 않습니다.
- 가상 사건의 이른 시각(0~5시), 평소와 다른 네트워크(`unusual`), 최근 300초 내 10회 이상의 `risk_signal`이 **모두** 있는 경우 `step_up` / `step_up_required`를 반환합니다. 지역 하나만으로 차단하지 않습니다.
- 누락됐거나 출처가 불명확한 신호는 안전한 정상값으로 채우지 않으며, 추측한 정보로 위험 조합을 생성하지 않습니다. 기기 등록 확인은 이와 별도로 유지됩니다. 클라이언트 헤더나 임의의 위치 입력은 정책 신호로 취급하지 않습니다.
- 엔진이 제공한 `stepUp.verified === true`와 `authAgeSeconds` 0~300초인 새 요청에서만 가상 복합 위험을 추가 확인 후 허용합니다. 토큰 원문이나 개인키는 다루지 않습니다.

### 자체 확인

```powershell
npm run decider:test
npm run fixture:7
node --test test/step7.test.mjs
npm run bundle
```

- 정상 등록 기기는 `allow`, 미등록 기기는 `deny` / `device_not_registered`.
- 미확인 복합 이상 가상 요청은 `step_up` / `step_up_required`; 엔진이 검증한 새 로그인 시각이 300초 이내인 다시 들어온 가상 요청은 `allow`.
- 클라이언트 헤더 위조, 불완전한 출처, 지역 단독 접근은 추가 확인 근거로 사용하지 않는지도 시험합니다.
- `npm run bundle`은 GitHub Actions 실행에서 `artifacts/submission.json`을 생성하고 `step7-submission`으로 보관합니다. 비밀값과 실제 메모는 묶음에 넣지 않습니다.

**실제 운영 검증의 한계:** `stepUp` 검증 정보는 계약상 존재하지만, 실제 엔진의 새 로그인 검증 및 자료 차단·재허용 흐름은 학생 가상 테스트만으로 확인할 수 없습니다. 실제 자료 차단 전후 실측은 **미실행**이며 운영 심판이 검사합니다. 기존 브라우저 로그인이나 Supabase 보안을 새 기기·위치 판정 정책으로 대체하지 않습니다.

## 8단계 — 자료마다 갈 수 있는 구역을 나눕니다

- 메모는 `memo:<id>`, 강사 공지는 `notice:<uuid>`로 별도 자원 ID를 반환합니다. 기존 `/api/memos` 경로 및 데이터는 유지합니다.
- 강사 공지는 `/api/notices` 및 `/api/notices/:id`에서 관리하며, 화면 메뉴는 변경하지 않습니다.
- Supabase `instructor_notices`와 `instructor_grants`는 별도 테이블로 추가했습니다. 기존 메모 5건을 변경하지 않았으며, 최초 강사 권한은 0명입니다. RLS는 활성화됐고 익명 및 일반 로그인 DB 역할의 직접 접근 권한은 주지 않았습니다.
- 서버 API는 로그인 검증 후 강사 수정·생성·삭제 요청마다 `instructor_grants`의 활성 권한을 DB에서 확인합니다. 클라이언트 `role` 값은 이용하지 않습니다. 메모 API는 DB의 `owner_id`와 검증된 사용자 ID를 대조합니다.
- ALEPH 판정기에서는 `method`, `path`, `route`, `deviceRegistered`와 기존 이상행동 신호를 검사합니다. 미등록 기기 거부 및 복합 위험 `step_up` 정책을 유지합니다. 미확인 경로는 거부합니다.
- ALEPH 18필드 판정 계약에는 메모의 저장된 소유자나 강사 권한이 제공되지 않습니다. 판정기에서 임의 역할을 만들지 않으며 실제 사용자별 권한 검사는 자료 API에서 합니다. 공식 심판의 사용자 소유권 경로 테스트는 별도 확인이 필요합니다.

### 확인 명령
```powershell
npm run decider:test
npm run fixture:7
node --test test/step7.test.mjs
npm run bundle
```

- API 보안 직접 검증: 비로그인 `/api/memos`와 `/api/notices`는 거부, 사용자 본인 메모는 허용, 다른 사용자 메모는 거부, 일반 학생의 공지 작성·수정은 `instructor_only`로 거부.
- 신규 강사 공지 쓰기 권한은 임의로 부여하지 않습니다. 최초에는 모든 사용자의 공지 변경이 거부됩니다. 강사 권한 배정은 사용자의 별도 승인과 검증이 필요합니다.

### 8단계 로그인 세션 API 정합성 보완

- 새 공지 API의 `vault_session` 쿠키 해석을 기존 `/api/auth/session`과 일치시켰습니다. 사용자의 토큰은 출력하거나 기록하지 않습니다.
- 브라우저 쿠키가 있으면 이를 사용하며, 쿠키가 없는 심판/외부 요청은 기존 Bearer 검증을 그대로 적용합니다.
- 정상 쿠키, 추가 인증 헤더, Bearer만 있는 요청, 비로그인 요청을 가짜 값으로 시험합니다.
- 실제 로그인된 브라우저에서 `/api/notices`가 HTTP 200과 빈 공지 배열을 반환하는지는 재확인해야 합니다.

### 8단계 공식 심판 피드백 반영 — S08_OTHER_ZONE_ALLOWED

- 최초 제출 커밋 `9684720`: 공식 심판 48/100, 구역 규칙 위반 S08_OTHER_ZONE_ALLOWED.
- 원인: 판정기가 메모 전체 목록과 강사 공지 쓰기를 `allow`로 반환한 과도한 허용.
- 수정: `GET /api/memos`, `POST /api/memos`와 반 공지의 `POST/PUT/PATCH/DELETE`를 판정기에서 `deny / resource_not_allowed`로 처리합니다. export·all 같은 목록/기능형 ID도 판정기에서 거부합니다.
- 정확한 단건 메모 조회·수정은 판정기에서 허용하되, 대상 소유권은 기존 API에서 검증합니다.
- 6단계 기기 등록 및 7단계 복합 이상 접근 `step_up`는 유지하고, 권한 없는 구역은 다시 로그인하더라도 접근을 허용하지 않습니다.
- 이 수정은 ALEPH 판정기 정책만 변경하며, 기존 브라우저의 본인 소유 메모 목록 API나 Supabase 데이터는 그대로 유지합니다.
- `node --test test/step7.test.mjs test/step8.test.mjs`, `npm run decider:test`, `npm run fixture:7`, `npm run bundle`로 검증합니다. 공식 심판 재채점은 별도입니다.

### 8단계 공식 심판 재평가 결과

- S08_OTHER_ZONE_ALLOWED 수정 후 최신 8단계 정책 커밋 `8468ffc`으로 다시 제출하여 **공식 심판 100/100점**을 확인했습니다.
- 메모 목록이나 강사 공지 쓰기를 판정기에서 거부하고, 단건 자료의 소유권은 기존 API에서 검사하는 정책을 보존합니다.

## 9단계 — 도플갱어를 찾고 권한을 거둡니다

### 탐지 범위 및 계약

- `src/detect.mjs`의 `detect(events)`는 9단계 `docs/DETECT_EVENTS.md`에 정의된 로컬 가상 사건을 처리합니다.
- 계약에 정의된 입력은 `{ at, method, identity: { sub } }`뿐입니다. `GET` 조회를 **가명 주체(`identity.sub`)별**로 묶어, 시간순 정렬 후 모든 10분 슬라이딩 구간에서 조회 수를 검사합니다.
- 같은 주체의 10분 구간 조회 수가 **120건을 초과**할 때만 `{ action: 'propose_revocation', reasonCode: 'burst_read', subject: ... }`를 반환합니다.
- 120건 이하, 서로 다른 사용자의 조회, 10분을 초과하여 분산된 조회, GET이 아닌 동작, 유효하지 않은 사건은 `{ action: 'observe' }`로 유지합니다.
- 응답은 탐지기 전용으로, `src/decider.mjs`의 6·7·8단계 판정 정책과 기존 5개 항목의 응답을 변경하지 않습니다.
- 제공된 로컬 탐지 계약에는 기기 ID와 네트워크 정보가 없습니다. 따라서 가상 신호를 추가하거나 임의 기기를 지정하지 않습니다. 실제 운영 엔진에서 검증된 기기 하나만 회수하는지와 회수까지의 시간은 공식 심판에서 확인해야 하며 **학생 측 실측은 미실행**입니다.
- 원본 사건·메모 내용·토큰·실명을 코드, 로그, 결과, 제출 묶음에 저장하지 않습니다. 개인키나 회수 API를 만들지 않았습니다.

### 다시 실행하는 방법

```
npm run detect:test
node --test test/step9.test.mjs
npm run decider:test
npm run fixture:7
node --test test/step7.test.mjs test/step8.test.mjs
npm run bundle
```

이 자체 점검의 성공은 실제 회수나 공식 심판 판정을 뜻하지 않습니다.

### 9단계 공식 심판 결과
- `0a56698` 제출 후 **공식 심판 100/100점**을 사용자로부터 확인했습니다.

## 10단계 — 백업에서 자료실을 되살립니다 (제작 1: 안전 사본 차이 확인)

- `step10-recovery` 작업 브랜치에서 **정책 사본 검증과 읽기 전용 차이 비교**만 구현합니다.
- 안전 사본: `backup/step10/safe-decider.mjs`. 9단계 만점 당시 Git 커밋 `0a56698765f6fb478c99957ef79ab47256c70a65`의 `src/decider.mjs`와 Git blob 지문 `55192826188e2842cf8b025d9a935c278f067909`가 일치해야 비교를 시작합니다.
- 사본이 없거나 변조·원본 검증에 실패하면 작업을 중단합니다. 운영 `src/decider.mjs`, Supabase 자료, 감사 기록은 수정하지 않습니다.
- 현재 정책(`src/decider.mjs`) 또는 별도 시험 파일(`test/fixtures/step10-modified-policy.txt`)과 비교하여 변경 구간·줄 수만 출력합니다. 정책 본문 및 개인정보는 로그에 출력하지 않습니다.
- 이번 단계는 **정책 코드 사본**만 해당됩니다. Supabase 무료 플랜에는 자동 백업이 없으며 검증된 침해 전 비공개 메모 사본은 아직 없습니다. 메모 복원은 미실행입니다.

### 제작 1 직접 확인 명령

```
npm run policy:diff
npm run policy:diff -- --test-policy test/fixtures/step10-modified-policy.txt
node --test test/step10-policy-diff.test.mjs
```

기본 비교는 **0구간**이어야 하며, 시험용 변형 파일 비교는 **1구간** 차이가 표시되어야 합니다. 실제 복원·정책 적용·다른 단계 회귀 검증은 다음 제작 단계에서 진행합니다.
