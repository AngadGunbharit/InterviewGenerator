import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import multer from 'multer'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import mammoth from 'mammoth'

const app = express()
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }))
app.use(express.json())

const MOCK_QUESTIONS_MODE = !process.env.ANTHROPIC_API_KEY  // mock question generation only
const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY

const MOCK_QUESTIONS = [
  { text: 'Walk me through the most technically complex project on your resume.', category: 'Technical' },
  { text: 'How do you approach debugging a production issue you have never seen before?', category: 'Technical' },
  { text: 'Describe a time you had to learn a new technology quickly under pressure.', category: 'Behavioral' },
  { text: 'Tell me about a disagreement with a teammate and how you resolved it.', category: 'Behavioral' },
  { text: 'If you joined and found the codebase had no tests, what would you do?', category: 'Situational' },
  { text: 'How would you prioritize features when everything is marked urgent?', category: 'Situational' },
  { text: 'What kind of engineering culture helps you do your best work?', category: 'Culture' },
  { text: 'How do you stay current with new tools and best practices in your field?', category: 'Culture' },
]

const anthropic = HAS_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

function cleanResumeText(raw: string): string {
  return raw
    .split('\n')
    .map(l => l.trim())
    // remove lines that are just page numbers, dots, or dashes
    .filter(l => !/^[\d\s\.\-–—|]+$/.test(l))
    // remove very short noise lines (single chars, stray bullets)
    .filter(l => l.length > 1)
    // collapse 3+ blank lines into 2
    .reduce((acc: string[], line) => {
      if (line === '' && acc.at(-1) === '' && acc.at(-2) === '') return acc
      acc.push(line)
      return acc
    }, [])
    .join('\n')
    .trim()
}

function extractInfoFallback(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Email — reliable regex
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  const email = emailMatch ? emailMatch[0] : ''

  // Find the line index of the email/phone contact block (usually near top)
  const contactIdx = lines.findIndex(l =>
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(l) ||
    /(\+?[\d\s\-().]{7,})/.test(l) ||
    /linkedin\.com/i.test(l)
  )

  // Name: look in the first few lines before the contact block
  const nameSearchLines = lines.slice(0, Math.min(contactIdx > 0 ? contactIdx + 1 : 5, 8))
  const nameRegex = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'\-\.]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ'\-\.]+){1,4}(?:\s+(?:Jr|Sr|II|III|IV|MD|PhD|Esq)\.?)?$/
  const nameLine = nameSearchLines.find(l =>
    nameRegex.test(l) &&
    !l.includes('@') &&
    !l.includes('http') &&
    l.length >= 4 &&
    l.length <= 60 &&
    !/\d/.test(l)
  )

  // Current role: look in first 20 lines for title-like lines (not headings like "EXPERIENCE")
  const roleKeywords = /engineer|developer|designer|manager|analyst|director|lead|architect|scientist|consultant|recruiter|product|marketing|sales|operations|founder|cto|ceo|vp\b|president|coordinator|specialist|strategist|writer|editor|researcher/i
  const sectionHeadings = /^(experience|education|skills|summary|objective|profile|work history|projects|certifications|awards|languages|references)$/i
  const roleLine = lines.slice(0, 20).find(l =>
    roleKeywords.test(l) &&
    !sectionHeadings.test(l.replace(/[^a-zA-Z\s]/g, '').trim()) &&
    l.length < 80 &&
    !l.includes('@') &&
    // Avoid lines that are clearly company names or dates
    !/\d{4}/.test(l)
  )

  return { name: nameLine || '', email, currentRole: roleLine || '' }
}

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/api/parse-resume', upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }

  try {
    let raw = ''
    const mime = file.mimetype
    const fname = file.originalname.toLowerCase()

    if (mime === 'application/pdf' || fname.endsWith('.pdf')) {
      const data = await pdfParse(file.buffer)
      raw = data.text
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fname.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer })
      raw = result.value
    } else if (mime === 'text/html' || fname.endsWith('.html') || fname.endsWith('.htm')) {
      const html = file.buffer.toString('utf-8')
      raw = html.replace(/<style[\s\S]*?<\/style>/gi, '')
               .replace(/<script[\s\S]*?<\/script>/gi, '')
               .replace(/<[^>]+>/g, ' ')
               .replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
    } else {
      res.status(400).json({ error: 'Unsupported file type. Upload a PDF, DOCX, or HTML file.' })
      return
    }

    const text = cleanResumeText(raw)

    // Always try regex-based extraction as baseline
    let info = extractInfoFallback(text)

    // Use Claude for extraction if API key is available (regardless of question mock mode)
    if (HAS_API_KEY) {
      try {
        const msg = await anthropic!.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: `You are parsing a resume. Extract these fields accurately:
- name: candidate's full name (usually the largest text at the top)
- email: email address
- currentRole: their most recent or current job title (not the company, just the title)

Return ONLY a JSON object: {"name":"","email":"","currentRole":""}
If a field is not clearly present, return an empty string for it.`,
          messages: [{ role: 'user', content: text.slice(0, 6000) }],
        })
        const block = msg.content.find(b => b.type === 'text')
        if (block && block.type === 'text') {
          const match = block.text.match(/\{[\s\S]*?\}/)
          if (match) {
            const parsed = JSON.parse(match[0])
            // Only override if Claude found something better
            if (parsed.name) info.name = parsed.name
            if (parsed.email) info.email = parsed.email
            if (parsed.currentRole) info.currentRole = parsed.currentRole
          }
        }
      } catch (e) {
        // Claude failed — stick with regex results
      }
    }

    res.json({ text, ...info })
  } catch (err: any) {
    console.error('Parse error:', err.message)
    res.status(500).json({ error: 'Failed to parse file: ' + err.message })
  }
})

