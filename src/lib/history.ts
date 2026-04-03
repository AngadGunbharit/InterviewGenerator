const KEY = 'interviewiq_history'

export interface QuestionWithMeta {
  text: string
  category: string
  notes: string
  followUps: string[]
}

export interface InterviewRecord {
  id: string
  savedAt: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  resumeText: string
  questions: QuestionWithMeta[]
}

export function loadHistory(): InterviewRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return []
  }
}

export function saveInterview(record: InterviewRecord): void {
  const history = loadHistory()
  const updated = [record, ...history.filter(r => r.id !== record.id)].slice(0, 50)
  localStorage.setItem(KEY, JSON.stringify(updated))
}

export function deleteInterview(id: string): void {
  const updated = loadHistory().filter(r => r.id !== id)
  localStorage.setItem(KEY, JSON.stringify(updated))
}
