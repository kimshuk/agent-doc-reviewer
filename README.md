**한국어** · [English](README.en.md)

# review-doc — 교차 모델 문서 리뷰어

`review-doc`는 직접 작성한 스펙(spec)이나 플랜(plan)을 **다른** 모델에 보내 독립적으로
검토받는 도구다. 작성 모델의 문체나 사각지대에 피드백이 치우치지 않게 하기 위한 목적이다.
리뷰 결과는 기준별 커버리지, 실현 가능성, 라인 단위 발견사항(finding), 기계가 읽을 수 있는
단일 판정(verdict)을 포함하는 **구조화된** 형태로 반환된다. 각 라운드는 변경 불가능한
아티팩트로 디스크에 저장되므로, 승인될 때까지 반복한 과정도 나중에 증명할 수 있다.

이 도구는 앱이 아니라 **CLI 도구 + 워크플로 스킬**이다. 서버나 UI는 없다. 리뷰 로직은
특정 프로바이더에 종속되지 않는(provider-agnostic) 코어 라이브러리에 있으며, CLI는 그 로직을
실행하는 얇은 전송 계층이다.

> **일반적인 사용 흐름:** 코딩 에이전트가 *작성자(author)* 역할을 한다. 먼저 스펙 초안을 쓰고,
> `review-doc`로 두 번째 모델의 검토를 받는다. 발견사항을 하나씩 처리한 뒤, 스펙이 승인될 때까지
> 다시 실행한다. 그다음 코드를 작성하기 전에 승인된 스펙을 기준으로 *플랜*을 리뷰한다.

---

## 동작 방식

```
author model  ──writes──▶  spec.md / plan.md
                                │
                                ▼
        review-doc  ──sends doc + criteria──▶  reviewer model (must differ)
                                │
                                ▼
        { verdict, result }  +  immutable round artifact on disk
                                │
              ┌─────────────────┴─────────────────┐
        approved                            changes_requested
              │                                    │
              ▼                          respond to each finding,
        sign off / advance                  edit doc, re-run
```

- **기본은 교차 모델이다.** 리뷰어 모델은 작성자 모델과 달라야 한다(`--allow-same-model`로 우회 가능).
  작성자 모델 정보는 항상 기록된다.
- **기준은 명시한다.** `[CRIT-*]` 항목을 선언한 기준(criteria) 파일을 전달하면, 리뷰어는 모든 항목의
  커버리지를 정확히 한 번씩 보고해야 한다.
- **두 단계로 진행한다.** `spec`은 문서를 기준에 비추어 리뷰한다. `plan`은 여기에 더해, 플랜이
  **승인된** 상위 스펙의 모든 `[REQ-*]` 요구사항을 커버하는지도 확인한다.
- **판정은 결정론적이다.** 판정은 구조화된 결과에서 순수 함수로 계산된다. 모델은 발견사항과
  커버리지만 보고하며, 스스로 "승인됨"을 선언할 수 없다.

---

## 설치

**Node 20.6+**가 필요하다.

```bash
npm install
npm run build        # TypeScript를 dist/로 컴파일
npm test             # 테스트 실행 (네트워크 없음; 프로바이더는 모킹됨)
```

빌드된 CLI를 직접 실행:

```bash
node dist/cli/index.js <doc> --stage spec --criteria <criteria.md> ...
```

또는 `review-doc` 명령으로 링크:

```bash
npm link
review-doc <doc> --stage spec --criteria <criteria.md> ...
```

---

## 자격 증명(Credentials)

리뷰어를 실행하려면 API 키가 필요하다. 환경 변수로 설정하거나 `.env` 파일에 넣는다. 로컬 개발에서는
`.env` 파일을 쓰는 편이 편리하다. 자세한 예시는 [`.env.example`](.env.example)을 참고한다.

```bash
# .env  (gitignored — 실제 키는 절대 커밋하지 말 것)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_BASE_URL=https://your-openai-compatible-host/v1   # 선택
```

- `review-doc`는 현재 디렉터리의 `.env`를 자동으로 로드한다. 다른 파일을 사용하려면
  `--dotenv <path>`를 쓴다(예: `--dotenv prod.env`).
- **실제로 export된 셸 변수가 항상 우선한다.** 따라서 우연히 남아 있는 `.env`가 현재 셸의
  시크릿을 덮어쓸 수 없다.
- 플래그 이름은 `--dotenv`이며 `--env-file`이 **아니다**. Node 20.6+에 내장된 `--env-file`이
  인자를 `review-doc`보다 먼저 가져가기 때문이다.

