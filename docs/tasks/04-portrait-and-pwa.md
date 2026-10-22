# 04. 縦画面と PWA

## なぜやるか

**縦画面のスマートフォンで遊べる形になっていない。**
いまは `layout.css` の `@media (max-width: 1000px)` で 3 列を縦に積むだけで、
ページ全体がスクロールする。採取ボタンは一番上、設備は下、侵略ビューはさらに下にあり、
3 分のランの最中に画面を送り続けることになる。クリッカーは片手縦持ちが自然で、
横画面を強いる時点で初回体験で落とされる。

もう 1 つ、**ホーム画面に置けない・オフラインで開けない。**
PWA にすると「アプリとして起動する」導線ができ、通信が無くても遊べる（セーブは端末内なので相性がよい）。

## ゴール

1. 縦画面（幅 700px 以下・縦長）で、**ページをスクロールせずに**採取・購入・侵略の確認ができる
2. PC・横画面モバイル・タブレットの描画は 1px も変わらない（`mobile.css` と同じ原則）
3. `manifest.webmanifest` と service worker があり、ホーム画面に追加でき、2 回目以降はオフラインで開ける
4. 依存パッケージを増やさない（service worker は自前で書く）

## 現状のコード

| 場所                                                                             | 何があるか                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [src/ui/styles/layout.css](../../src/ui/styles/layout.css)                       | `.app` の名前付きグリッド。`@media (max-width: 1000px)` で 1 列に積む（**ここは触らない**） |
| [src/ui/styles/mobile.css](../../src/ui/styles/mobile.css)                       | 横画面の調整。**全体が 1 つのメディアクエリの中**。縦画面用も同じ作りにする                 |
| [src/main.tsx](../../src/main.tsx)                                               | CSS の import 順。`mobile.css` の後に `portrait.css` を足す                                 |
| [src/ui/components/ProducePanel.tsx](../../src/ui/components/ProducePanel.tsx)   | `.click-area`（採取ボタン）→ `.panel`（資源）→ `.panel.scroll`（設備）の順                  |
| [src/ui/components/InvasionPanel.tsx](../../src/ui/components/InvasionPanel.tsx) | `.panel.is-primary`（標的・`.viewer`・点）→ `LogPanel`（`.panel.scroll` の `.log`）         |
| [src/ui/components/StockPanel.tsx](../../src/ui/components/StockPanel.tsx)       | `.panel`（保有変異）→ `.panel.scroll`（在庫）                                               |
| [src/ui/components/LabScreen.tsx](../../src/ui/components/LabScreen.tsx)         | `.lab` → `.tree-heads` と `.tree`（列数は `maxCol + 1` = 10）                               |
| [index.html](../../index.html)                                                   | `viewport-fit=cover` 済み。manifest とアイコンのリンクを足す                                |
| [tools/make-favicon.ts](../../tools/make-favicon.ts)                             | `base.png` の頭部を切り出して 64px の PNG にする。アイコン生成に流用する                    |
| [vite.config.ts](../../vite.config.ts)                                           | service worker を書き出すプラグインをここに足す                                             |
| [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml)               | `dist/` をそのまま Pages に上げる。変更不要                                                 |

## 実装 A: 縦画面

### 方針

コンポーネントの階層は変えない。**CSS だけ**で組み替える。

縦画面の高さ（iPhone 14 で 844px、Android の小さい端末で 740px 前後）をこう配る。

```
 ┌──────────────────────┐
 │ HUD（深度・タイマー）    │  auto（1 行に詰める）
 ├──────────────────────┤
 │ 侵略（標的バー + 点）    │  auto（ビュワーは 72px に縮める）
 ├──────────────────────┤
 │ 資源                   │
 │ 設備（スクロール）       │  1fr（ここだけスクロール）
 │ 保有変異 / 在庫          │
 ├──────────────────────┤
 │ 採取ボタン（固定・親指）  │  72px（画面下に固定）
 └──────────────────────┘
```

- 採取ボタンは `position: fixed` で画面下に貼る。親指の届く位置で、スクロールに関係なく押せる
- 侵略ビューは上に固定して常に見える。ログ（観測記録）は縦画面では**畳む**（見出しだけ残して高さ 0）。
  3 分のランで読み返す余裕は無く、深度突破と新種はビュワーとトーストで分かる
