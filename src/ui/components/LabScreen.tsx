import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  BRANCHES,
  canPurchase,
  nodeCost,
  nodeDetail,
  nodeKind,
  nodeName,
  nodeTaken,
  nodeUnlocked,
  NUMERIC_BY_ID,
  TREE,
} from '../../game/meta.ts'
import { MUTATION_BY_ID } from '../../game/mutations.ts'
import { getMeta, purchaseNode, startNewRun } from '../../store/gameStore.ts'
import { CodexButton } from './CodexButton.tsx'
import { SharkIcon } from './SharkIcon.tsx'
import { fmt } from '../format.ts'
import { fill, t } from '../../text/index.ts'
import { useGame } from '../useGame.ts'

/**
 * 配線。点灯判定は描画時に行う。
 * meta は中身を書き換えて使い回しているため参照が変わらず、
 * 計測側の依存配列に入れても購入のたびには走らない。
 */
type Line = { x1: number; y1: number; x2: number; y2: number; from: string; branch: string }

export function LabScreen() {
  useGame()
  const meta = getMeta()
  const wrapRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const [lines, setLines] = useState<Line[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  /** 節同士をつなぐ線を、実際に配置された位置から測って引く */
  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const base = wrap.getBoundingClientRect()
    const next: Line[] = []
    for (const n of TREE) {
      const child = nodeRefs.current.get(n.id)
      if (!child) continue
      const cb = child.getBoundingClientRect()
      for (const r of n.requires) {
        const parent = nodeRefs.current.get(r)
        if (!parent) continue
        const pb = parent.getBoundingClientRect()
        next.push({
          x1: pb.left + pb.width / 2 - base.left,
          y1: pb.bottom - base.top,
          x2: cb.left + cb.width / 2 - base.left,
          y2: cb.top - base.top,
          from: r,
          branch: n.branch,
        })
      }
    }
    setSize({ w: base.width, h: base.height })
    setLines(next)
  }, [])

  useLayoutEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  const maxRow = Math.max(...TREE.map((n) => n.row))
  const maxCol = Math.max(...TREE.map((n) => n.col))

  return (
    <div className="lab">
      <div className="lab-head">
        <div>
          <div className="panel-title">{t.lab.title}</div>
          <div className="lab-budget">
            <span className="lab-budget-value">{fmt(meta.budget)}</span>
            <span className="stat-label">{t.lab.budget}</span>
          </div>
        </div>
        <div className="lab-stats">
          <span>{fill(t.lab.runs, { n: meta.runs })}</span>
          <span>{fill(t.lab.bestDepth, { n: meta.bestDepth })}</span>
          <span>{fill(t.lab.lifetime, { n: fmt(meta.lifetimeBudget) })}</span>
        </div>
        <CodexButton />
        <button className="btn" onClick={startNewRun}>
          {t.lab.start}
        </button>
      </div>

      <div className="tree-heads" style={{ gridTemplateColumns: `repeat(${maxCol + 1}, 1fr)` }}>
        {Object.entries(BRANCHES).map(([id, b]) => {
          const cols = TREE.filter((n) => n.branch === id).map((n) => n.col)
          const from = Math.min(...cols)
          const span = Math.max(...cols) - from + 1
          return (
            <div key={id} className="tree-head" style={{ gridColumn: `${from + 1} / span ${span}` }}>
              <span className="tree-head-name">{b.name}</span>
              <span className="tree-head-sub">{b.sub}</span>
            </div>
          )
        })}
      </div>

      <div
        className="tree"
        ref={wrapRef}
        style={{
          gridTemplateColumns: `repeat(${maxCol + 1}, 1fr)`,
          gridTemplateRows: `repeat(${maxRow + 1}, auto)`,
        }}
      >
        <svg className="tree-wires" width={size.w} height={size.h} aria-hidden="true">
          {lines.map((l, i) => (
            <path
              key={i}
              className="wire"
              data-on={nodeTaken(meta, l.from)}
              data-branch={l.branch}
              d={`M ${l.x1} ${l.y1} C ${l.x1} ${(l.y1 + l.y2) / 2}, ${l.x2} ${(l.y1 + l.y2) / 2}, ${l.x2} ${l.y2}`}
            />
          ))}
        </svg>

        {TREE.map((n) => {
          const taken = nodeTaken(meta, n.id)
          const open = nodeUnlocked(meta, n.id)
          const cost = nodeCost(meta, n.id)
          const buyable = canPurchase(meta, n.id)
          const numeric = nodeKind(n.id) === 'numeric'
          const lv = meta.levels[n.id] ?? 0
          const max = numeric ? NUMERIC_BY_ID.get(n.id)!.maxLevel : 1

          return (
            <button
              key={n.id}
              ref={(el) => {
                if (el) nodeRefs.current.set(n.id, el)
                else nodeRefs.current.delete(n.id)
              }}
              className="node"
              data-branch={n.branch}
              data-taken={taken}
              data-locked={!open}
              data-buyable={buyable}
              data-short={open && cost !== null && !buyable}
              style={{ gridColumn: n.col + 1, gridRow: n.row + 1 }}
              disabled={!buyable}
              onClick={() => purchaseNode(n.id)}
            >
              {n.preview && (
                <span className="node-preview">
                  <SharkIcon mutations={[MUTATION_BY_ID.get(n.preview)!]} height={30} />
                </span>
              )}
              <span className="node-name">
                {nodeName(n.id)}
                {numeric && (
                  <span className="node-lv">
                    {lv}/{isFinite(max) ? max : '∞'}
                  </span>
                )}
              </span>
              <span className="node-detail">{nodeDetail(meta, n.id)}</span>
              <span className="node-cost">
                {taken && !numeric && <span className="node-mark">{t.lab.taken}</span>}
                {cost === null ? (numeric ? t.lab.max : '') : fmt(cost)}
                {open && cost !== null && cost > meta.budget && (
                  <span className="node-short">{fill(t.lab.short, { n: fmt(cost - meta.budget) })}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
