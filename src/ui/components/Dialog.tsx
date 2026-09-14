import { type ReactNode, useEffect } from 'react'
import { t } from '../../text/index.ts'

/** 閉じるボタン・背景クリック・Esc で閉じるモーダル */
export function Dialog({
  title,
  onClose,
  className,
  children,
}: {
  title: string
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // 背景を押しても閉じる。中身のクリックは伝播させない
    <div className="overlay" onClick={onClose}>
      <div
        className={className ? `modal dialog ${className}` : 'modal dialog'}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        {children}
        <button className="btn" onClick={onClose}>
          {t.title.close}
        </button>
      </div>
    </div>
  )
}
