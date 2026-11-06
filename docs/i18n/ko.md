# REA Pro Max

**메커니즘을 이해하고. 동작을 재구현하고. 결과를 검증하세요.**

Claude Code, Codex, 호환 MCP 클라이언트를 위한 독립적인 리버스 엔지니어링 도구 모음입니다. 로컬 MCP, 에이전트 스킬, 직접 실행 CLI를 제공합니다. 낯선 앱, 확장 프로그램, 웹 기능을 설명할 수 있는 메커니즘, 실행할 수 있는 구현, 확인할 수 있는 유한한 동작 계약으로 연결합니다.

[English](../../README.md) · [Tiếng Việt](vi.md) · [한국어](ko.md) · [日本語](ja.md) · [Español](es.md) · [Português](pt-BR.md) · [简体中文](zh-CN.md) · [ไทย](th.md) · [Français](fr.md)

[기록된 실험실 살펴보기](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [스킬 설치](../INSTALL.md) · [검증 기록](../VALIDATION.md) · [릴리스](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](../media/hero.png)

![자체 합성 실험의 실제 REA Pro Max 워크벤치](../media/workbench.png)

*Chrome API를 모사한 JavaScript 모델의 실제 보고서입니다. 실제 Chromium 수명주기 증거는 아닙니다.*

## 실제 워커 재시작을 견디는 저장 기능

따뜻한 세션에서 성공한 데모도 데이터 손실을 숨길 수 있습니다. v0.3은 실행 가능한 수신 프로젝트를 만듭니다. starter는 저장과 페이지 재열기를 통과하지만, Chromium이 워커를 실제로 중지하고 깨우면 확인된 값을 잃습니다.

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery init --out ./recovery-work
node skills/rea-pro-max/scripts/rea-pro-max.mjs runtime doctor --browser "$RPM_BROWSER"
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery replay --reference ./recovery-work/reference --candidate ./recovery-work/starter --scenario ./recovery-work/scenario.json --browser "$RPM_BROWSER" --out ./before.json
```

`RPM_BROWSER`를 압축을 푼 확장 프로그램을 지원하는 설치된 Chromium/Chrome for Testing 실행 파일의 절대 경로로 지정하세요. 브라우저를 자동 다운로드하지 않습니다. 첫 replay는 의도적으로 exit `2`를 반환하며 실패한 작업과 두 실행의 증거를 보존합니다. 에이전트에게 `starter/contract.json`에 따라 `starter/worker.js`를 수정하게 하고 새 출력 파일로 다시 실행하세요. `recovered/`는 독립적으로 작성된 실행 가능한 수신 구현 예제입니다.

**결과는 실행 가능한 코드와 검토할 수 있는 증거입니다.** 이 제공자는 현재 문서화된 `rpm-kv-v1` 메시지 프로토콜과 선택한 초기화 경계만 검사합니다. 임의 확장 프로그램을 자동 복원하지 않습니다. 원시 증거에는 boot ID가 남으며 비교에서 선언된 관찰 필드만 제외됩니다. 메시지 receipt는 관찰하지 않은 UI·네트워크·파일 효과를 입증하지 않습니다.

MCP는 **15개 도구**를 제공합니다. 런타임은 기본 비활성화이며 서버 등록 시 `--browser "/absolute/path/to/chromium"`을 추가하면 `capture_feature`와 `replay_feature`가 활성화됩니다. 각각 임시 프로필을 사용하며 호스트 에이전트가 수정을 작성합니다. `read_source_evidence`는 해시를 확인한 제한된 소스 조각을 읽습니다. include/exclude와 coverage는 읽은 파일, 제외한 파일, 파싱하지 않은 파일을 명시합니다. TypeScript/JSX 의미 분석은 아직 제공하지 않습니다.

[복원 흐름과 제한 — 영어](../RECOVERY.md) · [버전별 검증](../VALIDATION.md). `shrink`는 시도마다 새 자식 프로세스에서 기한을 두고 oracle을 실행합니다. 외부 상태는 oracle의 `reset()`이 담당합니다. 새 프로필과 자식 프로세스는 OS나 네트워크 샌드박스가 아닙니다.

## 설득력 있는 화면은 시작에 불과합니다

진짜 어려움은 클릭 다음에 있습니다. 어떤 컨텍스트가 메시지를 받는지, 상태가 어디에 남는지, 취소가 무엇을 중단하는지, 호출자에게 어떤 오류가 돌아오는지, 재구현한 기능이 두 번째 시도에서 왜 실패하는지를 알아야 합니다.

REA Pro Max는 이 질문들을 구현 과정에 포함합니다. 배포된 JavaScript를 분석하고, 경쟁 가설을 세우고, 가설을 구분하는 실험을 고릅니다. 그런 다음 프로젝트에 요청한 동작을 구현하고 출력, 상태 변경, 이벤트를 비교합니다. 불일치가 생기면 같은 실패를 재현하는 더 작은 동작 시퀀스로 줄입니다.

**최종 결과물은 증거를 갖춘, 요청한 실행 가능한 기능입니다.** 호스트 에이전트가 코딩과 런타임 작업을 수행하며, 내장 도구는 분석·실험 순위 결정·동작 비교·실패 축소를 실행합니다.

## 평소처럼 작업을 맡기세요

[설치](../INSTALL.md)한 뒤 Claude Code에서 다음처럼 요청하세요.

```text
/rea-pro-max 이 확장 프로그램의 저장·복원 동작을 조사하고 내 프로젝트에 구현해 주세요. 팝업, 콘텐츠 스크립트, 워커, 스토리지 경계를 추적하세요. 실제 워커 재시작이 확인된 조건에서 영속성을 검사하고 오류 동작을 유지하세요. 실행 가능한 코드, 실제로 검사한 사례, 남은 미확인 사항을 전달하세요.
```

Codex에서는 스킬을 선택하거나 같은 작업 앞에 `$rea-pro-max`를 붙이세요. 대상과 구현할 프로젝트를 제공하면 에이전트가 내부 케이스 파일을 준비합니다. 실제 브라우저·앱·기기 관찰에는 호스트의 해당 도구가 필요합니다.

- **선택한 기능 재구현:** 순서, 오류, 취소, 영속성 경계까지 다룹니다.
- **MV3 확장 프로그램 이해:** 팝업·콘텐츠·페이지·워커 컨텍스트를 구분합니다.
- **Electron 경계 복원:** 추출된 main·preload·renderer 소스를 분석합니다.
- **빌드 간 회귀 설명:** 비교 가능한 입력과 관찰 가능한 효과를 대조합니다.
- **재현 가능한 실패 축소:** 실패의 정체성을 유지하면서 동작 수를 줄입니다.

## 하나의 도구 모음, 세 가지 시작 방법

**v0.3은 15개 도구의 로컬 MCP**, 선택적 실제 Chromium 캡처/replay와 해시 확인 소스 조각을 제공합니다. 스킬은 에이전트의 실행 가능한 구현 전달을 지원하며 CLI는 같은 커널을 사용합니다. 런타임 npm 설치는 필요 없습니다.

### Claude Code 또는 Codex에 MCP 연결

예시의 절대 경로를 실제 경로로 바꾸세요. 워크스페이스는 대상과 출력 위치를 포함하는 기존 디렉터리여야 합니다. 아래는 사용자가 실행할 설정 명령이며, 제품이 다른 앱의 설정을 자동으로 수정하지 않습니다.

**아래 명령의 경로는 Git checkout 구조를 사용합니다.** Releases의 패키징된 스킬 ZIP에서는 압축을 푼 `rea-pro-max/`가 스킬 루트입니다. 그 안에서 `node scripts/rea-pro-max.mjs demo --out ./rpm-lab`을 실행하고, MCP에는 `/absolute/path/to/rea-pro-max/scripts/mcp-server.mjs`를 사용하며, 설치 시 폴더 전체를 복사하세요. [구조와 ZIP 명령 — 영어](../INSTALL.md#choose-your-package-layout). GitHub 자동 Source code 압축 파일은 checkout 구조를 유지합니다.

```sh
claude mcp add --transport stdio --scope local rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

```sh
codex mcp add rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

호스트를 다시 연결하고 도구 목록을 확인한 뒤 `get_capabilities`를 호출하도록 요청하세요. 데스크톱 호스트의 PATH가 다르면 Node 실행 파일의 절대 경로를 쓰세요. 영어 [MCP 가이드](../MCP.md)에 JSON 설정, 인자, 제한과 오류 처리가 있습니다.

서버는 로컬 stdio를 사용합니다. 직접 실행하면 대화형 화면 대신 MCP 메시지를 기다립니다.

```sh
node /absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs --workspace /absolute/path/to/your-workspace
```

### 일반 코딩 작업에 스킬 추가

`skills/rea-pro-max` **폴더 전체**를 Claude Code 프로젝트의 `.claude/skills/rea-pro-max` 또는 Codex 프로젝트의 `.agents/skills/rea-pro-max`에 복사하세요. `lib`, `scripts`, `references`, `assets`가 실행 기능의 일부입니다. `SKILL.md`만 복사하면 도구가 빠집니다.

Claude Code에서는 `/rea-pro-max`, Codex에서는 스킬 선택 또는 `$rea-pro-max`를 사용하세요. 영어 [INSTALL.md](../INSTALL.md)에 덮어쓰기를 방지하는 복사 명령, 개인 설치 위치, Windows 안내가 있습니다.

### CLI로 독립 실행

아래 데모는 MCP 없이 실행됩니다. 환경에 맞게 스킬·MCP·CLI를 선택할 수 있으며 원본 REA 서버는 필요하지 않습니다.

## MCP 도구: 아티팩트에서 전달 가능한 결과까지

| 도구 | 역할 |
| --- | --- |
| `get_capabilities` | 버전, 워크스페이스, 범위, 제한, 실행 정책 확인. |
| `inspect_artifact` | 범위 안의 아티팩트를 정적으로 분석하고 핸들 뒤에 전체 결과 저장. |
| `read_artifact` | 전체 그래프를 반복하지 않고 필요한 섹션/페이지 읽기. |
| `read_source_evidence` | 증거 ID에 해당하는 제한된 소스 조각을 해시 확인 후 읽기. |
| `capture_feature` | 런타임 활성화 시 실제 Chromium에서 MV3 시나리오 캡처. |
| `replay_feature` | 참조와 수신 프로젝트를 별도로 실행하고 판정·불일치 보존. |
| `create_case` | 실제 검사 대상 식별자로 케이스 생성. |
| `revise_case` | 패치와 예상 리비전을 검증한 뒤 갱신. |
| `record_observation` | 출처·권한 수준·바인딩을 포함한 관찰 저장. |
| `rank_probes` | 허용된 실험 순위 결정. 실험 자체는 실행하지 않음. |
| `verify_behavior` | 유한한 계약 아래 receipt 파일 비교. |
| `export_artifact` | 새 워크스페이스 파일에 JSON/독립 HTML 내보내기. |
| `run_owned_lab` | 동봉된 자체 워커의 제어 모델 실행. |
| `list_task_prompts` | 36개 템플릿을 계열별로 페이지 조회. |
| `import_case` | 검증된 기존 케이스 JSON으로 재개. |

핸들은 프로세스 메모리의 불투명 식별자입니다. 캐시는 제한되어 있으며 재시작 또는 퇴거 후에는 저장한 케이스를 가져오거나 다시 분석해야 합니다. `read_artifact`로 필요한 부분을 읽으세요. 실제 클라이언트가 발견한 스키마가 정확한 인자 계약입니다.

MCP는 클라이언트 경로를 워크스페이스 안으로 제한하고 심볼릭 링크와 출력 덮어쓰기를 거부합니다. 시작 시 `--browser`를 설정해야 전용 도구가 임시 프로필에서 프로토콜 기반 MV3 확장을 실행합니다. 임의 셸이나 oracle 도구는 없습니다. 이는 도구 정책이며 OS/네트워크 샌드박스가 아닙니다.

## 약속을 믿기 전에 직접 실행해 보세요

**Node.js 22+**가 필요합니다. 내장 도구 실행에 API 키, `npm install`, 원본 REA 서버가 필요하지 않습니다.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

브라우저에서 `rpm-lab/report.html`을 여세요. 프로젝트가 소유한 합성 실험은 **Chrome API를 모사한 제어된 JavaScript 모델**에서 참조 워커와 회귀 워커를 실행합니다. 분석·실험 순위·불일치 검출·시퀀스 축소는 실제 커널 결과입니다. 이것이 실제 Chromium 워커 중단을 입증하지는 않습니다. 별도로 실행한 런타임 검사는 [검증 기록](../VALIDATION.md)에 표시합니다.

포함된 아티팩트를 직접 분석할 수도 있습니다.

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

새 출력 경로를 사용하세요. 기존 결과를 조용히 덮어쓰지 않습니다. 호스트 설정과 추가 명령은 영어 [설치 및 CLI 안내](../INSTALL.md)를 참고하세요.

## 확인할 수 있는 전문성

| 기능 | 조사에 더하는 가치 |
| --- | --- |
| 아티팩트 경계 분석 | Acorn AST 파싱, 분리된 실행 컨텍스트, 후보 통신 연결, 정확한 소스 위치와 다이제스트. `inspect`는 대상 코드를 실행하지 않습니다. |
| 경쟁 가설 | 첫 번째 그럴듯한 설명에 머무르지 않고 예측과 초기화 절차가 명시된 실험을 구성합니다. |
| 보수적인 실험 순위 | 선언된 비용당 최악의 경우 제거 가능한 가설 수를 계산하고 기능·허용 효과·예산으로 필터링합니다. 누락된 예측은 미확인으로 남습니다. |
| 관찰의 유효성 범위 | 대상·시나리오·초기화·도구 체인 식별자가 맞지 않는 관찰은 현재 추론에 사용하지 않습니다. 해시는 내용 식별이지 실행 사실의 보증이 아닙니다. |
| 유한한 동작 검증 | 출력·상태·효과·트레이스에 `pass`·`fail`·`unknown`을 적용하고 중복 이벤트와 중요한 순서를 보존합니다. |
| 실패 시퀀스 축소 | 제한된 예산 안에서 반복적인 오라클 검사와 동일한 실패 지문을 유지합니다. 전역 최단 시퀀스를 보장하지 않습니다. |
| 로컬 워크벤치 | 검색, 컨텍스트 필터, 증거 선택, 전체 JSON 내보내기가 가능한 독립 HTML. 백엔드나 CDN이 필요 없습니다. |
| 작업 프롬프트 36개 | 웹·확장 프로그램·데스크톱·모바일 계열의 작업과 전제 조건을 제시합니다. 템플릿이 있다고 제공자 지원이 검증된 것은 아닙니다. |

플래너는 다음 실험을 고르지만 실행하지 않습니다. 검증기는 제공된 관찰을 비교하지만 런타임 실행 자체를 인증하지 않습니다. 스킬은 호스트 에이전트가 그 작업을 수행하고 증거를 남기도록 지시합니다.

## 명확한 범위가 결과의 신뢰도를 만듭니다

**v0.3 내장 분석:** JavaScript 파일과 추출된 웹·Manifest V3·Electron 소스입니다. 동적 표현식, 미지원 구문, 누락된 import, 자원 제한은 결과에 명시됩니다.

**제공자 독립 커널:** 케이스 관리, 실험 순위, 유한한 동작 비교, 시퀀스 축소, 로컬 보고서입니다. `shrink`는 사용자가 제공한 `.mjs` 오라클 모듈을 명시적으로 실행합니다.

**호스트 도구를 이용한 고급 작업:** native·managed·Android·Apple·React Native·Flutter·Tauri·WebAssembly 프롬프트를 포함합니다. 심층 분석에는 실제로 사용 가능한 적절한 도구가 필요합니다. 범용 디컴파일러, 모바일 런타임, 만능 패키지 추출기, 의미 복원 엔진은 내장되어 있지 않습니다. 형식 감지나 프롬프트만으로 통합 지원을 주장하지 않습니다.

CLI/MCP에는 텔레메트리 업로드나 모델 API 호출이 없습니다. 정적 작업은 로컬 처리이며 선택적 런타임은 루프백 디버깅 연결을 사용합니다. 확장 프로그램과 브라우저는 자체 권한으로 네트워크에 접근할 수 있습니다. AI 호스트의 정책은 별도입니다. [개인정보와 실행 경계 — 영어](../PRIVACY.md).

## 작업 후 남는 것

재구현 결과에는 실행 가능한 소스와 실행 방법, 선택한 동작 계약, 실제 수행한 검사, JSON 증거, 남은 한계가 포함되어야 합니다. 유한한 `pass`는 검사한 사례에만 적용되며 앱 전체의 동등성을 뜻하지 않습니다.

실험은 `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json`, 독립형 `report.html`을 출력합니다. 각 기록을 따로 살펴보고 프로젝트에 보관하거나 워크벤치에서 전체 JSON을 내보낼 수 있습니다.

## 살펴볼 수 있는 실제 예제

**유니코드 검색:** [수신 구현](../../examples/recovered-search/CONTRACT.md)은 웹 fixture의 선택된 계약을 재구현합니다. NFKC, 로캘 소문자 변환, 부분 문자열 매칭, 안정적인 레코드 순서, 문자열 ID를 유지합니다. 원본과 수신 앱은 따로 실행했습니다. 유한한 사례와 한계는 [VALIDATION.md](../VALIDATION.md)에 있습니다. 같은 에이전트가 소스에 접근해 작성·확인한 예제이며 블라인드 연구나 스킬의 인과 효과 벤치마크가 아닙니다.

![별도로 실행한 검색 구현](../media/recovered-search.png)

**Electron 내보내기:** 자체 fixture를 renderer → preload → `ipcRenderer.invoke` → main 경로로 실행하고 로컬 JSON 파일을 다시 읽었습니다. 정적 연결은 후보로 남고, 런타임 관찰은 실제 수행한 동작의 근거가 됩니다.

![실제 Electron 내보내기 응답](../media/electron-runtime.png)

## 내부의 전문적인 판단

실험 점수는 최악의 경우 제거 가능한 가설 수를 선언된 비용으로 나눈 값입니다. 기능·허용 효과·예산 필터를 먼저 적용합니다. 모든 가설이 적격 관찰과 모순되면 `model_incomplete`, 구분 가능한 허용 실험이 없으면 `no_discriminating_probe`가 될 수 있습니다. 불확실성을 근거 없는 신뢰도 백분율로 바꾸지 않습니다.

검증기는 명시한 메타데이터 경로만 정규화하며 output/state/effects/trace 차이를 지우지 않습니다. 전체 순서 또는 채널별 순서 계약이 중복 이벤트와 의미 있는 순서를 보존합니다. 축소기는 반복 오라클 검사, 시도 전 초기화, 동일 실패 지문을 사용하며 최소성은 실제 확인한 제거 연산에 한정됩니다.

## 자주 묻는 질문과 문제 해결

**MCP와 스킬이 모두 필요한가요?** 아닙니다. MCP는 구조화된 도구, 스킬은 작업 지침을 제공합니다. CLI도 직접 실행할 수 있습니다.

**스킬이 기능을 작성하나요?** 호스트 에이전트가 프로젝트에 구현하고 실행하도록 지시합니다. 보고서만으로 재구현 요청이 완료되지는 않습니다.

**MCP 종료 후 케이스가 남나요?** 종료 전 JSON으로 내보내고 새 세션에서 `import_case`를 사용하세요. 핸들은 프로세스 간에 유지되지 않습니다.

**왜 `unknown`인가요?** 누락된 receipt, 비교 불가능한 입력, scenario/reset/toolchain/verifier 바인딩을 확인하세요. `unknown`은 자동으로 `pass`가 되지 않습니다.

| 문제 | 다음 단계 |
| --- | --- |
| MCP 시작 실패 | Node22+, 절대 경로, 기존 워크스페이스 확인. |
| 도구가 보이지 않음 | 호스트 재연결, 서버 상태와 MCP 권한 확인. |
| 핸들 사용 불가 | 저장한 케이스를 가져오거나 재시작/캐시 퇴거 후 다시 분석. |
| 리비전 충돌 | 최신 케이스의 실제 리비전 사용. |
| 자원 제한/범위 초과 | 더 좁은 아티팩트 또는 올바른 워크스페이스 선택. |
| 출력 파일 존재 | 이전 증거를 보존하도록 새 이름 선택. |

다음 개발 방향은 불확실성을 명시한 정적 해석 개선, 재현 가능한 기능 복원 예제, 실제 실행 검증이 가능한 버전별 제공자 통합입니다. 이는 로드맵이며 이미 제공되는 지원이 아닙니다.

영어 기술 문서: [스킬](../../skills/rea-pro-max/SKILL.md) · [대상 범위](../../skills/rea-pro-max/references/target-analysis.md) · [케이스 형식](../../skills/rea-pro-max/references/case-format.md) · [검증 계약](../../skills/rea-pro-max/references/verification.md) · [프롬프트](../../skills/rea-pro-max/references/prompt-library.md).

독립적으로 개발된 프로젝트입니다. 연구 영감과 라이브러리 고지는 [크레딧](../../THIRD_PARTY_NOTICES.md)에 있으며, 원본 REA는 필수 의존성이 아닙니다. [MIT 라이선스](../../LICENSE).

**이해할 가치가 있는 기능을 가져오세요. 직접 확인할 수 있는 결과를 얻으세요.**
