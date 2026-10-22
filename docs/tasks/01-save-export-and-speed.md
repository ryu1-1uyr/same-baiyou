# 01. セーブの書き出し・読み込みと、倍速の持ち越し

## なぜやるか

**セーブが localStorage 1 本しかなく、外に出す手段が無い。**
ブラウザのデータ消去・プライベートウィンドウ・機種変更で、積み上げた研究予算と解禁がすべて消える。
周回で数十ランを積むゲームなので、この損失はプレイヤーが遊びを止める十分な理由になる。
サーバーを持たない方針は変えずに、**文字列 1 本で持ち出せる**ようにする。

もう 1 つ、**倍速がラン毎に ×1 に戻る**（[src/store/gameStore.ts](../../src/store/gameStore.ts) の `startNewRun` で `speed = 1`）。
倍速は恒久強化で買うものなのに、毎ラン押し直しになっている。前回の値を持ち越す。

## ゴール

1. タイトルの「オプション」から、セーブデータを文字列として**書き出し**（クリップボードとファイル）・**読み込み**できる
2. 壊れた文字列・別バージョンの文字列を読み込んでも、既存のセーブは壊れない
3. 倍速の選択が次のランに引き継がれる。ただし解禁していない倍速には落ちない

ラン中の状態（在庫・深度など）は対象外。「ラン中の状態は保存しない。リロードでランが消えるのは仕様」（SPEC §7）は変えない。

## 現状のコード

| 場所                                                                         | 何があるか                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [src/meta/save.ts](../../src/meta/save.ts)                                   | `loadMeta` / `saveMeta` / `resetMeta`。キーは `inkurimentaru.meta.v1`                                         |
| [src/game/meta.ts](../../src/game/meta.ts) の `MetaState`                    | 保存される型。`budget` `lifetimeBudget` `runs` `bestDepth` `levels` `unlocked` `discovered` `claimed` `hints` |
| [src/store/gameStore.ts](../../src/store/gameStore.ts)                       | `let meta: MetaState = loadMeta()` をモジュール変数で持つ。`wipeMeta()` が置き換えの例                        |
| [src/ui/components/TitleScreen.tsx](../../src/ui/components/TitleScreen.tsx) | `dialog === 'options'` の分岐に `AudioControls` が置いてある。ここに足す                                      |
| [src/ui/components/Dialog.tsx](../../src/ui/components/Dialog.tsx)           | 汎用モーダル。背景クリック・Esc で閉じる                                                                      |
| [src/text/ja.ts](../../src/text/ja.ts) の `title` `audio`                    | 文言の置き場                                                                                                  |
| `src/ui/styles/components.css` の `.title-options`（1861 行付近）            | オプションダイアログの見た目                                                                                  |

`loadMeta` は欠けたフィールドを既定値で埋め、JSON の破損は `createMeta()` に落とす。
**この寛容な読み込みを、読み込み機能でもそのまま使う。**

## 実装

### 1. `src/meta/save.ts` — 文字列との相互変換

`loadMeta` の中にある「文字列 → `MetaState`」の部分を `parseMeta` として切り出し、`loadMeta` と読み込み機能で共用する。

```ts
/** JSON 文字列を MetaState に起こす。欠けたフィールドは既定値で埋め、壊れていれば null */
export function parseMeta(raw: string): MetaState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MetaState>
    if (!parsed || typeof parsed !== 'object') return null
    const base = createMeta()
    return {
      budget: Number(parsed.budget) || 0,
      // …以下、いまの loadMeta と同じ
    }
  } catch {
    return null
  }
}

export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return createMeta()
    return parseMeta(raw) ?? createMeta()
  } catch {
    return createMeta()
  }
}
```

書き出しは **接頭辞 + base64(JSON)** にする。接頭辞は形式の版を表し、読み込みで照合する。
base64 にするのは、コピー時に空白や改行が混ざっても `trim()` で戻せることと、JSON を直接いじりにくくすること（改ざん防止ではなく、事故防止）。

```ts
const SAVE_PREFIX = 'shark1:'

/** UTF-8 を安全に base64 にする。btoa は Latin-1 しか受けないので一度バイト列にする */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(b64: string): string {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function exportMeta(m: MetaState): string {
  return SAVE_PREFIX + toBase64(JSON.stringify(m))
}

/** 書き出した文字列を MetaState に戻す。形式が違う・壊れているときは null */
export function importMeta(text: string): MetaState | null {
  const s = text.trim()
  if (!s.startsWith(SAVE_PREFIX)) return null
  try {
    return parseMeta(fromBase64(s.slice(SAVE_PREFIX.length)))
  } catch {
    return null
  }
}
```

`atob` は不正な文字で例外を投げるので try で包む。
`Uint8Array.prototype.toBase64` は 2026 年時点でまだ全ブラウザに無いので使わない。

### 2. `src/store/gameStore.ts` — メタの差し替え

`wipeMeta` と同じ位置に足す。**タイトル画面でしか呼ばれない前提**なので、進行中のランは考えなくてよい
（`startNewRun` が `meta` から `cfg` と `state` を作り直す）。

```ts
/** 読み込んだセーブでメタを置き換える。タイトル画面からのみ呼ぶ */
export function replaceMeta(m: MetaState): void {
  meta = m
  saveMeta(meta)
  emit()
}
```

### 3. `src/ui/components/TitleScreen.tsx` — オプションに「セーブデータ」の節

`AudioControls` の下に、別コンポーネント `SaveControls`（同じファイル内でよい）を置く。

