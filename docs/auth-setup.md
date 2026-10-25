# 계정·개인 서재·관리자 기능 연결

화면은 GitHub Pages에서 계속 제공합니다. 인증과 개인별 저장 데이터는 Supabase Auth / Postgres가, 관리자 계정 검색과 재설정 메일은 Supabase Edge Function이 처리합니다. 방문자는 로그인하지 않아도 문제를 볼 수 있습니다.

코드와 마이그레이션만으로 실제 계정 서비스가 만들어지지는 않습니다. **본인 소유 Supabase 프로젝트, 이메일 발송 설정, 아래 배포 및 첫 관리자 등록이 필요합니다.** 현재 프로젝트 URL·키가 제공되지 않아 운영 인증, 실제 메일 수신, 기기 간 동기화는 검증되지 않았습니다.

## 1. Supabase 프로젝트와 웹 설정

1. Supabase에서 프로젝트를 생성합니다. 요금제·결제는 소유자가 선택합니다.
2. Authentication에서 Email provider와 이메일 확인을 활성화하고 비밀번호 최소 길이를 10자로 설정합니다. Site URL은 `https://jaeinlee0502.github.io/gyfl/`로 지정합니다.
3. Redirect URLs에 위 URL을 **정확히** 추가합니다. 로컬 검증이 필요하면 사용 중인 Vite 주소의 `/gyfl/` 경로도 별도로 추가합니다. 운영 프로젝트에 광범위한 와일드카드 URL은 추가하지 않습니다.
4. Authentication 이메일 발송에 사용할 SMTP를 설정합니다. 기본 발송기는 수신자·발송량 제한이 있어 일반 선생님들의 회원가입/비밀번호 재설정에 그대로 사용할 수 없는 경우가 있습니다. 이메일 템플릿의 링크는 Supabase의 `{{ .ConfirmationURL }}`을 유지하고 임의로 복사한 토큰이나 비밀번호를 넣지 않습니다.
5. 프로젝트의 URL과 **publishable key**(또는 legacy anon key)를 프론트엔드 배포 설정에 입력합니다. 이 공개키는 브라우저용입니다. `service_role`·secret key·DB 비밀번호는 프론트엔드 변수나 GitHub Pages 산출물에 넣으면 안 됩니다.

프론트엔드가 사용하는 공개 변수 이름은 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`입니다. 프로젝트 URL은 `https://<project-ref>.supabase.co` 형식입니다. 실제 값은 GitHub 저장소의 Actions 변수 등 해당 배포 설정에서 입력하고 소스에 커밋하지 않습니다. 로컬 개발에는 Git에서 무시되는 `.env.local`을 사용합니다.

이 저장소에서는 **Settings → Secrets and variables → Actions → Variables → New repository variable**에서 두 변수를 등록합니다. 이어서 **Actions → Deploy to GitHub Pages → Run workflow**를 실행합니다. 클라우드 개발 환경의 변수와 GitHub Actions 변수는 별도이므로 한쪽에 입력했다고 다른 쪽에 자동 반영되지는 않습니다.

## 2. 데이터베이스 마이그레이션

Supabase CLI로 프로젝트에 연결하고 적용합니다. 로그인·연결 정보는 로컬 CLI의 안전한 인증 흐름에서 입력합니다.

```bash
supabase login
supabase link --project-ref <본인-project-ref>
supabase db push
```

CLI를 사용하지 않는 경우 SQL Editor에서 `supabase/migrations/202610250001_accounts_and_bookmarks.sql` 전체를 한 번 실행합니다. 이 마이그레이션은 기존 운영 테이블과 이름이 충돌하지 않는 새 프로젝트를 기준으로 합니다. 이미 동명의 테이블이 있다면 먼저 스키마를 비교하고, 기존 데이터를 삭제하거나 덮어쓰지 않습니다.

- `profiles`: 사용자 ID, 이메일, 표시 이름. 사용자는 자기 행만 조회하고 표시 이름만 수정할 수 있습니다. 이메일은 Auth의 검증된 계정 변경 경로에서만 동기화됩니다.
- `bookmarks`: `(user_id, question_id)` 복합 키. RLS로 자기 계정의 행만 조회·저장·삭제할 수 있습니다.
- `account_admins`: 신뢰할 수 있는 소유자 SQL 세션에서만 관리자 자격을 부여합니다. 일반 클라이언트는 자기 관리자 등록 여부만 읽습니다.
- `account_admin_audit`: 서버 전용 재설정 요청 기록입니다. 비밀번호·복구 토큰을 기록하지 않습니다.

사용자가 가입 시 보낸 `user_metadata.role`이나 화면의 관리자 표시 여부는 서버 권한으로 사용하지 않습니다. 모든 테이블은 RLS를 활성화하며 비로그인 사용자에게 계정 데이터 접근을 허용하지 않습니다.

## 3. 관리자 Edge Function 배포

```bash
supabase functions deploy account-admin
```

프로젝트의 Edge Function secret 설정에서 필요에 따라 다음 비밀이 아닌 서버 설정을 추가합니다.

```text
APP_SITE_URL=https://jaeinlee0502.github.io/gyfl/
APP_ALLOWED_ORIGINS=https://jaeinlee0502.github.io
```

