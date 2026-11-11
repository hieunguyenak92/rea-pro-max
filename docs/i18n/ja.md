# REA Pro Max

**仕組みを理解する。動作を再構築する。結果を検証する。**

Claude Code、Codex、互換MCPクライアントのための独立したリバースエンジニアリングツールキット。ローカルMCP、エージェントスキル、直接実行CLIを提供します。未知のアプリ、拡張機能、Web機能を、説明できる仕組み、実行できる実装、確認できる有限の動作契約へとつなげます。

[English](../../README.md) · [Tiếng Việt](vi.md) · [한국어](ko.md) · [日本語](ja.md) · [Español](es.md) · [Português](pt-BR.md) · [简体中文](zh-CN.md) · [ไทย](th.md) · [Français](fr.md)

[記録済みラボを体験](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [スキルを導入](../INSTALL.md) · [検証記録](../VALIDATION.md) · [リリース](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](../media/hero.png)

![自作合成ラボからの実際のREA Pro Maxワークベンチ](../media/workbench.png)

*Chrome APIを模擬したJavaScriptモデルの実レポートです。実際のChromiumライフサイクルの証拠ではありません。*

## 実際のworker再起動を越えて保存を維持する

同じセッションで動くデモでも、データ消失を隠している場合があります。v0.4は実行可能な受け入れプロジェクトを作ります。starterは保存とページの再表示を通過しますが、Chromiumがworkerを実際に停止して起動し直すと、確認済みの値を失います。

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery init --out ./recovery-work
node skills/rea-pro-max/scripts/rea-pro-max.mjs runtime doctor --browser "$RPM_BROWSER"
node skills/rea-pro-max/scripts/rea-pro-max.mjs recovery replay --reference ./recovery-work/reference --candidate ./recovery-work/starter --scenario ./recovery-work/scenario.json --browser "$RPM_BROWSER" --out ./before.json
```

`RPM_BROWSER`には、展開済み拡張を読み込める、インストール済みChromium/Chrome for Testing実行ファイルの絶対パスを指定します。ブラウザーは自動ダウンロードされません。最初のreplayは意図的にexit `2`となり、不一致の操作と両方の実行証拠を残します。エージェントに`starter/contract.json`に従って`starter/worker.js`を修正させ、新しい出力先で再実行してください。`recovered/`は独立して作成された、実行可能な受け入れ実装の例です。

**成果物は、実行できるコードと確認できる証拠です。** このproviderは現在、文書化された`rpm-kv-v1`メッセージプロトコルと選択したリセット境界を検査します。任意の拡張を自動復元するものではありません。boot IDは生の証拠に残し、比較では宣言済みの観測フィールドだけを除外します。メッセージreceiptは未観測のUI・ネットワーク・ファイル効果を証明しません。

MCPは**21ツール**です。runtimeは既定で無効です。サーバー登録時に`--browser "/absolute/path/to/chromium"`を加えると`capture_feature`と`replay_feature`が使えます。それぞれ一時プロファイルで実行し、修正コードはホストエージェントが書きます。`read_source_evidence`はハッシュ確認済みのソース断片を返します。include/excludeとcoverageは採用・除外・未解析ファイルを明示し、TypeScript/JSXの意味解析はまだ提供しません。

[復元手順と制限・英語](../RECOVERY.md) · [バージョン別検証](../VALIDATION.md)。`shrink`は各試行を期限付きの新しい子プロセスで実行します。外部状態のリセットはoracleの`reset()`が担当します。新しいプロファイルや子プロセスはOS・ネットワークのサンドボックスではありません。

## 見た目が整った画面は、まだ出発点です

難しさはクリックの先にあります。どのコンテキストがメッセージを受け取るのか。状態はどこに残るのか。キャンセルは何を止めるのか。どのエラーが呼び出し元に返るのか。なぜ再構築した機能は2回目に失敗するのか。

REA Pro Maxは、こうした問いを実装の工程に組み込みます。配布されたJavaScriptを解析し、競合する仮説を立て、それらを切り分ける実験を選びます。必要な動作を自分のプロジェクトに実装し、出力・状態変化・イベントを比較します。不一致が見つかれば、同じ失敗を再現する小さな操作列へ絞り込みます。

**成果物は、証拠を伴う、依頼された実行可能な機能です。** ホストのエージェントがコーディングとランタイム操作を担当し、付属ツールが解析、実験の順位付け、動作比較、失敗の縮小を実行します。

## いつもの依頼にスキルを添えるだけ

[導入](../INSTALL.md)後、Claude Codeで自然な言葉で依頼します。

```text
/rea-pro-max この拡張機能の保存と復元を調査し、私のプロジェクトに実装してください。popup、content script、worker、storageの境界を追跡し、workerの再起動が確認できる条件で永続性を検証してください。エラー動作を保ち、実行可能なコード、実際に確認したケース、未確認事項を納品してください。
```

Codexではスキルを選択するか、同じ依頼の先頭に`$rea-pro-max`を付けます。対象と実装先のプロジェクトを渡せば、エージェントが内部のケースファイルを作成します。実際のブラウザ・アプリ・デバイスを観察するには、ホスト側に対応するツールが必要です。

- **特定の機能を再構築：** 順序、エラー、キャンセル、永続性の境界まで扱います。
- **MV3拡張機能を理解：** popup・content・page・workerを区別して調べます。
- **Electronの境界を復元：** 展開済みmain・preload・rendererソースを解析します。
- **ビルド間のリグレッションを説明：** 比較可能な入力と観測可能な作用を照合します。
- **再現可能な失敗を縮小：** 失敗の種類を維持しながら操作列を短くします。

## 一つのツールキット。三つの始め方。

**v0.4は21ツールのローカルMCP**、任意設定の実Chromium capture/replay、ハッシュ確認済みソース断片を提供します。スキルは実行可能な実装の納品を導き、CLIは同じカーネルを使います。利用時のnpmインストールは不要です。

### Claude CodeまたはCodexへMCPを接続

例の絶対パスを実際のものに置き換えてください。ワークスペースは、対象と出力先を含む既存ディレクトリです。以下は利用者が実行する設定手順であり、製品が他アプリの設定を自動で変更することはありません。

**以下のコマンドはGit checkoutの構成です。** Releasesのパッケージ済みスキルZIPでは、展開した`rea-pro-max/`がスキルのルートになります。そこで`node scripts/rea-pro-max.mjs demo --out ./rpm-lab`を実行し、MCPには`/absolute/path/to/rea-pro-max/scripts/mcp-server.mjs`を指定し、導入時はフォルダー全体をコピーします。[構成とZIPコマンド・英語](../INSTALL.md#choose-your-package-layout)。GitHubが自動生成するSource codeアーカイブはcheckout構成です。

```sh
claude mcp add --transport stdio --scope local rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

```sh
codex mcp add rea-pro-max -- node "/absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs" --workspace "/absolute/path/to/your-workspace"
```

ホストを再接続し、ツール一覧を確認して`get_capabilities`を呼び出してください。デスクトップのPATHが異なる場合はNode実行ファイルの絶対パスを使います。英語の[MCPガイド](../MCP.md)にJSON設定、引数、制限、エラー処理をまとめています。

サーバーはローカルstdioを使います。直接起動すると対話画面ではなくMCPメッセージを待ちます。

```sh
node /absolute/path/to/rea-pro-max/skills/rea-pro-max/scripts/mcp-server.mjs --workspace /absolute/path/to/your-workspace
```

### 通常の開発タスクにスキルを追加

`skills/rea-pro-max`の**フォルダー全体**を、Claude Codeプロジェクトの`.claude/skills/rea-pro-max`、またはCodexプロジェクトの`.agents/skills/rea-pro-max`へコピーします。`lib`、`scripts`、`references`、`assets`も実行機能の一部です。`SKILL.md`だけでは機構が欠けます。

Claude Codeでは`/rea-pro-max`、Codexではスキル選択または`$rea-pro-max`を使います。英語の[INSTALL.md](../INSTALL.md)に上書きを防ぐコピー手順、個人向け設置先、Windowsの説明があります。

### CLIを直接実行

以下のデモはMCPなしで動きます。スキル・MCP・CLIから環境に合った方法を選べます。元のREAサーバーは必要ありません。

## MCPツール：アーティファクトから引き渡せる結果へ

| ツール | 役割 |
| --- | --- |
| `get_capabilities` | バージョン、ワークスペース、範囲、制限、実行方針を確認。 |
| `inspect_artifact` | 範囲内の静的解析を行い、完全な結果をハンドルで保持。 |
| `read_artifact` | グラフ全体を繰り返さず、必要なセクションやページを読む。 |
| `read_source_evidence` | 証拠IDに対応する、ハッシュ確認済みの短いソースを読む。 |
| `capture_feature` | runtime有効時、実ChromiumでMV3シナリオを記録。 |
| `replay_feature` | 参照と受け入れ拡張を別々に実行し、判定と不一致を保存。 |
| `create_case` | 解析した対象の実際の識別情報からケースを作成。 |
| `revise_case` | パッチと期待リビジョンを検証して更新。 |
| `record_observation` | 出典・authority・bindingsを保った観測を記録。 |
| `rank_probes` | 許可された実験を順位付け。実験自体は実行しない。 |
| `verify_behavior` | 有限の契約に従ってreceiptファイルを比較。 |
| `export_artifact` | 新しいワークスペースファイルにJSONまたは独立HTMLを出力。 |
| `run_owned_lab` | 同梱の自作workerによる制御モデルだけを実行。 |
| `list_task_prompts` | 36テンプレートを系統別にページ表示。 |
| `import_case` | 保存済みケースJSONを検証して再開。 |

ハンドルはプロセス内メモリーの不透明な識別子です。キャッシュには上限があり、再起動や退避後は保存したケースをインポートするか再解析します。`read_artifact`で必要な部分を読みます。実行中クライアントが取得するスキーマが正確な引数契約です。

MCPはクライアント指定パスをworkspace内に限定し、シンボリックリンクと既存出力の上書きを拒否します。起動時に`--browser`を設定した場合に限り、専用ツールが一時プロファイルでプロトコル対応MV3拡張を実行します。任意shellやoracle実行ツールはありません。これはツール方針であり、OS・ネットワークサンドボックスではありません。

## 約束を信じる前に、仕組みを動かしてください

**Node.js 22以降**が必要です。付属ツールの実行にAPIキー、`npm install`、元のREAサーバーは不要です。

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

ブラウザで`rpm-lab/report.html`を開きます。この自作の合成ラボでは、**Chrome APIを模擬した制御下のJavaScriptモデル**で参照workerと回帰workerを実行します。解析・実験の順位付け・不一致検出・操作列縮小は実際のカーネル出力です。実際のChromium workerの停止を証明するものではありません。別途実行したランタイム検証は[検証記録](../VALIDATION.md)に記載します。

同梱アーティファクトを直接解析できます。

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

新しい出力先を指定してください。既存の結果は暗黙に上書きされません。設定と追加コマンドは英語の[導入・CLIガイド](../INSTALL.md)を参照してください。

## 専門性を、確認できる機構として提供

| 機能 | 調査で得られるもの |
| --- | --- |
| アーティファクト境界解析 | AcornによるAST解析、実行コンテキストの分離、候補通信エッジ、正確なソース位置とダイジェスト。`inspect`は対象コードを実行しません。 |
| 競合仮説 | 予測とリセット手順を明示し、最初のもっともらしい説明だけで結論を出すことを避けます。 |
| 保守的な実験順位付け | 宣言したコストに対して、最悪の場合に除外できる仮説数を評価。能力・許可された作用・予算で絞り込み、不明な予測は不明のまま残します。 |
| 観測の適用範囲 | 対象・シナリオ・リセット・ツールチェーンの識別情報で、互換性のない観測を現在の推論から除外します。ハッシュは内容の同一性を示し、実行の真実性を保証しません。 |
| 有限の動作検証 | 出力・状態・作用・トレースに`pass`・`fail`・`unknown`を付与。重複イベントと重要な順序を維持します。 |
| 失敗の縮小 | 予算内でオラクルを繰り返し確認し、同じ失敗フィンガープリントを保持。大域的な最短列は保証しません。 |
| ローカルワークベンチ | 検索、コンテキスト絞り込み、証拠の選択、全JSON出力ができる独立HTML。バックエンドもCDNも不要です。 |
| 36のタスクプロンプト | Web・拡張機能・デスクトップ・モバイル系の依頼と前提条件。テンプレートの存在はプロバイダー対応の検証を意味しません。 |

プランナーは次の実験を選びますが、実行しません。検証器は提供された観測を比較しますが、ランタイムの実行自体を認証しません。スキルはホストエージェントに実作業と証拠の保存を指示します。

## 範囲を明確にし、結果の意味を保つ

**v0.4の内蔵解析：** JavaScriptファイル、および展開済みWeb・Manifest V3・Electronソース。動的な式、未対応構文、欠落import、リソース制限は結果に明示されます。

**プロバイダー非依存カーネル：** ケース管理、実験順位付け、有限の動作比較、列の縮小、ローカルレポート。`shrink`は指定した自作の`.mjs`オラクルを明示的に実行します。

**ホストツールを使う高度なワークフロー：** native・managed・Android・Apple・React Native・Flutter・Tauri・WebAssembly向けプロンプトもあります。深い解析には利用可能な適切なツールが必要です。汎用デコンパイラー、モバイルランタイム、万能なパッケージ展開器、意味復元エンジンは内蔵していません。形式検出やテンプレートだけでは、動作する統合とは呼べません。

CLI/MCPはテレメトリーを送信せず、モデルAPIも呼びません。静的操作はローカル処理です。任意設定のruntimeはloopbackデバッグ接続を使い、拡張やブラウザーは自身の権限でネットワークへアクセスできます。AIホストの方針は別です。[プライバシーと実行境界・英語](../PRIVACY.md)。

## 手元に残る成果物

再構築の納品には、動作するソースと起動方法、選択した動作契約、実際に試した操作、JSON証拠、残る制限を含めます。有限の`pass`は確認したケースに対する結果であり、アプリ全体の等価性を意味しません。

ラボは`inspection.json`、`case.json`、`planner.json`、`reference.json`、`candidate.json`、`verification.json`、`reduction.json`、`lab.json`、独立した`report.html`を出力します。記録を個別に確認し、プロジェクトと保管し、ワークベンチから全JSONを出力できます。

## 確認できる実例と証拠

**Unicode検索：** [実装先の検索アプリ](../../examples/recovered-search/CONTRACT.md)は、Web fixtureの選択した契約を再構築します。NFKC、ロケールに沿う小文字化、部分文字列一致、安定した順序、文字列IDを維持します。対象と実装先アプリは別々に起動しました。有限のケースと制限は[VALIDATION.md](../VALIDATION.md)を参照してください。同じエージェントがソースを見て実装・確認した例であり、盲検研究やスキルの因果効果を測るベンチマークではありません。

![別途起動した検索実装](../media/recovered-search.png)

**Electron出力：** 自作fixtureをrenderer → preload → `ipcRenderer.invoke` → mainの経路で動かし、ローカルJSONを読み戻しました。静的な接続は候補のまま保持し、実行時の観測が試した動作の証拠になります。

![実際のElectron出力応答](../media/electron-runtime.png)

## 内部に組み込まれた専門的判断

実験スコアは、最悪の場合に除外できる仮説数を宣言コストで割った値です。能力・許可された作用・予算で先に絞ります。すべての仮説が適格な観測と矛盾すれば`model_incomplete`、区別できる許可実験がなければ`no_discriminating_probe`になり得ます。不確実性を根拠のない信頼度パーセンテージに置き換えません。

検証器が正規化できるのは明示したmetadataパスだけで、output/state/effects/traceの違いは消せません。全順序またはチャネル別順序の契約で重複と意味のある順序を保持します。縮小器は繰り返しのオラクル検査、各試行前のリセット、同じ失敗指紋を使い、最小性は実際に試した削除操作に限られます。

## FAQとトラブルシューティング

**MCPとスキルは両方必須ですか？** いいえ。MCPは構造化ツールを、スキルは作業指示を提供します。CLIも直接使えます。

**スキルは機能を実装しますか？** ホストエージェントにプロジェクトへの実装と起動を指示します。レポートだけで再構築依頼が完了するわけではありません。

**MCPを終了してもケースは残りますか？** 終了前にJSON出力し、新しいセッションで`import_case`を使います。ハンドルはプロセスをまたいで残りません。

**なぜ`unknown`ですか？** receiptの不足、比較できない入力、scenario/reset/toolchain/verifierのbindingsを確認してください。自動的に`pass`へ変更されません。

| 問題 | 次の操作 |
| --- | --- |
| MCPが起動しない | Node22+、絶対パス、既存ワークスペースを確認。 |
| ツールが見えない | ホスト再接続、サーバー状態、MCP権限を確認。 |
| ハンドルが使えない | 再起動/キャッシュ退避後に保存ケースをインポート、または再解析。 |
| リビジョン競合 | 最新ケースの実際のリビジョンを使う。 |
| リソース上限/範囲外 | より狭いアーティファクト、または適切なワークスペースを選択。 |
| 出力ファイルがある | 以前の証拠を残すため新しい名前を指定。 |

今後の方向は、不確実性を明示した静的解決の改善、再現可能な機能復元例、実行検証できるバージョン限定のプロバイダー統合です。これらはロードマップであり、出荷済みの対応を意味しません。

英語の技術資料：[スキル](../../skills/rea-pro-max/SKILL.md) · [対象範囲](../../skills/rea-pro-max/references/target-analysis.md) · [ケース形式](../../skills/rea-pro-max/references/case-format.md) · [検証契約](../../skills/rea-pro-max/references/verification.md) · [プロンプト](../../skills/rea-pro-max/references/prompt-library.md)。

独立して開発されたプロジェクトです。研究上の着想と依存ライブラリの表記は[クレジット](../../THIRD_PARTY_NOTICES.md)を参照してください。元のREAは必須依存ではありません。[MITライセンス](../../LICENSE)。

**理解する価値のある機能を。自分で確かめられる結果へ。**

## Web復元と任意のCraft接続

v0.4には境界付きのWeb復元カーネルが追加されています。CLI/MCPは新しいChromiumプロファイルでnavigate、click、input、reload、waitの同じシナリオを実行し、DOM、状態、storage、network要約、画面ハッシュを行動判定と視覚判定に分離します。観測やcleanupが不足すると結果は`unknown`のままです。宣言した有限actionだけを検証し、アプリ全体の同値性は主張しません。

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs web replay \
  --reference-url http://127.0.0.1:4173/reference/ \
  --candidate-url http://127.0.0.1:4174/recovered/ \
  --browser "/absolute/path/to/chromium" \
  --scenario ./web-scenario.json --out ./web-replay.json
```

`assets/recovery-web/`はネットワークを使わない所有fixtureです。遅延応答、latest-winsキャンセル、NFKC Unicode、空/エラー状態、localStorage、キーボードfocus、responsive markupをreference、意図的に壊したstarter、独立実装recoveredで確認できます。詳細は[WEB-RECOVERY.md](../WEB-RECOVERY.md)を参照してください。

Craft Anythingは任意のproviderであり必須依存ではありません。Adapterは`js_app_map`、`web_site_capture`、`app_graphs_compare`の型付きaliasだけを呼び、MCP handshake、固定version/commit、tool一覧、パス、時間/バイト制限、cleanupを確認します。commitを提示できないbinaryは拒否されます。Craftを自動インストールせず、コードやbrandingも同梱しません。[PROVIDERS.md](../PROVIDERS.md)をご覧ください。