app.post('/api/generate-questions', async (req, res) => {
  const { resumeText, candidateName, jobTitle } = req.body

  if (!resumeText) {
    res.status(400).json({ error: 'resumeText is required' })
    return
  }

  if (MOCK_QUESTIONS_MODE) {
    console.log('[MOCK] No ANTHROPIC_API_KEY — returning mock questions')
    await new Promise(r => setTimeout(r, 800)) // simulate latency
    res.json({ questions: MOCK_QUESTIONS, mock: true })
    return
  }

  try {
    const stream = anthropic!.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: `You are an expert interviewer who helps hiring managers have meaningful, human conversations with candidates. Given a candidate's resume and the role they're applying for, generate 8-10 interview questions that are behavioral and human-centric — focused on how they think, collaborate, and grow. Avoid generic ATS-style questions. Tailor questions to the candidate's actual experience and the specific role.

Return a JSON object with this exact structure:
{
  "questions": [
    { "text": "question here", "category": "Behavioral|Situational|Motivational|Culture" },
    ...
  ]
}

Return only the JSON object, no other text.`,
      messages: [
        {
          role: 'user',
          content: `Generate interview questions for ${candidateName || 'this candidate'} applying for the role of ${jobTitle || 'the position'} based on their resume:\n\n${resumeText}`,
        },
      ],
    })

    const message = await stream.finalMessage()

    // Extract text from content blocks
    const textBlock = message.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      res.status(500).json({ error: 'No text response from Claude' })
      return
    }

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      res.status(500).json({ error: 'Could not parse questions from response' })
      return
    }

    const parsed = JSON.parse(jsonMatch[0])
    res.json(parsed)
  } catch (err: any) {
    console.error('Claude API error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/follow-up', async (req, res) => {
  const { questionText, candidateName, jobTitle } = req.body
  if (!questionText) {
    res.status(400).json({ error: 'questionText is required' })
    return
  }

  if (MOCK_QUESTIONS_MODE) {
    await new Promise(r => setTimeout(r, 600))
    res.json({ followUps: [
      'Can you walk me through a specific example of that?',
      'What would you do differently if you faced that situation again?',
      'How did that experience shape the way you work today?',
    ]})
    return
  }

  try {
    const msg = await anthropic!.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You are an expert interviewer. Given an interview question, generate 2-3 natural follow-up questions to probe deeper. Return only a JSON array of strings, no other text.`,
      messages: [{
        role: 'user',
        content: `Interview question for ${candidateName || 'candidate'} (role: ${jobTitle || 'unknown'}): "${questionText}"\n\nGenerate 2-3 follow-up questions.`,
      }],
    })
    const block = msg.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('No response')
    const match = block.text.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('Could not parse follow-ups')
    res.json({ followUps: JSON.parse(match[0]) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`API server running on port ${PORT}`))