| 프로바이더 | 키 | 비고 |
|----------|-----|-------|
| `openai` | `OPENAI_API_KEY` | 엄격한 `json_schema`를 지원하는 모든 OpenAI 호환 엔드포인트. 호스트는 `OPENAI_BASE_URL` 또는 `--reviewer-base-url`로 변경. |
| `anthropic` | `ANTHROPIC_API_KEY` | 구조화 출력을 위해 tool-use를 강제. |

---

## 기준 파일(criteria file)

리뷰어가 문서를 판단할 때 사용할 기준을 마크다운 목록으로 작성한다.

```markdown
# Spec review criteria

- [CRIT-SCOPE] The design stays within the stated v1 scope and defers non-blockers explicitly.
- [CRIT-FEASIBILITY] Every claimed guarantee is achievable by the described mechanism.
- [CRIT-CORRECTNESS] No described race, ambiguity, or contradiction can cause wrong behavior.
- [CRIT-STYLE OPTIONAL] Terminology is consistent across sections.
```

- `[CRIT-*]` id는 기본적으로 필수다. ` OPTIONAL`을 붙이면 비차단(non-blocking) 기준이 된다.
- 바로 복사해 시작할 수 있는 템플릿은 [`examples/criteria.spec.md`](examples/criteria.spec.md)에 있다.
- **plan** 단계에서는 상위 **스펙**에 `[REQ-*]` 요구사항 태그가 있어야 한다(예:
  `- [REQ-AUTH] users can sign in`). 이 태그는 스펙 작성 중, 즉 *승인되기 전에* 넣어야 한다.
  승인이 스펙의 콘텐츠 해시에 묶이기 때문이다.

### criteria init — 프로젝트별 기준(criteria) 초안 만들기

스펙에서 criteria **초안**을 생성한 뒤, 사용하기 전에 직접 검토·수정합니다:

```bash
review-doc criteria init docs/my-spec.md \
  --generator-provider openai --generator-model gpt-5.4
# docs/my-spec.md.criteria.md 파일을 생성 (경로 변경은 --out)
```

초안에는 코드가 소유한 고정 **baseline** 블록, 스펙에서 추출한
`CRIT-PROJECT-*` 기준, 그리고 후보 `[REQ-*]` 태그를 나열하는 advisory
**Suggested Requirements** 섹션이 들어갑니다.

주의:

- 생성된 파일은 **초안**입니다. review-doc가 만들었다는 이유만으로 신뢰하지
  마세요 — `--criteria`로 넘기기 전에 반드시 검토·수정해야 합니다.
- `criteria init`은 리뷰를 실행하지 않으며, 스펙을 절대 수정하지 않습니다.
- 스펙에 `[REQ-*]` 태그가 없어도 경고와 함께 정상 종료(exit 0)합니다.
  제안된 요구사항은 직접 스펙에 옮겨 적으세요.
- `--criteria`로 사용하기 전에 criteria 파일의 Suggested Requirements
  섹션은 삭제하세요.
- `--reviewer-base-url <url>` 는 OpenAI 호환 엔드포인트의 base URL을 덮어씁니다(anthropic 에는 무시됨).
  `--dotenv <path>` 는 자격증명이 담긴 env 파일을 지정합니다(기본 `.env`).

---

## 빠른 시작 — 스펙 리뷰

```bash
review-doc spec.md \
  --stage spec \
  --criteria criteria.spec.md \
  --reviewer-provider openai   --reviewer-model gpt-5.4 \
  --author-provider  anthropic --author-model  claude-opus-4-8 \
  --new-lineage
```

`{ verdict, result }`를 출력하고 `spec.md.review/<lineage>/round-1.json`에 라운드 아티팩트를 저장한다.

**종료 코드:** `0` 승인 · `1` 변경 요청 · `2` 오류.

`result` 객체에는 `feasibility`와 그 근거, `[CRIT-*]`별 `criteriaCoverage`, plan 단계에서만 제공되는
`upstreamCoverage`, 그리고 라인 단위 `findings`가 포함된다. 각 finding에는 severity, `fix`,
`completionCondition`이 담긴다.

---

## 리뷰 루프

문서가 승인될 때까지 다음 과정을 반복한다.

1. 문서를 **리뷰**한다(위 명령). `approved`면 종료한다.
2. 활성 발견사항마다 **응답**한다. 발견사항당 한 항목씩 JSON 배열에 작성한다:

   ```json
   [
     { "findingId": "F1", "response": "accepted_and_revised" },
     { "findingId": "F2", "response": "rejected_with_evidence", "evidence": "§3 already covers this: ..." }
   ]
   ```

   응답 종류는 `accepted_and_revised`, `rejected_with_evidence`, `already_addressed`,
   `needs_user_decision`이다. `rejected_with_evidence`와 `already_addressed`에는 비어 있지 않은
   `evidence` 문자열이 필요하다. 그다음 응답을 확정한다. 응답은 한 번만 쓸 수 있으며 해당 라운드에
   고정된다.

   ```bash
   review-doc respond \
     --round spec.md.review/<lineage>/round-1.json \
     --responses responses.json
   ```