- 中段だけスクロールさせる。`.area-produce` と `.area-stock` を 1 つのスクロール領域に見せたいが、
  グリッドの別エリアなので別々にスクロールさせず、**`.app` 自体をスクロールさせる**。
  HUD と侵略は `position: sticky; top: 0` で上に留める

### `src/ui/styles/portrait.css`

新しいファイル。**全体を 1 つのメディアクエリで囲む。**

```css
/*
 * モバイル（縦画面）向けの調整。mobile.css と同じく、全体が 1 つのメディアクエリの中にある。
 * 条件は「幅 700px 以下」かつ「縦長」。横画面は mobile.css、それ以外は layout.css が受ける。
 */
@media (max-width: 700px) and (orientation: portrait) {
  :root {
    --fs-xs: 11px;
    --fs-sm: 13px;
    --fs-md: 15px;
    --fs-lg: 18px;
    --fs-xl: 24px;
    --sp-3: 8px;
    --sp-4: 10px;
    --sp-5: 12px;
    --sprite-size: 18px;
    /* 採取ボタンの帯の高さ。下の余白と sticky の計算で使う */
    --collect-h: 72px;
  }

  /* 連打しても拡大や選択が起きないようにする（mobile.css と同じ理由） */
  body {
    overscroll-behavior: none;
    -webkit-text-size-adjust: 100%;
  }
  .app,
  .lab {
    user-select: none;
    -webkit-user-select: none;
  }
  button {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  /* --- 実験画面 --- */

  .app {
    height: 100dvh;
    overflow-y: auto;
    grid-template-columns: 1fr;
    grid-template-areas:
      'hud'
      'invasion'
      'produce'
      'stock';
    gap: var(--sp-2);
    padding: var(--sp-2) max(var(--sp-2), env(safe-area-inset-right))
      calc(var(--collect-h) + var(--sp-2) + env(safe-area-inset-bottom))
      max(var(--sp-2), env(safe-area-inset-left));
  }

  /* HUD と侵略は上に留める。侵略は HUD の下に重ねるので top を HUD の高さぶんずらす */
  .area-hud {
    position: sticky;
    top: 0;
    z-index: 3;
  }
  .area-invasion {
    position: sticky;
    top: 44px; /* HUD の実測高さ。ずれたら --hud-h を作って揃える */
    z-index: 2;
  }
  .hud {
    padding: var(--sp-1) var(--sp-2);
    gap: var(--sp-2);
  }
  .hud-timer {
    font-size: var(--fs-lg);
  }

  /* 侵略ビューは背景を持たせて、下を流れる中段を透かさない */
  .area-invasion .panel.is-primary {
    background: var(--c-panel);
  }
  .viewer {
    height: 72px;
  }
  /* ログは畳む。見出しだけ残す */
  .area-invasion .panel.scroll {
    display: none;
  }
  /* 培養フェーズの円タイマーは小さく（components.css では 168px 固定） */
  .ct {
    width: 84px;
    height: 84px;
  }

  /* 採取ボタンを画面下の帯にする */
  .click-area {
    position: fixed;
    left: max(var(--sp-2), env(safe-area-inset-left));
    right: max(var(--sp-2), env(safe-area-inset-right));
    bottom: max(var(--sp-2), env(safe-area-inset-bottom));
    height: var(--collect-h);
    z-index: 4;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--sp-3);
    padding: 0 var(--sp-3);
  }
  .click-area .sprite {
    --sprite-size: 32px;
  }
  .click-label {
    font-size: var(--fs-md);
  }
  .click-hint,
  .click-crit {
    font-size: var(--fs-xs);
  }

  /* 中段のパネルは高さを固定しない。ページ全体でスクロールする */
  .col > .panel.scroll {
    max-height: none;
    overflow: visible;
  }

  /* --- ドラフト --- */
  .overlay {
    padding: var(--sp-3);
    align-items: flex-start;
  }
  .modal {
    max-height: calc(100dvh - 2 * var(--sp-3));
    overflow-y: auto;
  }
  /* .cards は components.css の 700px 以下で既に 1 列 */

  /* --- 研究所（スキルツリー） --- */
  /* 10 列のツリーは縦画面に収まらない。横にスクロールさせる */
  .lab {
    padding: var(--sp-3) var(--sp-2);
  }
  .lab-head {
    gap: var(--sp-3);
  }
  .tree-heads,
  .tree {
    min-width: 900px;
  }
  .lab {
    overflow-x: auto;
  }

  /* --- タイトル・図鑑 --- */
  .dialog {
    max-width: none;
  }
}
```

