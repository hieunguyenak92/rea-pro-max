# REA Pro Max

**메커니즘을 이해하고. 동작을 재구현하고. 결과를 검증하세요.**

Claude Code와 Codex를 위한 독립적인 리버스 엔지니어링 스킬과 실행형 도구 모음입니다. 낯선 앱, 확장 프로그램, 웹 기능을 설명할 수 있는 메커니즘, 실행할 수 있는 구현, 확인할 수 있는 유한한 동작 계약으로 연결합니다.

[English](README.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md) · [ไทย](README.th.md) · [Français](README.fr.md)

[기록된 실험실 살펴보기](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [스킬 설치](docs/INSTALL.md) · [검증 기록](docs/VALIDATION.md) · [릴리스](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](docs/media/hero.png)

## 설득력 있는 화면은 시작에 불과합니다

진짜 어려움은 클릭 다음에 있습니다. 어떤 컨텍스트가 메시지를 받는지, 상태가 어디에 남는지, 취소가 무엇을 중단하는지, 호출자에게 어떤 오류가 돌아오는지, 재구현한 기능이 두 번째 시도에서 왜 실패하는지를 알아야 합니다.

REA Pro Max는 이 질문들을 구현 과정에 포함합니다. 배포된 JavaScript를 분석하고, 경쟁 가설을 세우고, 가설을 구분하는 실험을 고릅니다. 그런 다음 프로젝트에 요청한 동작을 구현하고 출력, 상태 변경, 이벤트를 비교합니다. 불일치가 생기면 같은 실패를 재현하는 더 작은 동작 시퀀스로 줄입니다.

**최종 결과물은 증거를 갖춘, 요청한 실행 가능한 기능입니다.** 호스트 에이전트가 코딩과 런타임 작업을 수행하며, 내장 도구는 분석·실험 순위 결정·동작 비교·실패 축소를 실행합니다.

## 평소처럼 작업을 맡기세요

[설치](docs/INSTALL.md)한 뒤 Claude Code에서 다음처럼 요청하세요.

```text
/rea-pro-max 이 확장 프로그램의 저장·복원 동작을 조사하고 내 프로젝트에 구현해 주세요. 팝업, 콘텐츠 스크립트, 워커, 스토리지 경계를 추적하세요. 실제 워커 재시작이 확인된 조건에서 영속성을 검사하고 오류 동작을 유지하세요. 실행 가능한 코드, 실제로 검사한 사례, 남은 미확인 사항을 전달하세요.
```

Codex에서는 스킬을 선택하거나 같은 작업 앞에 `$rea-pro-max`를 붙이세요. 대상과 구현할 프로젝트를 제공하면 에이전트가 내부 케이스 파일을 준비합니다. 실제 브라우저·앱·기기 관찰에는 호스트의 해당 도구가 필요합니다.

- **선택한 기능 재구현:** 순서, 오류, 취소, 영속성 경계까지 다룹니다.
- **MV3 확장 프로그램 이해:** 팝업·콘텐츠·페이지·워커 컨텍스트를 구분합니다.
- **Electron 경계 복원:** 추출된 main·preload·renderer 소스를 분석합니다.
- **빌드 간 회귀 설명:** 비교 가능한 입력과 관찰 가능한 효과를 대조합니다.
- **재현 가능한 실패 축소:** 실패의 정체성을 유지하면서 동작 수를 줄입니다.

## 약속을 믿기 전에 직접 실행해 보세요

**Node.js 22+**가 필요합니다. 내장 도구 실행에 API 키, `npm install`, 원본 REA 서버가 필요하지 않습니다.

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

브라우저에서 `rpm-lab/report.html`을 여세요. 프로젝트가 소유한 합성 실험은 **Chrome API를 모사한 제어된 JavaScript 모델**에서 참조 워커와 회귀 워커를 실행합니다. 분석·실험 순위·불일치 검출·시퀀스 축소는 실제 커널 결과입니다. 이것이 실제 Chromium 워커 중단을 입증하지는 않습니다. 별도로 실행한 런타임 검사는 [검증 기록](docs/VALIDATION.md)에 표시합니다.

포함된 아티팩트를 직접 분석할 수도 있습니다.

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

새 출력 경로를 사용하세요. 기존 결과를 조용히 덮어쓰지 않습니다. 호스트 설정과 추가 명령은 영어 [설치 및 CLI 안내](docs/INSTALL.md)를 참고하세요.

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

**v0.1 내장 분석:** JavaScript 파일과 추출된 웹·Manifest V3·Electron 소스입니다. 동적 표현식, 미지원 구문, 누락된 import, 자원 제한은 결과에 명시됩니다.

**제공자 독립 커널:** 케이스 관리, 실험 순위, 유한한 동작 비교, 시퀀스 축소, 로컬 보고서입니다. `shrink`는 사용자가 제공한 `.mjs` 오라클 모듈을 명시적으로 실행합니다.

**호스트 도구를 이용한 고급 작업:** native·managed·Android·Apple·React Native·Flutter·Tauri·WebAssembly 프롬프트를 포함합니다. 심층 분석에는 실제로 사용 가능한 적절한 도구가 필요합니다. 범용 디컴파일러, 모바일 런타임, 만능 패키지 추출기, 의미 복원 엔진은 내장되어 있지 않습니다. 형식 감지나 프롬프트만으로 통합 지원을 주장하지 않습니다.

CLI는 네트워크 요청이나 텔레메트리 업로드를 하지 않습니다. AI 호스트와 외부 도구에는 각각의 데이터 정책이 적용됩니다. 보고서에는 민감한 경로·코드·관찰값이 포함될 수 있습니다. 공유 전에 영어 [개인정보 및 실행 경계](docs/PRIVACY.md)를 확인하세요.

## 작업 후 남는 것

재구현 결과에는 실행 가능한 소스와 실행 방법, 선택한 동작 계약, 실제 수행한 검사, JSON 증거, 남은 한계가 포함되어야 합니다. 유한한 `pass`는 검사한 사례에만 적용되며 앱 전체의 동등성을 뜻하지 않습니다.

실험은 `inspection.json`, `case.json`, `planner.json`, `reference.json`, `candidate.json`, `verification.json`, `reduction.json`, `lab.json`, 독립형 `report.html`을 출력합니다. 각 기록을 따로 살펴보고 프로젝트에 보관하거나 워크벤치에서 전체 JSON을 내보낼 수 있습니다.

영어 기술 문서: [스킬](skills/rea-pro-max/SKILL.md) · [대상 범위](skills/rea-pro-max/references/target-analysis.md) · [케이스 형식](skills/rea-pro-max/references/case-format.md) · [검증 계약](skills/rea-pro-max/references/verification.md) · [프롬프트](skills/rea-pro-max/references/prompt-library.md).

독립적으로 개발된 프로젝트입니다. 연구 영감과 라이브러리 고지는 [크레딧](THIRD_PARTY_NOTICES.md)에 있으며, 원본 REA는 필수 의존성이 아닙니다. [MIT 라이선스](LICENSE).

**이해할 가치가 있는 기능을 가져오세요. 직접 확인할 수 있는 결과를 얻으세요.**
