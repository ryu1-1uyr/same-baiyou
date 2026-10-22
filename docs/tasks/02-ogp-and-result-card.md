# 02. OGP と戦績カード

## なぜやるか

このゲームの外向きの燃料は、自動生成される複合サメの名前（「ゾンビ深圧アビスタコサンダーフライングメテオサメ」）と、
「深度計が成層圏を指す」という絵面にある。ところが**共有する導線が 1 本も無い**。

- [index.html](../../index.html) に OGP も `description` も無く、リンクを X や Discord に貼ると黒いカードになる
- リザルト画面に共有ボタンが無く、スクリーンショットを撮るしかない

TASKS.md §5.5「戦績カードの書き出し」を、OGP 画像の生成と 1 つの描画器で兼ねる。
**リザルトを canvas 1 枚に描く関数を作り、それをプレイヤーの保存・共有と、`public/ogp.png` の生成の両方に使う。**

## ゴール

1. リザルト画面に「画像を保存」「共有」の 2 ボタンがある
2. 画像は 1200×630（OGP と同じ比率）の PNG で、到達深度・総戦果・最高戦力サメ（絵と名前）・URL が入る
3. `index.html` に OGP / Twitter Card のメタタグがあり、`public/ogp.png` が存在する
4. `ogp.png` は開発用パネルのボタンから同じ描画器で書き出す（手で描いた画像を置かない）

## 現状のコード

| 場所                                                                             | 何があるか                                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [src/ui/components/ResultOverlay.tsx](../../src/ui/components/ResultOverlay.tsx) | リザルト。`champion`（変異数で選んだ最強個体）と `species`（上位 8 種）をここで計算している。ボタンは「新たな研究所へ」1 つ |
| [src/render/sharkSprite.ts](../../src/render/sharkSprite.ts)                     | `sharkSprite(parts, scale)` が合成済み canvas を返す（同期・キャッシュ済み）。`sharkBounds(parts, scale)` が不透明範囲      |
| [src/ui/components/SharkIcon.tsx](../../src/ui/components/SharkIcon.tsx)         | 上の 2 つを使って DOM に描く例。**canvas に描くときはこの手順をそのまま真似る**                                             |
| [src/game/mutations.ts](../../src/game/mutations.ts)                             | `partsOfMask(slots, mask)` → `SharkPart[]`、`nameOfMask(slots, mask)` → 名前                                                |
| [src/game/targets.ts](../../src/game/targets.ts)                                 | `depthName(depth).zone` → 到達地点の名前                                                                                    |
| [src/ui/format.ts](../../src/ui/format.ts)                                       | `fmt(n)` 桁付き整形、`mmss(sec)`                                                                                            |
| [src/ui/components/DebugPanel.tsx](../../src/ui/components/DebugPanel.tsx)       | 開発用パネル。`import.meta.env.DEV` で本番から消える。ここに OGP 書き出しボタンを足す                                       |
| `src/ui/styles/tokens.css`                                                       | 色と書体。`--c-bg` `--c-panel` `--c-culture` `--c-shark` `--c-score` `--c-legendary` `--font-display` `--font-ui`           |
| [public/CNAME](../../public/CNAME)                                               | `shark.ryu-reu.me`。OGP の絶対 URL に使う                                                                                   |

書体は Google Fonts から読んでいる（`Dela Gothic One` = 見出し、`DotGothic16` = 本文）。
canvas はフォントの読み込みを待たないので、描く前に `document.fonts.load()` で待つ必要がある。

## 実装

### 1. `src/render/resultCard.ts` — 描画器

React に依存しない純粋な描画関数。入力は表示に必要な値だけにし、`GameState` を直接受けない
（OGP 用の固定データでも呼べるようにするため）。

```ts
import type { SharkPart } from '../game/mutations.ts'

export type ResultCardData = {
  /** 到達地点の名前（depthName(depth).zone） */
  zone: string
  clearedDepth: number
  /** 整形済みの文字列を渡す（fmt は ui 層のものなので、ここでは整形しない） */
  score: string
  elapsed: string
  produced: string
  champion: { parts: readonly SharkPart[]; name: string; traits: number; power: string } | null
  /** 上位 3 種。名前と頭数 */
  species: Array<{ parts: readonly SharkPart[]; name: string; count: string }>
  /** 右下に置く URL */
  url: string
  /** OGP 用。true ならタイトルを大きく、数字を小さくする */
  showcase?: boolean
}

export const CARD_W = 1200
export const CARD_H = 630

/** フォントの読み込みを待ってから描く。返る canvas は呼び出し側が toBlob する */
export async function renderResultCard(data: ResultCardData): Promise<HTMLCanvasElement>
```