**注意**:

- `.col > .panel.scroll` は `components.css` で `max-height: 52vh` が当たっている（1 列に落ちたときの上限）。
  上の `max-height: none` はこれを外すためのもの
- `.area-invasion` の `top: 44px` は HUD の実測値。DevTools で測って合わせる。
  1 行に収まらず HUD が 2 段になるなら、`.hud` の子を縮めて 1 行に収める（`.hud-phase` を `display: none` にするなど）
- 採取ボタンの「飛んでいく数値」（`.pop`）は `.click-area` の中に生えるので固定化しても動く
- `.copyright`（固定・左下）は採取ボタンの帯に隠れる。縦画面では `display: none` にしてよい
- `mobile.css` の条件（`max-height: 620px and orientation: landscape`）とは排他なので、両方が当たることは無い

### 確認の手順

Chrome DevTools のデバイスモードで以下を見る。

| 端末            | 幅×高さ  | 見るところ                                                              |
| --------------- | -------- | ----------------------------------------------------------------------- |
| iPhone 14       | 390×844  | 採取・設備・侵略が同時に見え、設備が 3 行以上見える                     |
| iPhone SE       | 375×667  | 高さが足りない端末。侵略ビューを縮めても設備が 2 行は見える             |
| Pixel 7         | 412×915  | ドラフトのカードが 3 枚とも収まる（収まらなければモーダル内スクロール） |
| iPad (portrait) | 768×1024 | 700px を超えるので**従来どおり**（`layout.css` の 1 列）                |

「メディアクエリの外の描画が変わらない」ことは、PC（1280×800）と横画面（844×390）でスクリーンショットを取って前後比較する。

## 実装 B: PWA

### 1. アイコン

`tools/make-favicon.ts` を引数で一般化する。いまは `SIZE = 64` と `OUT` が定数。

```
node tools/make-favicon.ts                       # いまと同じ: public/favicon.png 64px
node tools/make-favicon.ts 192 public/icons/icon-192.png
node tools/make-favicon.ts 512 public/icons/icon-512.png
node tools/make-favicon.ts 512 public/icons/icon-512-maskable.png --pad
```

- `process.argv[2]` を `SIZE`、`[3]` を `OUT` にし、省略時はいまの値
- `--pad` があれば **背景を `#04080a`（`--c-bg`）で塗り、頭部を中央 80% に収める**。
  maskable アイコンは外周 10% が切り落とされる前提なので、透明背景のままだと角が欠ける
- 拡大は整数倍のまま（ドット絵の格子を崩さない）。512px で `scale` が大きくなるだけで問題ない

生成した 4 枚を `public/icons/` に置いてコミットする。

### 2. `public/manifest.webmanifest`

```json
{
  "name": "サメ培養プロジェクト",
  "short_name": "サメ培養",
  "description": "深海の秘密研究施設でサメを培養し、突然変異させて地上の都市にぶつける",
  "lang": "ja",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#04080a",
  "theme_color": "#04080a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`orientation` は `any`。縦画面対応が入るので固定しない。

### 3. `index.html`

`<link rel="icon">` の隣に足す。

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
<meta name="theme-color" content="#04080a" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

### 4. service worker — ビルド時に生成する

`public/sw.js` を手で書くと、ビルドで名前が変わる `assets/index-xxxx.js` を事前キャッシュに入れられない。
**Vite のプラグインで、ビルド成果物の一覧を埋め込んだ `sw.js` を `dist/` に書き出す。** 依存は要らない。

`vite.config.ts`:

```ts
import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

/**
 * service worker をビルド時に生成する。
 * 成果物の一覧を事前キャッシュに埋め、その一覧のハッシュをキャッシュ名にする。
 * 一覧が変わる = 何かが変わったデプロイなので、古いキャッシュが自動で捨てられる。
 */