3. 수락한 발견사항을 반영해 문서를 **수정**한 뒤, 같은 lineage의 다음 라운드로 리뷰를
   **재실행**한다:

   ```bash
   review-doc spec.md --stage spec --criteria criteria.spec.md \
     --reviewer-provider openai --reviewer-model gpt-5.4 \
     --author-provider anthropic --author-model claude-opus-4-8 \
     --prior-log spec.md.review/<lineage>/round-1.json
   ```

   다음 라운드는 이전 발견사항과 작성자의 응답을 함께 가져가므로, 리뷰어는 각 항목이 실제로
   해결됐는지 판단한다.

4. 응답 중 하나라도 `needs_user_decision`이면, 재실행하기 전에 **멈추고 사람의 결정을 받는다**.

[`review-loop` 스킬](skills/review-loop/SKILL.md)은 에이전트가 이 루프를 실행할 수 있도록 묶어 둔 것이다.

---

## spec → plan 진행

스펙이 승인되면, 그 스펙을 기준으로 플랜을 리뷰한다. `review-doc`는 스펙의 승인된 라운드를 찾아
**재계산 검증**한다. 즉 검증을 다시 실행하고 판정을 다시 계산하며, 저장된 판정을 그대로 신뢰하지
않는다. 그리고 플랜을 스펙의 콘텐츠 해시에 묶는다.

```bash
review-doc plan.md \
  --stage plan \
  --criteria criteria.plan.md \
  --prior spec.md \
  --reviewer-provider openai   --reviewer-model gpt-5.4 \
  --author-provider  anthropic --author-model  claude-opus-4-8 \
  --new-lineage
```

플랜이 스펙의 모든 `[REQ-*]`를 커버하지 않으면 **승인이 차단된다**. `not_met` 요구사항이 하나만 있어도
판정은 실패한다. 승인된 스펙 lineage가 둘 이상이면 `--prior-approval <round.json>`으로 하나를 고른다.

---

## 비교 모드(Compare mode)

같은 문서를 여러 리뷰어에게 한 번에 보낸다. 상태를 저장하지 않으며 파일도 쓰지 않는다.
리뷰어 모델을 고르거나 결과의 일치도를 점검할 때 유용하다.

```bash
review-doc spec.md --stage spec --criteria criteria.spec.md \
  --author-provider anthropic --author-model claude-opus-4-8 \
  --compare openai:gpt-5.4,anthropic:claude-sonnet-4-6
```

`{ entries, failures }`를 출력한다. 모든 리뷰어가 성공하면 종료 코드 `0`, 하나라도 실패하면 `2`로 종료한다.

---

## CLI 레퍼런스

| 플래그 | 의미 |
|------|---------|
| `<doc>` | 리뷰 대상 문서 경로(위치 인자). 또는 `respond` 하위 명령. |
| `--stage spec\|plan` | 리뷰 단계. `plan`은 `--prior` 필요. |
| `--criteria <file>` | `[CRIT-*]` 선언을 가진 기준 파일(필수). |
| `--reviewer-provider <p>` `--reviewer-model <m>` | 리뷰어 모델(`openai` 또는 `anthropic`). |
| `--author-provider <p>` `--author-model <m>` | 작성자 모델 정보. 기록되며 리뷰어와 달라야 함. |
| `--allow-same-model` | 리뷰어와 작성자 모델이 같아도 허용(기본 꺼짐). |
| `--reviewer-base-url <url>` | OpenAI 호환 호스트 변경. 또는 `OPENAI_BASE_URL` 설정. |
| `--new-lineage` | 새 리뷰 lineage 시작(라운드 1). |
| `--prior-log <round.json>` | 마지막 라운드부터 lineage 이어가기. 발견사항과 응답을 가져감. |
| `--out <dir>` | 라운드 아티팩트를 쓸 위치. 기본값은 `<doc>.review`. |
| `--prior <spec.md>` | plan 단계: 승인된 상위 스펙. |
| `--prior-approval <round.json>` | plan 단계: 자동 선택이 모호할 때 스펙의 승인 라운드 지정. |
| `--compare <p:m,...>` | 비교 모드: 여러 리뷰어에게 동시 요청. 저장하지 않음. |
| `--dotenv <path>` | 특정 env 파일에서 자격 증명 로드. 기본값은 CWD의 `.env`. |
