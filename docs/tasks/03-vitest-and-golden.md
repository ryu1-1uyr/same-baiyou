# 03. vitest と、シミュレータのゴールデン値

## なぜやるか

**自動テストが 1 本も無い。** CI は `format:check` と `tsc --noEmit` だけで、ロジックの退行は誰も見ていない。

シミュレータ（`src/sim/`）は強力だが手動実行で、結果を見て人が判断する道具になっている。
SPEC §10 に残っている「連鎖崩壊の暴走」（破壊のたびに倍率が掛かって到達深度が 12 → 28 に飛んだ）は、
`applyDamage` に 1 本テストがあれば実装時に落ちていた。

やることは 2 つ。

1. `src/game/` の**不変条件**をユニットテストで固める（数式ではなく「壊れてはいけない性質」を書く）
2. シミュレータの 60 シードの結果を**ゴールデン値**として CI で見張り、意図しないバランスの変化を検知する

## ゴール

- `npm test` でユニットテストとゴールデンテストが走り、1 秒程度で終わる
- CI（`.github/workflows/deploy.yml`）で `npm test` が `format:check` の次に走る
- バランスを**意図して**変えるときの手順が README に書いてある

## 前提

- **vitest の追加は了承済み**（このタスクの範囲で唯一の依存追加）
- Node 24 なので `node src/sim/run.ts` が直接動く。vitest は Vite の設定を共有して TS をそのまま読む
- `src/game/` は DOM に依存しない。`src/render/` と `src/ui/` は canvas を使うので**テスト対象にしない**
- シミュレータは決定的。同じシードは同じ結果を返す（`src/game/state.ts` の `rng` は mulberry32。
  `Math.random` を使うのは `sim/policy.ts` の `random` 方針と `sim/rarity.ts` だけで、既定の `greedyEV` 方針では使わない）

計測済みの現在値（2026-09-16、`simulate({ seed })` を seed 1〜60 で実行。既定 = 恒久強化なし・`greedyEV`・`balanced`・5 クリック/秒）:

```
突破深度の平均   1.25       分布 { 0: 2, 1: 41, 2: 17 }
総時間の平均     198.96 秒
ドラフト回数     4.95
累計生産         2568.1 体
総戦果の平均     439,887
seed 7           突破 1 / 総戦果 370239.98374655715
60 シードの所要  約 170 ms
```

SPEC §10「確定した初回ランの姿」の値（平均 1.25 / 深度 1 が 41/60 / 3 分 19 秒 / ドラフト 5 回 / 約 2,570 体）と一致している。

## 実装

### 1. vitest の導入

```bash
npm install -D vitest
```

`package.json` の `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

`vite.config.ts` に `test` を足す。ファイル先頭に型参照が要る。

```ts
/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

`tsconfig.json` の `include` は `src` なので、`*.test.ts` も `tsc --noEmit` の対象になる。
**グローバル API（`describe` を import 無しで使う）は有効にしない。** `import { describe, expect, it } from 'vitest'` を毎ファイル書く。
こうすると tsconfig に `types` を足さずに済む。

`erasableSyntaxOnly: true` なので、テストでも enum や namespace は使わない。

### 2. ユニットテスト

テストは対象と同じディレクトリに `xxx.test.ts` で置く。以下は**最低限**で、各項目が 1 つの `it` に対応する。

#### `src/game/state.test.ts`

- `rng`: 同じシードで `createState` した 2 つの状態から 100 回引いた列が一致する
- `rng`: 違うシードでは最初の 10 個が一致しない
- `createState`: `startSharks = 25` のメタ効果で `inv.get(0)` `births.get(0)` `producedTotal` がすべて 25
- `createState`: `earlyDraft` で `nextDraftAt` が 10、無しなら `cfg.mutation.draftThresholdBase`（50）

`MetaEffects` を作るには `metaEffects(createMeta())` を取り、スプレッドで上書きする。

#### `src/game/mutations.test.ts`

- `birthDistribution(slots, ranks, cfg)`: 変異 0 種で `[[0, 1]]`
- 変異 1 種（R1）で確率の合計が 1 ± 1e-9、要素は 2 つ、mask 0 の確率は `1 - rateAt(def, 1, cfg)`
- 変異 3 種で合計 1 ± 1e-9、要素 8 つ
- 変異 16 種（`MUTATIONS` の先頭 16 個を `assignSlot` して R1）で要素数が **2048 以下**、合計 1 ± 1e-6
  （SPEC §5「出現分布の打ち切り」の保証）
- `powerOfMask`: 2 種の mask の戦闘力が、それぞれ単独の戦闘力の積 ÷ `basePower` に等しい（乗算の保証）
- `rateAt`: R3 でも 0.9 を超えない（`mutations.ts` 220 行付近の頭打ち）
- `offerWeight(def, produced)`: `produced` を 0 → 10 → 100 → 10000 と増やすと単調非減少で、`RARITY[rarity].weight` を超えない
- `expectedPower`: 変異を 1 種足すと減らない