描く手順:

1. `await Promise.all([document.fonts.load('48px "Dela Gothic One"'), document.fonts.load('24px "DotGothic16"')])`。
   失敗しても例外にせず、フォールバック書体で描く（`catch` で握る）
2. 色は CSS 変数から取る。`const css = getComputedStyle(document.documentElement)`、
   `const color = (name: string) => css.getPropertyValue(name).trim() || '#000'`
3. 背景: `--c-bg` で塗り、上端から `--c-panel` への縦グラデーションを薄く敷く。深海の空気感は
   `layout.css` の `body::before` と同じ発想でよい（`radial-gradient` 1 つで十分）
4. レイアウト（左右 2 段組み）

```
 (60,50)  タイトル「サメ培養プロジェクト」 Dela Gothic One 28px  --c-text-dim
 (60,110) 「深度 {clearedDepth} 突破 — {zone}」 Dela Gothic One 56px  --c-culture
 (60,200) 総戦果 {score}            DotGothic16 28px   ラベルは --c-text-dim、値は --c-score
 (60,245) 検体生産数 {produced}     同上
 (60,290) 経過時間 {elapsed}        同上

 (60,360) 「今回の最高戦力サメ」    DotGothic16 22px  --c-text-dim
 (60,400) {champion.name}           Dela Gothic One 36px  --c-legendary（長い名前は 2 行に折る。1 行 24 文字で切る）
 (60,500) 変異 {traits} 種 / 戦闘力 {power}   DotGothic16 24px

 右半分 (700〜1140, 120〜520): チャンピオンのスプライトを中央に大きく置く
 (700,540〜) 上位 3 種を 1 行ずつ: 小さいスプライト(高さ 28) + 名前 + 頭数

 (1140,590) url を右寄せ  DotGothic16 20px  --c-text-mute
```

5. サメの描き方（`SharkIcon.tsx` と同じ）

```ts
const s = sharkSprite(parts, 1)
const b = sharkBounds(parts, 1)
// 整数倍に丸めて格子を崩さない。高さ 260px に収まる最大の整数倍
const scale = Math.max(1, Math.floor(260 / b.h))
g.imageSmoothingEnabled = false
g.drawImage(s, b.x, b.y, b.w, b.h, x, y, b.w * scale, b.h * scale)
```

横長の複合（ダブル・トリプル）は幅が大きいので、`b.w * scale` が 440px を超えるときは幅を基準に `scale` を取り直す。

6. `champion` が `null`（変異ゼロで終わったラン）のときは、素のサメ（`parts = []`）を描き、名前の欄は空にする

### 2. `src/ui/components/ResultOverlay.tsx` — ボタン 2 つ

既存の `champion` と `species` の計算をそのまま使い、`ResultCardData` に詰める関数を作る。

```ts
function cardData(s: GameState, cfg: Config): ResultCardData
```

`url` は `https://shark.ryu-reu.me`（`t.share.url` として辞書に置く。ドメインは文言扱いでよい）。

ボタンは「新たな研究所へ」の**上**に横並びで置く（主ボタンは一番下に残す）。

- **画像を保存** (`t.share.save`)
  `renderResultCard` → `canvas.toBlob(cb, 'image/png')` → `<a download="shark-result-{clearedDepth}.png">` を `click()`。
  iOS Safari は `download` 属性を無視して新しいタブで開くことがある。それは許容する（共有ボタンが本命）
- **共有** (`t.share.share`)
  1. `renderResultCard` → `toBlob` → `new File([blob], 'shark-result.png', { type: 'image/png' })`
  2. `navigator.canShare?.({ files: [file] })` が真なら `navigator.share({ files: [file], text, url })`
  3. 偽なら X の投稿画面を開く: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
     を `window.open(_, '_blank', 'noopener')`。画像は付かないので、OGP の画像がカードになる
  4. `share` がユーザーのキャンセルで reject するのは正常。`catch` で握って何もしない

共有の文言（`t.share.text`）:

```
{name} を生み出し、深度 {depth} まで到達した #サメ培養プロジェクト
```

`name` は `champion?.name ?? t.share.plain`（「通常サメ」）。

