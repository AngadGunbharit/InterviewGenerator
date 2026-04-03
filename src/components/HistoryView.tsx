import { useState } from 'react'
import { loadHistory, deleteInterview, InterviewRecord } from '../lib/history'

interface Props {
  onBack: () => void
  onLoad: (record: InterviewRecord) => void
}

export default function HistoryView({ onBack, onLoad }: Props) {
  const [history, setHistory] = useState<InterviewRecord[]>(() => loadHistory())

  function handleDelete(id: string) {
    deleteInterview(id)
    setHistory(h => h.filter(r => r.id !== id))
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <>
      <header className="page-header">
        <div className="logo">
          <div className="logo-icon">✦</div>
          InterviewIQ
          <span className="badge">Beta</span>
        </div>
        <div className="header-actions">
          <button className="btn-ghost" onClick={onBack}>← Back</button>
        </div>
      </header>

      <main className="main-content">
        <div className="hero">
          <h1>Interview History</h1>
          <p>Past interviews saved on this device.</p>
        </div>

        {history.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-3)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📋</div>
            <p style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>No interviews yet</p>
            <p style={{ fontSize: '0.88rem' }}>Generate questions for a candidate and they'll appear here.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {history.map(record => (
              <div className="history-card" key={record.id}>
                <div className="history-card-left">
                  <div className="history-avatar">
                    {record.candidateName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'}
                  </div>
                  <div>
                    <div className="history-name">{record.candidateName || 'Unknown'}</div>
                    <div className="history-meta">
                      {record.jobTitle && <span>{record.jobTitle}</span>}
                      {record.jobTitle && record.candidateEmail && <span className="dot">·</span>}
                      {record.candidateEmail && <span>{record.candidateEmail}</span>}
                    </div>
                  </div>
                </div>
                <div className="history-card-right">
                  <div className="history-stats">
                    <span className="history-count">{record.questions.length} questions</span>
                    <span className="history-date">{formatDate(record.savedAt)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-load" onClick={() => onLoad(record)}>Load</button>
                    <button className="btn-delete" onClick={() => handleDelete(record.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