#### `src/game/inventory.test.ts`

在庫を直接 `Map` で作る。`slots` は `createSlots()` に `assignSlot` で 1 種足したもの。

- `launchWeakest(inv, n, ...)`: 弱い種（mask 0）から先に減る。`n` が mask 0 の頭数より少ないとき、変異種は減らない
- `launched` は `n` 以下、`damage` は `Σ 出撃数 × 戦闘力`
- `n >= total` のとき在庫が空になり `launched === total`
- 出撃後の `totalSharks` が `前 - launched` に等しい（1e-9 で比較）

#### `src/game/tick.test.ts`

`applyDamage` はいま非公開。**`export` を付ける**（テストのためだけの公開だが、副作用は無い）。

- **連鎖崩壊の退行テスト**: `overkillMult = 2` のメタ効果で侵略中の状態を作り、
  通常建築物 3 棟ぶん（`targetHp × 3` より少し多い）のダメージを 1 回で通す。
  期待: 1 棟目の余剰に 2 倍が掛かり、**2 棟目以降の余剰には掛からない**。
  具体的には `destroyed` と `score` を手計算と比較する。手計算の式:
  ```
  H = targetHp(1, cfg)
  dmg = 3H + 10       // 1 棟目を壊して余剰 2H + 10
  → 2 棟目に (2H + 10) × 2 = 4H + 20 が通る → 壊れて余剰 3H + 20（ここは ×1）
  → 3 棟目に 3H + 20 → 壊れて余剰 2H + 20
  → 4 棟目に 2H + 20 → 壊れて余剰 H + 20
  → 5 棟目に H + 20 → 壊れて余剰 20
  → 6 棟目に 20 → 残る
  destroyed === 5、score === 5H + 20
  ```
  倍率を毎回掛ける実装だと 6 棟目も壊れるので、このテストで区別できる
- `tick`: `pendingDraft` が入っている間は `t` が進まない
- `tick`: `t` が `culturePhaseSec` を超えたティックで `phase` が `invasion` になり `timeLeft === runWideBase`
- `tick`: 侵略中に `timeLeft` を 0.01 にして 1 ティック進めると `phase === 'over'`、`endReason === 'timeout'`
- `tick`: `reserveSeconds = 20` のメタ効果だと、同じ状況で `phase` は `invasion` のまま `timeLeft ≈ 20`、`reserveUsed === true`。もう一度 0 にすると終わる
- `applyDraft`: 変異を選ぶと `ranks` が 1 増え、`nextDraftAt` が `draftThresholdBase × growth^draftCount` ぶん増える

侵略中の状態を作る簡単な方法: `createState` → `s.nextDraftAt = Infinity; s.nextPolicyAt = Infinity`（ドラフトで止まらないように）
→ `s.t = cfg.culturePhaseSec` → `tick` を 1 回（フェーズ遷移が走る）。
初期の培養槽 6 個で培養液が毎秒 6 溜まり、5 秒で研究方針のドラフト（しきい値 30）が出るので、
しきい値を無限にしておかないと `pendingDraft` で `t` が止まる。
ドラフトそのものを試すテストでは逆に、しきい値をそのままにして `applyDraft(s, cfg, 0)` で閉じる。

#### `src/game/meta.test.ts`

- `budgetFor(0, 0) === 0`、`budgetFor(10000, 2) === Math.floor(100 × 0.3 × 2)`
- `purchase`: 前提を満たさない節（`family_mech` を `family_abyss` 無しで）は予算があっても買えない
- `buyNumeric`: `maxLevel` に達したら買えない。`clickPower` を 20 回買って 21 回目が `false`
- `metaEffects(createMeta())`: `families` に初期系統（`FAMILIES` の `initial: true`）だけが入る。`maxSpeed === 1`
- `upgradeCost`: レベルが上がるとコストが単調増加

#### `src/meta/save.test.ts`

`localStorage` は node に無い。ファイル先頭で最小のスタブを差す。

```ts
import { vi } from 'vitest'
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})
```

- 何も無いとき `loadMeta()` は `createMeta()` と等しい
- `{"budget": 5}` だけ保存してあると、`budget === 5` で他は既定値（後方互換の保証）
- 壊れた JSON が入っていると `createMeta()` に落ちる
- `saveMeta` → `loadMeta` で往復する

#### `src/ui/format.test.ts`

`fmt` は DOM を使わないのでテストできる。

- `fmt(0) === '0.0'`、`fmt(999) === '999'`、`fmt(1000) === '1.00k'`、`fmt(1.5e6) === '1.50M'`、`fmt(Infinity) === '∞'`
- `mmss(65) === '1:05'`

