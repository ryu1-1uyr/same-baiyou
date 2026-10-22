# 実装タスク（2026-09-16 レビューより）

プロダクトレビューで挙がった指摘のうち、着手が決まった 4 件の実装仕様。
**それぞれのファイル単体で、初見の実装者が最後まで走れる**ことを目標に書いてある。

| #   | タスク                                                                      | 規模 | 依存                     |
| --- | --------------------------------------------------------------------------- | ---- | ------------------------ |
| 01  | [セーブの書き出し・読み込みと、倍速の持ち越し](01-save-export-and-speed.md) | 小   | なし                     |
| 02  | [OGP と戦績カード](02-ogp-and-result-card.md)                               | 中   | なし                     |
| 03  | [vitest とシミュレータのゴールデン値](03-vitest-and-golden.md)              | 中   | なし（依存追加: vitest） |
| 04  | [縦画面と PWA](04-portrait-and-pwa.md)                                      | 中   | 02 の og:image は不要    |

4 件は互いに独立しており、どの順で着手してもよい。
1 件 1 ブランチ・1 PR にする。

## 全タスク共通のルール

リポジトリの規約。破ると CI か レビューで止まる。

- **画面に出る文字は [src/text/ja.ts](../../src/text/ja.ts) に置く。** TSX に日本語を直書きしない。
  数値を含む文は `{n}` の差し込みにして `fill()` で埋める（例は同ファイル内に多数ある）。
  例外は開発用パネル（`DebugPanel` / `SpriteLab`）で、ここだけは直書きしてよい
- **色・余白・フォントは TSX に書かない。** `src/ui/styles/tokens.css` の CSS 変数を参照する。
  canvas に描く場合は `getComputedStyle(document.documentElement).getPropertyValue('--c-xxx')` で変数から取る
- **`src/game/` は React にも DOM にも依存させない。** `window` / `document` / `localStorage` を触るコードは
  `src/store/` `src/meta/` `src/ui/` のいずれかに置く
- **整形は Prettier。** `npm run format` を通してからコミットする。CI は `format:check` で止まる。
  Markdown も対象になる
- **検証は `npm run typecheck` → `npm run build`。** 03 を入れたあとは `npm test` も通す
- **新しい依存パッケージは追加しない。** 03 の vitest だけは例外で、事前に了承済み
- **Git**: `main` へ直接 push しない。ブランチを切って PR にする。
  コミットメッセージは「なぜ」が分かるように書く。PR 本文にフッタや `Co-Authored-By` は付けない
- 変更したら README / SPEC の該当箇所を追従させる（各タスクに「ドキュメント」の節がある）
- コメントは「なぜそうしたか」だけ書く。何をしているかの説明は書かない

## 動作確認の環境

```bash
npm install
npm run dev        # http://localhost:5173
```

開発用パネル（画面左下の `DEV`）で全解禁・予算付与・培養フェーズのスキップ・ラン終了ができる。
本番ビルドでは消える。
