import React, { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button, Card } from './ui.jsx'
import WellnessQuestion from './WellnessQuestion.jsx'

const QUESTIONS = [
  {
    id: 'sudden_neurological_symptoms',
    label: 'Are you having sudden new face drooping, one-sided weakness or numbness, trouble speaking, vision or balance changes, or a severe unexplained headache?',
    type: 'choice',
    allow_skip: false,
    options: [{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }],
  },
  { id: 'hours_sleep', label: 'How many hours did you sleep last night?', type: 'number', allow_skip: true, min: 0, max: 24, step: 0.5 },
  { id: 'usual_sleep_hours', label: 'How many hours do you usually sleep in a night?', type: 'number', allow_skip: true, min: 0, max: 24, step: 0.5 },
  {
    id: 'sleep_quality',
    label: "How restful was last night's sleep?",
    type: 'choice',
    allow_skip: true,
    options: [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) })),
  },
  {
    id: 'mood',
    label: 'Overall, how have you been feeling over the past two weeks?',
    type: 'choice',
    allow_skip: true,
    options: [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) })),
  },
  { id: 'fatigue', label: 'Have you felt unusually tired during the past few days?', type: 'choice', allow_skip: true, options: [{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }] },
  { id: 'pain', label: 'Have you had pain or discomfort during the past few days?', type: 'choice', allow_skip: true, options: [{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }] },
  { id: 'concentration', label: 'Have you had difficulty concentrating during the past few days?', type: 'choice', allow_skip: true, options: [{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }] },
]

export default function WellnessCheckIn({ onComplete }) {
  const [answers, setAnswers] = useState(() => Object.fromEntries(QUESTIONS.map((question) => [question.id, null])))

  function updateAnswer(id, value) {
    setAnswers((current) => ({ ...current, [id]: value }))
  }

  const canContinue = answers.sudden_neurological_symptoms !== null

  return (
    <Card className="p-8">
      <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">How are you feeling?</h2>
      <p className="mt-2 text-sm text-black/50 dark:text-white/50">These answers help the care team understand today&apos;s context.</p>
      <div className="mt-6 space-y-3">
        {QUESTIONS.map((question) => (
          <WellnessQuestion
            key={question.id}
            question={question}
            value={answers[question.id]}
            onChange={(value) => updateAnswer(question.id, value)}
            onSkip={() => updateAnswer(question.id, null)}
          />
        ))}
      </div>
      <Button disabled={!canContinue} onClick={() => onComplete(answers)} className="mt-6 w-full">
        Continue to camera <ArrowRight size={16} />
      </Button>
    </Card>
  )
}
