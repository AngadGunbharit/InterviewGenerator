import { useState } from 'react'
import ResumeForm from './components/ResumeForm'
import HistoryView from './components/HistoryView'
import { InterviewRecord } from './lib/history'

type View = 'home' | 'history'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [loadedRecord, setLoadedRecord] = useState<InterviewRecord | null>(null)

  function handleLoadRecord(record: InterviewRecord) {
    setLoadedRecord(record)
    setView('home')
  }

  return view === 'history'
    ? <HistoryView onBack={() => setView('home')} onLoad={handleLoadRecord} />
    : <ResumeForm
        key={loadedRecord?.id ?? 'fresh'}
        initialRecord={loadedRecord}
        onOpenHistory={() => setView('history')}
      />
}
