import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Heart, Loader2 } from 'lucide-react'
import { Button, Card } from './ui.jsx'

const SKIP = '__skip__'
const inputStyle = 'mt-2 w-full rounded-xl border border-black/15 bg-white px-3 py-3 text-sm text-black focus:outline-none focus:ring-2 focus:ring-black/30 dark:border-white/20 dark:bg-[#171717] dark:text-white dark:focus:ring-white/50'

function Question({ question, answers, onChange }) {
  const value = answers[question.id]
  const inputId = `wellness-${question.id}`
  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium leading-relaxed text-black/85 dark:text-white/85">
        {question.label}
      </label>
      {question.type === 'number' ? (
        <>
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={question.min}
            max={question.max}
            step={question.step}
            value={value ?? ''}
            disabled={value === null}
            required={value !== null}
            placeholder={`${question.min}–${question.max}`}
            onChange={(event) => onChange(question.id, event.target.value === '' ? undefined : Number(event.target.value))}
            className={`${inputStyle} disabled:opacity-40`}
          />
          <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-black/60 dark:text-white/60">
            <input
              type="checkbox"
              checked={value === null}
              onChange={(event) => onChange(question.id, event.target.checked ? null : undefined)}
              className="h-4 w-4 accent-black dark:accent-white"
            />
            Prefer not to answer
          </label>
        </>
      ) : (
        <select
          id={inputId}
          value={value === null ? SKIP : value ?? ''}
          required
          onChange={(event) => {
            const selected = event.target.value
            const option = question.options.find((item) => String(item.value) === selected)
            onChange(question.id, selected === SKIP ? null : option?.value)
          }}
          className={inputStyle}
        >
          <option value="">Choose an answer</option>
          {question.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          {question.allow_skip && <option value={SKIP}>Prefer not to answer</option>}
        </select>
      )}
    </div>
  )
}

async function getPlan(answers, signal) {
  const response = await fetch('/api/checkin/wellness/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
    signal,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Could not prepare your questions. Please try again.')
  return result
}

export default function WellnessCheckIn({ onComplete }) {
  const [answers, setAnswers] = useState({})
  const [plan, setPlan] = useState(null)
  const [phase, setPhase] = useState('base')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const mounted = useRef(true)
  const headingRef = useRef(null)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    getPlan({}, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPlan(result) })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => {
      mounted.current = false
      controller.abort()
    }
  }, [loadAttempt])

  const urgent = answers.sudden_neurological_symptoms === 1
  const questions = phase === 'base' ? plan?.base_questions || [] : plan?.questions || []

  function changeAnswer(id, value) {
    setError(null)
    setAnswers((current) => {
      // Base edits invalidate all follow-up answers; the server also prunes
      // inactive fields before storage when branches change.
      const next = phase === 'base'
        ? Object.fromEntries(Object.entries(current).filter(([key]) => plan.base_questions.some((q) => q.id === key)))
        : { ...current }
      if (value === undefined) delete next[id]
      else next[id] = value
      return next
    })
  }

  async function submit(event) {
    event.preventDefault()
    if (urgent || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await getPlan(answers)
      if (!mounted.current) return
      setPlan(result)
      setAnswers(result.answers)
      if (result.urgent) return
      if (result.complete) {
        onComplete(result.answers)
      } else if (result.questions.length) {
        setPhase('followup')
        requestAnimationFrame(() => headingRef.current?.focus())
      } else {
        setError('Please answer each question, or select “Prefer not to answer” where available.')
      }
    } catch (err) {
      if (mounted.current) setError(err.message)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
        <Heart className="text-black dark:text-white" size={22} />
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight text-black outline-none dark:text-white">
        {phase === 'base' ? 'How have you been feeling?' : 'A little more about your day'}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-black/60 dark:text-white/60">
        {phase === 'base'
          ? 'Tell us about your sleep, symptoms, and mood. Your answers help choose a few relevant follow-up questions.'
          : 'These questions follow from what you shared. You can skip a detail or go back to change your earlier answers.'}
      </p>

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}

      {!plan ? (
        <div className="mt-6">
          {loading ? <p role="status" className="flex items-center gap-2 text-sm text-black/60 dark:text-white/60"><Loader2 className="animate-spin" size={16} />Loading questions…</p>
            : <Button variant="ghost" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry</Button>}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-6">
          <fieldset disabled={loading} className="space-y-6 disabled:opacity-60">
            <legend className="sr-only">{phase === 'base' ? 'Sleep, symptoms, and mood' : 'Follow-up questions'}</legend>
            {questions.filter((question) => !urgent || question.id === 'sudden_neurological_symptoms').map((question) => (
              <Question key={question.id} question={question} answers={answers} onChange={changeAnswer} />
            ))}
          </fieldset>

          {urgent ? (
            <div role="alert" className="rounded-2xl border border-red-400/50 bg-red-400/10 p-5 text-sm leading-relaxed text-red-100">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={18} />Get emergency help now</p>
              <p className="mt-2">Sudden new symptoms like these can be signs of a stroke. Call 911 in the US, or your local emergency number. Do not drive yourself or wait to finish this check-in, even if the symptoms go away.</p>
              <a href="https://www.cdc.gov/stroke/signs-symptoms/index.html" target="_blank" rel="noreferrer" className="mt-3 inline-block underline underline-offset-4">CDC: stroke signs and symptoms</a>
            </div>
          ) : (
            <>
              {phase === 'followup' && (
                <p className="text-xs leading-relaxed text-black/50 dark:text-white/50">These questions explore your symptoms; they do not establish that sleep caused them. Asking for support records your preference for review and does not send an immediate alert.</p>
              )}
              <div className="flex flex-wrap gap-3">
                {phase === 'followup' && <Button type="button" variant="ghost" disabled={loading} onClick={() => { setPhase('base'); setError(null); headingRef.current?.focus() }}><ArrowLeft size={16} />Edit earlier answers</Button>}
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {phase === 'base' ? 'Continue' : 'Continue to camera'}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </Card>
  )
}
