# 다음 근무 — 교대 근무 인수인계

React + Vite 화면과 Node.js + Express API, SQLite 저장소로 구성한 초기 버전입니다.

## 기능

- 근무일·근무조(SOD/DOD/EOD)별 기록 등록
- 작성자, 제목, 업무 내용, 특이사항, 중요도 관리
- 날짜·근무조·확인 상태 필터와 텍스트 검색
- 댓글로 처리 과정 기록 (로그인 작성자·작성 시각 자동 저장)
- 종료 처리 및 별도 종료 이력 탭 (종료자·종료 시각 기록, 종료 후 읽기 전용)
- 진행 중, 기간 내 고정, 긴급 처리 현황
- 회원가입·로그인·로그아웃 (아이디, 비밀번호, 이름)
- 로그인 계정으로 작성자·댓글 작성자·종료자 자동 기록
- 해시태그 등록, 검색 및 태그 선택 필터
- 기간을 지정한 고정 인수인계

## 실행

Node.js 24 이상이 필요합니다.

```sh
npm install
npm run dev
```

개발 화면: http://localhost:5173 / API: http://127.0.0.1:3001

```sh
npm test
npm run build
npm start
```

빌드 후에는 http://127.0.0.1:3001 에서 화면과 API를 함께 제공합니다.
기록은 `data/handover.db`에 저장됩니다. 샘플 기록은 자동 생성하지 않습니다.

Node.js를 시스템에 설치하지 않고 `.tools/node-v24.21.0-win-x64`를 사용하는 경우 PowerShell에서 먼저 실행합니다.

```powershell
$env:Path = "$PWD\.tools\node-v24.21.0-win-x64;$env:Path"
npm.cmd install
npm.cmd run dev
```

## 구성

- `src/`: React 화면
- `server/app.js`: API, 입력 검증, SQLite 저장소
- `server/index.js`: 서버 실행
- `server/app.test.js`: API 통합 테스트

| API | 설명 |
| --- | --- |
| `POST /api/auth/register` | `{ "username": "worker", "password": "8자 이상 비밀번호", "name": "이름" }` 회원가입 |
| `POST /api/auth/login` | 아이디·비밀번호 로그인 |
| `POST /api/auth/logout` | 세션 폐기 |
| `GET /api/auth/me` | 로그인 사용자 |
| `GET /api/handovers` | 진행 중 목록 (기본), `?status=closed` 종료 이력, `?status=all` 전체, `tag` 필터 병용 가능 |
| `GET /api/handovers/:id` | 상세 내용과 댓글 이력 |
| `POST /api/handovers` | 기록 등록 |
| `POST /api/handovers/:id/comments` | `{ "content": "처리 내용" }` 댓글 등록 (최대 5,000자) |
| `POST /api/handovers/:id/close` | `{}`로 종료 처리 |

기본 바인딩 주소는 `127.0.0.1`입니다. `HOST`, `PORT`, `DATABASE_PATH` 환경 변수로 변경할 수 있습니다.
첫 접속 시 회원가입으로 계정을 만드세요. 가입한 모든 사용자는 공동 인수인계를 조회·작성·댓글 등록·종료할 수 있습니다. 관리자 승인, 역할별 권한, 비밀번호 재설정은 아직 포함하지 않습니다.
비밀번호는 임의 salt와 scrypt 해시로 저장합니다. 로그인은 SQLite에 저장한 12시간 세션과 HttpOnly·SameSite=Strict 쿠키를 사용합니다. HTTPS 배포에서는 `COOKIE_SECURE=true`로 설정하세요.
모든 POST 요청은 `Content-Type: application/json`, `X-Handover-Request: 1` 헤더가 필요합니다. 인증 시도는 IP당 15분에 20회로 제한됩니다.
기록 등록 시 `tags: ["장비점검", "야간"]`을 전달할 수 있습니다. 태그는 최대 10개, 각 30자이며 영문은 소문자로 통일하고 중복은 제거합니다. 화면에서는 공백·쉼표·#으로 구분합니다.
기존 기록은 자동 마이그레이션으로 유지하며 기존 작성자 이름과 확인 이력을 보존합니다. 기존 확인 완료는 업무 종료로 자동 변환하지 않습니다. 새 기록·댓글·종료에는 사용자 ID를 함께 저장합니다.
고정 등록은 `kind: "고정"`, `pinStart: "2026-09-22"`, `pinEnd: "2026-09-30"`을 전달합니다. 일반 기록의 `kind`는 `"일반"`입니다.
기존 근무조는 주간→SOD, 오후→DOD, 야간→EOD로 자동 변환하며 작업·예외요청 유형은 고정으로 통합합니다. 고정 기간과 댓글·종료 이력은 유지합니다.
고정 기간은 한국 시간 기준으로 시작일과 종료일을 포함합니다. 기간 내 진행 중 목록 상단에 표시되고, 미래 기간은 고정 예정으로 표시합니다. 기간 만료 시 상단 고정만 해제되며 직접 종료하기 전까지 진행 중에 남습니다. 열린 화면은 30초마다 고정 기간을 재평가합니다.
종료된 기록은 진행 중 목록에서 제외하고 종료 이력에 보관합니다. 댓글 추가와 중복 종료는 거부합니다. 기존 확인 API는 종료 API로 대체되었습니다.
데이터 백업은 서버를 정상 종료한 다음 `data` 폴더 전체를 복사하세요.

인증 구현 참고: [Node.js crypto](https://nodejs.org/api/crypto.html), [Express 보안 가이드](https://expressjs.com/en/advanced/best-practice-security.html).
