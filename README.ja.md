# REA Pro Max

**仕組みを理解する。動作を再構築する。結果を検証する。**

Claude CodeとCodexのための、独立したリバースエンジニアリングスキルと実行可能なツールキット。未知のアプリ、拡張機能、Web機能を、説明できる仕組み、実行できる実装、確認できる有限の動作契約へとつなげます。

[English](README.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md) · [ไทย](README.th.md) · [Français](README.fr.md)

[記録済みラボを体験](https://hieunguyenak92.github.io/rea-pro-max/#explorer) · [スキルを導入](docs/INSTALL.md) · [検証記録](docs/VALIDATION.md) · [リリース](https://github.com/hieunguyenak92/rea-pro-max/releases)

![REA Pro Max — Understand the mechanism](docs/media/hero.png)

## 見た目が整った画面は、まだ出発点です

難しさはクリックの先にあります。どのコンテキストがメッセージを受け取るのか。状態はどこに残るのか。キャンセルは何を止めるのか。どのエラーが呼び出し元に返るのか。なぜ再構築した機能は2回目に失敗するのか。

REA Pro Maxは、こうした問いを実装の工程に組み込みます。配布されたJavaScriptを解析し、競合する仮説を立て、それらを切り分ける実験を選びます。必要な動作を自分のプロジェクトに実装し、出力・状態変化・イベントを比較します。不一致が見つかれば、同じ失敗を再現する小さな操作列へ絞り込みます。

**成果物は、証拠を伴う、依頼された実行可能な機能です。** ホストのエージェントがコーディングとランタイム操作を担当し、付属ツールが解析、実験の順位付け、動作比較、失敗の縮小を実行します。

## いつもの依頼にスキルを添えるだけ

[導入](docs/INSTALL.md)後、Claude Codeで自然な言葉で依頼します。

```text
/rea-pro-max この拡張機能の保存と復元を調査し、私のプロジェクトに実装してください。popup、content script、worker、storageの境界を追跡し、workerの再起動が確認できる条件で永続性を検証してください。エラー動作を保ち、実行可能なコード、実際に確認したケース、未確認事項を納品してください。
```

Codexではスキルを選択するか、同じ依頼の先頭に`$rea-pro-max`を付けます。対象と実装先のプロジェクトを渡せば、エージェントが内部のケースファイルを作成します。実際のブラウザ・アプリ・デバイスを観察するには、ホスト側に対応するツールが必要です。

- **特定の機能を再構築：** 順序、エラー、キャンセル、永続性の境界まで扱います。
- **MV3拡張機能を理解：** popup・content・page・workerを区別して調べます。
- **Electronの境界を復元：** 展開済みmain・preload・rendererソースを解析します。
- **ビルド間のリグレッションを説明：** 比較可能な入力と観測可能な作用を照合します。
- **再現可能な失敗を縮小：** 失敗の種類を維持しながら操作列を短くします。

## 約束を信じる前に、仕組みを動かしてください

**Node.js 22以降**が必要です。付属ツールの実行にAPIキー、`npm install`、元のREAサーバーは不要です。

```sh
git clone https://github.com/hieunguyenak92/rea-pro-max.git rea-pro-max
cd rea-pro-max
node skills/rea-pro-max/scripts/rea-pro-max.mjs demo --out ./rpm-lab
```

ブラウザで`rpm-lab/report.html`を開きます。この自作の合成ラボでは、**Chrome APIを模擬した制御下のJavaScriptモデル**で参照workerと回帰workerを実行します。解析・実験の順位付け・不一致検出・操作列縮小は実際のカーネル出力です。実際のChromium workerの停止を証明するものではありません。別途実行したランタイム検証は[検証記録](docs/VALIDATION.md)に記載します。

同梱アーティファクトを直接解析できます。

```sh
node skills/rea-pro-max/scripts/rea-pro-max.mjs inspect ./rpm-lab/fixtures/mv3/reference --out inspection.json
node skills/rea-pro-max/scripts/rea-pro-max.mjs report inspection.json --out inspection.html
node skills/rea-pro-max/scripts/rea-pro-max.mjs prompts --target mv3
```

新しい出力先を指定してください。既存の結果は暗黙に上書きされません。設定と追加コマンドは英語の[導入・CLIガイド](docs/INSTALL.md)を参照してください。

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

**v0.1の内蔵解析：** JavaScriptファイル、および展開済みWeb・Manifest V3・Electronソース。動的な式、未対応構文、欠落import、リソース制限は結果に明示されます。

**プロバイダー非依存カーネル：** ケース管理、実験順位付け、有限の動作比較、列の縮小、ローカルレポート。`shrink`は指定した自作の`.mjs`オラクルを明示的に実行します。

**ホストツールを使う高度なワークフロー：** native・managed・Android・Apple・React Native・Flutter・Tauri・WebAssembly向けプロンプトもあります。深い解析には利用可能な適切なツールが必要です。汎用デコンパイラー、モバイルランタイム、万能なパッケージ展開器、意味復元エンジンは内蔵していません。形式検出やテンプレートだけでは、動作する統合とは呼べません。

CLIはネットワーク要求やテレメトリー送信を行いません。AIホストと外部ツールには各サービスのデータポリシーが適用されます。レポートに機密のパス・コード・観測値が含まれる可能性があります。共有前に英語の[プライバシーと実行境界](docs/PRIVACY.md)を確認してください。

## 手元に残る成果物

再構築の納品には、動作するソースと起動方法、選択した動作契約、実際に試した操作、JSON証拠、残る制限を含めます。有限の`pass`は確認したケースに対する結果であり、アプリ全体の等価性を意味しません。

ラボは`inspection.json`、`case.json`、`planner.json`、`reference.json`、`candidate.json`、`verification.json`、`reduction.json`、`lab.json`、独立した`report.html`を出力します。記録を個別に確認し、プロジェクトと保管し、ワークベンチから全JSONを出力できます。

英語の技術資料：[スキル](skills/rea-pro-max/SKILL.md) · [対象範囲](skills/rea-pro-max/references/target-analysis.md) · [ケース形式](skills/rea-pro-max/references/case-format.md) · [検証契約](skills/rea-pro-max/references/verification.md) · [プロンプト](skills/rea-pro-max/references/prompt-library.md)。

独立して開発されたプロジェクトです。研究上の着想と依存ライブラリの表記は[クレジット](THIRD_PARTY_NOTICES.md)を参照してください。元のREAは必須依存ではありません。[MITライセンス](LICENSE)。

**理解する価値のある機能を。自分で確かめられる結果へ。**