`APP_ALLOWED_ORIGINS`는 쉼표로 구분한 **정확한 origin**만 받습니다. 경로·와일드카드는 넣지 않습니다. 로컬에서도 함수 호출이 필요하면 사용 중인 `http://localhost:<port>`를 명시적으로 추가합니다. `APP_SITE_URL`은 비밀번호 재설정 메일의 돌아갈 주소이며 브라우저가 보낸 값은 받지 않습니다. 관리자 재설정은 이 서버 주소로 돌아가므로 로컬 개발 중 운영 메일 주소와 혼동하지 않도록 별도 개발 프로젝트를 권장합니다.

`SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 Edge runtime에 제공하는 서버 전용 값입니다. 직접 키를 프론트엔드로 복사하거나 `VITE_` 변수로 만들지 않습니다.

`supabase/config.toml`의 `verify_jwt = false`는 최신 publishable key 호환성을 위한 gateway 설정입니다. 함수는 모든 실제 작업 전에 `auth.getUser(token)`으로 토큰을 검증한 다음 DB의 `account_admins`를 확인합니다. 이 두 검사를 제거하면 안 됩니다. CORS 검사만으로 권한을 판단하지 않습니다.

## 4. 첫 관리자 지정

1. 사이트에서 관리자가 사용할 본인 이메일로 회원가입하고 이메일 확인을 완료합니다.
2. 프로젝트 소유자가 Supabase SQL Editor에서 대상 계정을 확인합니다. 예시 이메일은 실제 **본인** 계정 이메일로 바꿉니다.

```sql
select id, email, email_confirmed_at
from auth.users
where lower(email) = lower('본인-이메일@example.com');
```

3. `email_confirmed_at`이 존재하는 정확한 계정에만 다음 SQL로 관리자 자격을 부여합니다.

```sql
insert into public.account_admins (user_id)
select id from auth.users
where lower(email) = lower('본인-이메일@example.com')
  and email_confirmed_at is not null
on conflict (user_id) do nothing;
```

4. 로그아웃 후 다시 로그인해 관리자 메뉴를 확인합니다. 관리자 회수는 같은 신뢰 세션에서 `delete from public.account_admins where user_id = '<확인한-UUID>';`로 처리합니다.

누구든 가입 화면에서 관리자 계정을 만들거나 자기 프로필을 편집해 승격할 수 있는 기능은 없습니다. 관리자 비밀번호를 코드에 하드코딩하지 않습니다.

## 5. 관리자 지원 범위

- 등록한 이메일이나 표시 이름으로 사용자를 검색합니다. 서버는 한 번에 최대 20개 계정만 반환하므로 검색어를 좁혀야 합니다.
- 사용자 신원을 확인한 다음 **등록된 이메일로만** 비밀번호 재설정 안내를 발송합니다. 임시 비밀번호를 관리자가 보거나 입력하지 않습니다.
- 같은 계정에는 60초 대기, 같은 관리자에게는 10분에 5건 제한을 적용합니다. 발송 실패도 요청 기록과 제한에 포함됩니다. 제한 예약은 DB에서 잠금으로 직렬화해 중복 요청으로 우회되지 않게 합니다.
- 계정 ID는 이메일입니다. 이메일을 잊은 사용자는 관리자가 표시 이름으로 찾을 수 있으나, 동명이인이 있으므로 본인 확인 없이 계정 정보를 다른 사람에게 알려주지 않습니다.
- 등록 이메일에 접근할 수 없는 경우는 자동 복구하지 않습니다. 프로젝트 소유자가 신원 확인 후 별도의 지원 절차로 처리해야 합니다. 이 화면에는 임의 이메일 변경·역할 변경·계정 삭제 기능이 없습니다.

## 6. 실제 연결 후 검증

서로 다른 두 일반 계정과 관리자 계정을 **운영 데이터가 없는 개발 프로젝트**에서 먼저 검증합니다.

1. 비로그인 상태에서 과목·태그·문제 탐색이 정상 동작하는지 확인합니다.
2. 가입 → 이메일 확인 → 로그인 → 로그아웃, 비밀번호 재설정 → 새 비밀번호 로그인이 실제 메일 수신을 포함해 완료되는지 확인합니다.
3. A 계정에서 저장한 문항을 다른 기기의 A 계정으로 조회하고, B 계정에서는 보이지 않는지 확인합니다. 임의로 `user_id`를 B로 바꾼 DB 요청도 거절되어야 합니다.
4. 일반 계정의 토큰으로 `account-admin`을 직접 호출해도 403인지 확인합니다. 본인 `user_metadata`에 관리자 표시를 넣어도 승격되면 안 됩니다.
5. 관리자 계정으로 검색 후 재설정 메일을 보내고, 수신 주소·redirect·감사 기록·대기 제한을 확인합니다. 실제 이메일 발송은 계정 소유자와 합의한 테스트 계정만 사용합니다.
6. 계정 간 전환·로그아웃 후 다른 사람의 저장 목록이 화면에 남지 않는지 확인합니다. 공유 컴퓨터에서 비로그인 브라우저 저장 목록과 계정 저장 목록을 자동 합치지 않습니다.

로컬 테스트의 통과는 위 운영 인증·메일·RLS 검증을 대신하지 않습니다. 데이터베이스/Edge 배포와 실제 프로젝트 연결 전에는 계정 서비스를 운영 중이라고 안내하지 않습니다.
