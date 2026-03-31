import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import multer from 'multer'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import mammoth from 'mammoth'

const app = express()
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

const MOCK_MODE = !process.env.ANTHROPIC_API_KEY

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

const anthropic = MOCK_MODE ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

app.post('/api/parse-resume', upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }

  try {
    let text = ''
    const mime = file.mimetype
    const name = file.originalname.toLowerCase()

    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      const data = await pdfParse(file.buffer)
      text = data.text
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer })
      text = result.value
    } else if (mime === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) {
      const html = file.buffer.toString('utf-8')
      text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    } else {
      res.status(400).json({ error: 'Unsupported file type. Upload a PDF, DOCX, or HTML file.' })
      return
    }

    const trimmed = text.trim()

    // Extract candidate info — regex first, Claude refines if available
    const emailMatch = trimmed.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean)
    // Name: first non-URL, non-email short line (likely the header)
    const nameLine = lines.find(l => l.length > 2 && l.length < 60 && !l.includes('@') && !l.includes('http') && /^[A-Za-z\s\-'.]+$/.test(l))
    // Role: look for common title keywords near the top
    const roleKeywords = /engineer|developer|designer|manager|analyst|director|lead|architect|scientist|consultant|recruiter|product|marketing|sales|operations|founder|cto|ceo|vp /i
    const roleLine = lines.slice(0, 15).find(l => roleKeywords.test(l) && l.length < 80 && !l.includes('@'))

    let info = {
      name: nameLine || '',
      email: emailMatch ? emailMatch[0] : '',
      currentRole: roleLine || '',
    }

    if (!MOCK_MODE) {
      try {
        const msg = await anthropic!.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          system: `Extract the candidate's full name, email address, and current or most recent job title from the resume. Return only a JSON object: {"name":"","email":"","currentRole":""}. If a field is not found, leave it as an empty string.`,
          messages: [{ role: 'user', content: trimmed.slice(0, 4000) }],
        })
        const block = msg.content.find(b => b.type === 'text')
        if (block && block.type === 'text') {
          const match = block.text.match(/\{[\s\S]*\}/)
          if (match) info = { ...info, ...JSON.parse(match[0]) }
        }
      } catch (e) {
        // non-fatal — regex values used as fallback
      }
    }

    res.json({ text: trimmed, ...info })
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

  if (MOCK_MODE) {
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

const PORT = 3001
app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`))