描画中は 2 つのボタンを `disabled` にする（`useState<boolean>` で `busy` を持つ）。
連打で 2 回 `share` が走ると 2 回目が `InvalidStateError` になる。

### 3. `src/text/ja.ts` — 文言

```ts
share: {
  save: '画像を保存',
  share: '共有',
  text: '{name} を生み出し、深度 {depth} まで到達した #サメ培養プロジェクト',
  plain: '通常サメ',
  url: 'https://shark.ryu-reu.me',
  /* OGP のメタタグ用。index.html は辞書を読めないので同じ文を手で写す */
  description: '深海の秘密研究施設でサメを培養し、突然変異させて地上の都市にぶつける。1 ラン 3〜8 分のローグライト × インクリメンタル。',
},
```

`result` の中に足さず `share` として独立させるのは、OGP の説明文も同じ場所に置いて、
「共有される文言」が 1 か所にまとまるようにするため。

### 4. CSS

`components.css` のリザルト周り（`.result-grid` の近く）に足す。

```css
.result-actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: center;
}
.result-actions .btn[disabled] {
  opacity: 0.5;
  cursor: default;
}
```

### 5. OGP 画像の生成 — `DebugPanel.tsx`

「スプライト合成を確認」の隣に「OGP 画像を書き出す」ボタンを足す。押すと固定の見せ球データで
`renderResultCard({ ..., showcase: true })` を呼び、`ogp.png` としてダウンロードする。
**ダウンロードした画像を `public/ogp.png` に置いてコミットする。**

見せ球データの例:

```ts
const parts = ['mecha', 'twinHead', 'ancient'].map((id) => MUTATION_BY_ID.get(id as MutationId)!)
{
  zone: '成層圏',           // depthName(11).zone を使う
  clearedDepth: 11,
  score: '3.2T', produced: '182k', elapsed: '5:30',
  champion: { parts, name: nameOfMutations(parts), traits: 3, power: '2.4M' },
  species: [],              // showcase ではリストを描かない
  url: 'shark.ryu-reu.me',
  showcase: true,
}
```

`showcase: true` のときの差分は「タイトルを 72px で主役にし、深度の行を 40px に落とす」だけにする。
`nameOfMutations` は `src/game/mutations.ts` にある。
開発用パネルの文字は辞書に入れない（規約）。

### 6. `index.html` — メタタグ

`<title>` の直後に足す。`og:image` は**絶対 URL 必須**。

```html
<meta name="description" content="（t.share.description と同じ文）" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="ja_JP" />
<meta property="og:site_name" content="サメ培養プロジェクト" />
<meta property="og:title" content="サメ培養プロジェクト" />
<meta property="og:description" content="（同上）" />
<meta property="og:url" content="https://shark.ryu-reu.me/" />
<meta property="og:image" content="https://shark.ryu-reu.me/ogp.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
```

`public/` 直下のファイルはハッシュ無しでそのまま配信される。X はカード画像をキャッシュするので、
画像を差し替えたら `?v=2` のようにクエリを足すか、X の Card Validator で再取得させる。

## 受け入れ条件

- [ ] リザルトで「画像を保存」を押すと 1200×630 の PNG が落ちてきて、深度・戦果・チャンピオンの絵と名前・URL が読める
- [ ] Chrome（デスクトップ）で「共有」を押すと X の投稿画面が開き、文言と URL が入っている
- [ ] Android Chrome または iOS Safari で「共有」を押すと OS の共有シートが開き、画像が添付されている
- [ ] 変異ゼロで終わったラン（培養フェーズで何もしない）でもエラーにならず、素のサメで描かれる
- [ ] `public/ogp.png` がコミットされており、`npm run build` 後の `dist/ogp.png` として配信される
- [ ] デプロイ後、X または Discord に URL を貼るとカードに画像と説明文が出る
- [ ] `npm run typecheck` `npm run build` `npm run format:check` が通る

## ドキュメント

- README「デプロイ」の表に `public/ogp.png` の行を足す（「OGP 画像。開発用パネルの『OGP 画像を書き出す』で作る」）
- TASKS.md §5.5 を `[x]` にし、「描画器は `src/render/resultCard.ts`。OGP と共用」と 1 行書く
- SPEC §8「v1 の後に足したもの」に「戦績カードと OGP」を足す

## やらないこと

- 派生種の専用グラフィック（準備中の縞のまま描く）
- サーバー側での画像生成。すべてブラウザで完結させる
- 図鑑や好きな組み合わせのサメの登録（TASKS.md §5.1 未決の項目）