```
セーブデータ
  [ コピー ]  [ ファイルに保存 ]          ← 書き出し
  ┌──────────────────────────────┐
  │ （textarea: 貼り付け欄）       │
  └──────────────────────────────┘
  [ 読み込む ]  [ ファイルから読み込む ]   ← 読み込み
  （状態メッセージ: コピーした / 読み込んだ / 形式が違う）
```

- **コピー**: `navigator.clipboard.writeText(exportMeta(getMeta()))`。失敗したら（HTTP や権限で拒否されることがある）
  textarea に文字列を入れて `select()` し、「手動でコピー」の文言を出す
- **ファイルに保存**: `new Blob([text], { type: 'text/plain' })` → `URL.createObjectURL` → `<a download="shark-save-YYYYMMDD.txt">` を作って `click()`。
  作った URL は `URL.revokeObjectURL` で捨てる
- **読み込む**: textarea の内容を `importMeta` に通す。`null` なら文言 `save.invalid` を出して**何もしない**。
  通ったら `window.confirm(t.save.confirm)` で確認し、`replaceMeta` を呼ぶ。確認ダイアログを自前で作る必要はない
- **ファイルから読み込む**: `<input type="file" accept=".txt,text/plain">` を `display: none` で置き、ボタンから `click()`。
  `file.text()` で読んで textarea に入れ、同じ「読み込む」の経路に流す
- 状態メッセージは `useState<string | null>` で持ち、3 秒で消す必要はない（次の操作で上書きすればよい）

読み込みが成功したら図鑑バッジ（`unclaimedCount(getMeta())`）も新しいメタで再計算される。
`TitleScreen` は `useGame()` を呼んでいないので、`replaceMeta` の `emit()` で再描画されない可能性がある。
`SaveControls` の中で `useGame()` を 1 回呼ぶか、`TitleScreen` の先頭で呼んで購読させる。

### 4. `src/text/ja.ts` — 文言

`title` の隣に `save` を足す。

```ts
save: {
  title: 'セーブデータ',
  copy: 'コピー',
  download: 'ファイルに保存',
  paste: 'ここに貼り付け',
  load: '読み込む',
  loadFile: 'ファイルから読み込む',
  copied: 'コピーした。メモ帳などに貼って保管する',
  copyFailed: 'コピーできなかった。下の欄を全選択して手動でコピーする',
  loaded: '読み込んだ。研究所で内容を確認できる',
  invalid: '形式が違うか、壊れている',
  confirm: 'いまのセーブデータを上書きする。元には戻せない。続けるか？',
},
```

### 5. CSS — `.title-options` の隣に

`src/ui/styles/components.css` の `.title-options` の直後に足す。色はトークンから。

```css
.save-box {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.save-row {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.save-text {
  width: 100%;
  min-height: 4.5em;
  resize: vertical;
  font-family: var(--font-num);
  font-size: var(--fs-xs);
  color: var(--c-text);
  background: var(--c-bg-deep);
  border: 1px solid var(--c-line);
  border-radius: var(--r-1);
  padding: var(--sp-2);
}
.save-status {
  font-size: var(--fs-xs);
  color: var(--c-text-dim);
}
.save-status[data-error='true'] {
  color: var(--c-danger);
}
```

ボタンは既存の `.btn` を使う。

### 6. 倍速の持ち越し

`src/meta/save.ts` に小さな読み書きを足す（`localStorage` を触るのはこの層の役目）。

```ts
const SPEED_KEY = 'inkurimentaru.speed.v1'

export function loadSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY))
    return v === 2 || v === 4 ? v : 1
  } catch {
    return 1
  }
}

export function saveSpeed(v: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(v))
  } catch {
    /* 保存できなくても続行 */
  }
}
```

`gameStore.ts` 側:

- `setSpeed` の末尾で `saveSpeed(s)`
- `startNewRun` の `speed = 1` を、解禁済みの上限に丸めた保存値にする

```ts
speed = Math.min(loadSpeed(), eff.maxSpeed) as Speed
```

`maxSpeed` は `1 | 2 | 4` で、`loadSpeed` も `1 | 2 | 4` しか返さないので `Math.min` の結果は必ずその 3 値のいずれかになる。

## 受け入れ条件

- [ ] タイトル → オプションに「セーブデータ」の節があり、コピー・ファイル保存・貼り付け読み込み・ファイル読み込みが動く
- [ ] 開発用パネルで予算を付与 → 研究所で数個買う → 書き出し → 開発用パネルで「セーブデータを削除」→ 読み込み、で予算・レベル・解禁・図鑑（`discovered` / `claimed`）が戻る
- [ ] `hello` や `shark1:xxxx` のような壊れた文字列を読み込んでも `save.invalid` が出るだけで、既存のセーブが変わらない
- [ ] 読み込み前に `window.confirm` が出て、キャンセルすると何も変わらない
- [ ] 倍速 ×2 を解禁して ×2 にし、ランを終えて次のランを始めると ×2 のまま
- [ ] 倍速 ×4 で保存されたセーブを、×4 未解禁のメタで開始しても ×2（または ×1）に落ちる
- [ ] `npm run typecheck` `npm run build` `npm run format:check` が通る

## ドキュメント

- README の「## 表示テキスト」の前に「## セーブデータ」の節を足し、形式（`shark1:` + base64 の JSON）と、保存されるのがメタ進行だけであることを書く
- SPEC §7「セーブ」に「書き出し・読み込みはタイトルのオプションから。形式は `shark1:` + base64」を 1 行足す

## やらないこと

- ラン中の状態の保存・復元
- 改ざん検知（チェックサム）。個人の遊びを守る機能なので不要
- 音量設定（`inkurimentaru.audio.v1`）の同梱。端末ごとの好みなので持ち出さない
