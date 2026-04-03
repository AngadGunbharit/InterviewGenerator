import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveInterview, InterviewRecord, QuestionWithMeta } from '../lib/history'

const MOCK_MODE = !import.meta.env.VITE_SUPABASE_URL

interface Props {
  initialRecord?: InterviewRecord | null
  onOpenHistory: () => void
}

export default function ResumeForm({ initialRecord, onOpenHistory }: Props) {
  const [name, setName] = useState(initialRecord?.candidateName ?? '')
  const [email, setEmail] = useState(initialRecord?.candidateEmail ?? '')
  const [jobTitle, setJobTitle] = useState(initialRecord?.jobTitle ?? '')
  const [resume, setResume] = useState(initialRecord?.resumeText ?? '')
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [questions, setQuestions] = useState<QuestionWithMeta[]>(initialRecord?.questions ?? [])
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [followUpLoading, setFollowUpLoading] = useState<Record<number, boolean>>({})
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(initialRecord?.id ?? null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Debounce-save notes changes
  useEffect(() => {
    if (!currentRecordId || questions.length === 0) return
    const timer = setTimeout(() => {
      saveInterview({
        id: currentRecordId,
        savedAt: new Date().toISOString(),
        candidateName: name,
        candidateEmail: email,
        jobTitle,
        resumeText: resume,
        questions,
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [questions])

  async function processFile(file: File) {
    setParsing(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('http://localhost:3001/api/parse-resume', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to parse file')
      setResume(data.text)
      if (data.name) setName(data.name)
      if (data.email) setEmail(data.email)
      if (data.currentRole) setJobTitle(data.currentRole)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setParsing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setQuestions([])

    try {
      if (!MOCK_MODE) {
        const { data: candidate, error: candidateError } = await supabase
          .from('candidates').insert({ name, email, resume_text: resume }).select().single()
        if (candidateError) throw candidateError
        const { data: interview, error: interviewError } = await supabase
          .from('interviews').insert({ candidate_id: candidate.id, status: 'pending' }).select().single()
        if (interviewError) throw interviewError
      }

      const response = await fetch('http://localhost:3001/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: resume, candidateName: name, jobTitle }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to generate questions')
      }

      const { questions: generated } = await response.json()
      const withMeta: QuestionWithMeta[] = generated.map((q: any) => ({
        ...q, notes: '', followUps: [],
      }))

      if (!MOCK_MODE) {
        const rows = withMeta.map((q, i) => ({
          interview_id: (interview as any).id,
          question_text: q.text,
          order_index: i,
        }))
        const { error: questionsError } = await supabase.from('questions').insert(rows)
        if (questionsError) throw questionsError
      }

      const id = crypto.randomUUID()
      setCurrentRecordId(id)
      setQuestions(withMeta)
      saveInterview({ id, savedAt: new Date().toISOString(), candidateName: name, candidateEmail: email, jobTitle, resumeText: resume, questions: withMeta })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFollowUp(index: number, questionText: string) {
    setFollowUpLoading(prev => ({ ...prev, [index]: true }))
    try {
      const res = await fetch('http://localhost:3001/api/follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionText, candidateName: name, jobTitle }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setQuestions(qs => qs.map((q, i) => i === index ? { ...q, followUps: data.followUps } : q))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setFollowUpLoading(prev => ({ ...prev, [index]: false }))
    }
  }

  function catClass(cat: string) {
    const known = ['Behavioral', 'Situational', 'Motivational', 'Culture', 'Technical']
    return known.includes(cat) ? cat : 'default'
  }

  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

  return (
    <>
      <header className="page-header">
        <div className="logo">
          <div className="logo-icon">✦</div>
          InterviewIQ
          <span className="badge">Beta</span>
        </div>
        <div className="header-actions">
          <button className="btn-ghost" onClick={onOpenHistory}>History</button>
          {questions.length > 0 && (
            <button className="btn-ghost" onClick={() => window.print()}>Export PDF</button>
          )}
        </div>
      </header>

      <main className="main-content">
        <div className="hero no-print">
          <h1>Generate smarter interview questions</h1>
          <p>Upload a resume and get tailored, human-centric questions in seconds.</p>
        </div>

        <div className="card no-print">
          {parsing ? (
            <div className="parsing-indicator">
              <div className="spinner" />
              Parsing resume and extracting candidate info…
            </div>
          ) : (
            <div
              className={`upload-zone${dragOver ? ' drag-over' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="upload-icon">📄</div>
              <h3>Drop a resume here or click to upload</h3>
              <p>We'll auto-fill the candidate's details</p>
              <div className="file-types">
                <span className="file-type-badge">PDF</span>
                <span className="file-type-badge">DOCX</span>
                <span className="file-type-badge">HTML</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.html,.htm" style={{ display: 'none' }} onChange={handleFileInput} />
            </div>
          )}

          <form onSubmit={handleGenerate}>
            <div className="form-row">
              <div className="form-group">
                <label>Candidate Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" required />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
            </div>

            <div className="form-group">
              <label>Role / Job Title</label>
              <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Senior Software Engineer, Product Manager…" required />
            </div>

            <div className="divider">or paste resume text</div>

            <div className="form-group">
              <label>Resume Text</label>
              <textarea value={resume} onChange={e => setResume(e.target.value)} required placeholder="Paste the candidate's resume here…" />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? (
                <><div className="spinner" style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />Generating questions…</>
              ) : <>✦ Generate Interview Questions</>}
            </button>
          </form>

          {error && (
            <div className="error-banner"><span>⚠️</span><span>{error}</span></div>
          )}
        </div>

        {questions.length > 0 && (
          <div className="questions-section">
            <div className="questions-header">
              <h2>Interview Questions</h2>
              <span className="count-badge">{questions.length} questions</span>
            </div>

            {name && (
              <div className="candidate-chip">
                <div className="avatar">{initials || '?'}</div>
                <div className="info">
                  <strong>{name}</strong>
                  {jobTitle && <span>· {jobTitle}</span>}
                </div>
              </div>
            )}

            {questions.map((q, i) => (
              <div className={`question-card cat-border-${catClass(q.category)}`} key={i}>
                <div className="question-number">{i + 1}</div>
                <div className="question-body">
                  <span className={`category-pill cat-${catClass(q.category)}`}>{q.category}</span>
                  <p className="question-text">{q.text}</p>

                  {/* Follow-ups */}
                  {q.followUps.length > 0 && (
                    <ul className="followup-list">
                      {q.followUps.map((fu, fi) => (
                        <li key={fi} className="followup-item">{fu}</li>
                      ))}
                    </ul>
                  )}

                  <div className="question-actions no-print">
                    <button
                      className="btn-followup"
                      disabled={followUpLoading[i]}
                      onClick={() => handleFollowUp(i, q.text)}
                    >
                      {followUpLoading[i]
                        ? <><div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />Loading…</>
                        : '+ Follow-up questions'}
                    </button>
                  </div>

                  {/* Notes */}
                  <textarea
                    className="notes-textarea no-print"
                    placeholder="Add interview notes…"
                    value={q.notes}
                    onChange={e => setQuestions(qs => qs.map((item, idx) => idx === i ? { ...item, notes: e.target.value } : item))}
                  />
                  {/* Print-only notes */}
                  {q.notes && <p className="notes-print">{q.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