function serviceWorker(): Plugin {
  return {
    name: 'shark-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).map((f) => '/' + f)
      const files = ['/', '/index.html', '/manifest.webmanifest', '/favicon.png', ...assets]
      const version = createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 12)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: SW_SOURCE.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files)),
      })
    },
  }
}
```

`SW_SOURCE` は同じファイル内の文字列でよいが、長くなるので `tools/sw.template.js` に置いて
`readFileSync` で読む方が見通しがよい（`tools/` はビルドに乗らない置き場）。

`tools/sw.template.js`:

```js
/* eslint-disable no-restricted-globals */
const VERSION = '__VERSION__'
const CACHE = `shark-${VERSION}`
const FILES = __FILES__

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return

  // 画面の読み込みはネットワーク優先。落ちたらキャッシュの index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')))
    return
  }

  // Google Fonts はキャッシュ優先で溜める（CSS は UA で変わるので、同じ UA なら同じ応答）
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
            return res
          }),
      ),
    )
    return
  }

  // 同一オリジンの成果物はキャッシュ優先（名前にハッシュが入るので古くならない）
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)))
  }
})
```

- `skipWaiting` + `clients.claim` で、新しいデプロイは**次に開いたとき**に切り替わる。
  ラン中の画面を強制リロードはしない（ランは保存されないので）
- 差し替え用スプライト（`/sprites/*.png`）は `public/` にあるので `bundle` に入らず、事前キャッシュに入らない。
  ただし同一オリジンの fetch はキャッシュ優先で溜まるので、1 度表示すれば 2 回目からはオフラインで出る。
  確実に入れたければ `files` に `/sprites/base.png` を足す
- フォントの opaque response は `cache.put` できる。サイズは数百 KB で問題ない

### 5. 登録 — `src/main.tsx`

```ts
// 本番だけ。開発サーバーで登録すると HMR の更新がキャッシュに阻まれる
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 登録できなくてもゲームは動く */
    })
  })
}
```

### 6. 確認の手順

1. `npm run build && npm run preview` で `http://localhost:4173` を開く（preview は本番ビルドを配る）
2. DevTools → Application → Service Workers に `sw.js` が activated で出る
3. Application → Cache Storage に `shark-xxxxxxxxxxxx` があり、`/`・`/assets/index-*.js`・`/manifest.webmanifest` が入っている
4. Network を Offline にしてリロード → タイトルが出て、ゲームが始められる
5. Lighthouse の PWA 項目で「Installable」になる
6. `src/text/ja.ts` の文言を 1 文字変えて再ビルド → preview をリロード 2 回 → 変更が反映され、Cache Storage の古い名前が消えている
7. Android Chrome の実機（または DevTools のデバイスモード）で「ホーム画面に追加」が出る

## 受け入れ条件

- [ ] 縦画面（390×844）で、ページをスクロールしなくても採取ボタン・設備 3 行・標的バー・タイマーが見える
- [ ] 採取ボタンが画面下に固定され、中段をスクロールしても位置が変わらない
- [ ] ドラフトのモーダルが 3 枚とも画面内に収まるか、モーダル内でスクロールできる
- [ ] 研究所のスキルツリーが横スクロールで全列見られる
- [ ] PC（1280×800）と横画面（844×390）のスクリーンショットが変更前後で一致する
- [ ] `public/icons/` に 4 枚のアイコンがあり、`tools/make-favicon.ts` で再生成できる
- [ ] `npm run build` で `dist/sw.js` が生成され、事前キャッシュの一覧に `assets/` の JS と CSS が入っている
- [ ] preview でオフラインにしてもタイトルが開く
- [ ] 開発サーバー（`npm run dev`）では service worker が登録されない
- [ ] `npm run typecheck` `npm run build` `npm run format:check` が通る

## ドキュメント

- README「デプロイ」に「PWA」の小節を足す: `sw.js` はビルド時に `vite.config.ts` のプラグインが生成する、
  キャッシュ名は成果物一覧のハッシュ、`tools/sw.template.js` が本体
- README「ファビコン」の節に、アイコン 4 枚の生成コマンドを足す
- SPEC §5「モバイル（横画面）」の隣に「モバイル（縦画面）」の節を足し、上の配分図と
  「採取ボタンを下に固定し、HUD と侵略を上に留め、中段だけ流す」方針を書く
- SPEC §8「まだ無いもの」から「縦画面の作り込み」を消す。TASKS.md §1.9 の縦画面の項を `[x]` にする

## やらないこと

- フォントの self-host。service worker が Google Fonts の応答を溜めるので、オフラインの目的は満たせる。
  初回描画の揺れ（FOUT）は残るが、別タスクにする
- プッシュ通知・バックグラウンド同期。オフライン進行を持たない方針と合わない
- 「更新があります」のトースト。次に開いたときに切り替わればよい