### 3. ゴールデンテスト — `src/sim/golden.test.ts`

2 種類を分けて書く。**設計目標の帯**と**カナリア**。

```ts
import { describe, expect, it } from 'vitest'
import { simulate } from './run.ts'

const SEEDS = 60

describe('初回ラン（恒久強化なし）', () => {
  const runs = Array.from({ length: SEEDS }, (_, i) => simulate({ seed: i + 1 }))
  const mean = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0) / SEEDS

  // SPEC §10「初回ランは深度 1 で終わるのが設計値」
  it('突破深度の平均が 1.0〜1.5 に収まる', () => {
    expect(mean((r) => r.clearedDepth)).toBeGreaterThanOrEqual(1.0)
    expect(mean((r) => r.clearedDepth)).toBeLessThanOrEqual(1.5)
  })
  it('過半数が深度 1 で終わる', () => {
    expect(runs.filter((r) => r.clearedDepth === 1).length).toBeGreaterThan(SEEDS / 2)
  })
  it('総時間が 3 分〜3 分 40 秒', () => {
    expect(mean((r) => r.totalSeconds)).toBeGreaterThanOrEqual(180)
    expect(mean((r) => r.totalSeconds)).toBeLessThanOrEqual(220)
  })
  it('ドラフトが 4〜6 回', () => {
    expect(mean((r) => r.draftCount)).toBeGreaterThanOrEqual(4)
    expect(mean((r) => r.draftCount)).toBeLessThanOrEqual(6)
  })
  it('どのランも 15 分以内に終わる（青天井の検知）', () => {
    for (const r of runs) expect(r.totalSeconds).toBeLessThan(900)
  })
})

describe('カナリア（結果がまったく同じであること）', () => {
  // 値を変えるときは意図したバランス変更であることを PR で説明し、SPEC §10 も更新する
  it('seed 7', () => {
    const r = simulate({ seed: 7 })
    expect(r.clearedDepth).toBe(1)
    expect(r.score).toBeCloseTo(370239.98374655715, 6)
  })
  it('同じシードは同じ結果', () => {
    const a = simulate({ seed: 42 })
    const b = simulate({ seed: 42 })
    expect(a.score).toBe(b.score)
    expect(a.ranks).toBe(b.ranks)
  })
})
```

帯の値は上の「計測済みの現在値」から取っている。**帯を広げすぎない**こと。
帯は「初回ランは深度 1 で終わる」という設計目標そのもので、ここを外れたら設計が変わっている。

カナリアは浮動小数の演算順を変えるリファクタでも落ちる。それは「結果が変わった」という事実の通知なので、
落ちたら差分を確認して値を更新する。更新の手順を README に書く（後述）。

### 4. CI

`.github/workflows/deploy.yml` の `build` ジョブ、`npm run format:check` の次に足す。

```yaml
- run: npm test
```

### 5. README

「動かす」の表に行を足す。

| コマンド             | 内容                                                        |
| -------------------- | ----------------------------------------------------------- |
| `npm test`           | ユニットテストとシミュレータのゴールデン値。CI がこれを回す |
| `npm run test:watch` | 変更を監視して再実行                                        |

「バランスを数字で確かめる」の末尾に節を足す。

```
### バランスを意図して変えたとき

`src/sim/golden.test.ts` が落ちる。これは正常で、次の手順で更新する。

1. `node src/sim/run.ts` と `node src/sim/progress.ts 40` を回し、SPEC §10 の該当する表を書き換える
2. 帯（突破深度の平均など）が設計目標から外れていないことを確認する。外れているなら config を見直す
3. カナリア（seed 7）の値を新しい結果に書き換える
4. PR に「何を変えたら、どの値がどう動いたか」を書く
```

## 受け入れ条件

- [ ] `npm test` が通り、2 秒以内に終わる
- [ ] `src/game/tick.ts` の `applyDamage` で `const mult = chained ? 1 : s.meta.overkillMult` を `const mult = s.meta.overkillMult` に変えると、連鎖崩壊のテストが落ちる（退行テストが効いていることの確認。確認後に戻す）
- [ ] `src/game/config.ts` の `hpGrowth` を 5.0 にすると、帯のテストとカナリアが落ちる（確認後に戻す）
- [ ] `npm run typecheck` がテストファイルも含めて通る
- [ ] CI の `build` ジョブに `npm test` があり、PR で走る
- [ ] `npm run format:check` が通る

## やらないこと

- `src/render/` `src/ui/`（`format.ts` を除く）のテスト。canvas と DOM が要るので別枠
- カバレッジの計測。数字を追う段階ではない
- `src/sim/luck.ts` などシミュレータ自体のテスト。ゴールデンが `simulate` を通るので間接的に守られる
