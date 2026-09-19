import React from 'react'

function answerLabel(question, value) {
  if (value === null) return 'Prefer not to answer'
  if (question.type === 'number') return String(value)
  return question.options.find((option) => option.value === value)?.label || String(value)
}

export default function WellnessSummary({ wellness }) {
  if (!wellness?.answers) return null
  const answers = wellness.answers
  const questions = [...(wellness.base_questions || []), ...(wellness.questions || [])]
  const skipped = Object.values(answers).filter((value) => value === null).length
  const mood = questions.find((question) => question.id === 'mood')
  const symptoms = ['fatigue', 'pain', 'concentration'].filter((key) => answers[key] === 1)
  const unknownSymptoms = ['fatigue', 'pain', 'concentration'].filter((key) => answers[key] == null)
  const unknownScore = wellness.score_details?.unknown_components || []

  return (
    <section aria-label="Sleep, symptoms and mood summary" className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm dark:border-white/10 dark:bg-white/[0.03]">
      <h3 className="font-semibold text-black dark:text-white">Sleep, symptoms &amp; mood</h3>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <div><dt className="text-xs text-black/45 dark:text-white/45">Last night's sleep</dt><dd className="mt-1 text-black/80 dark:text-white/80">{answers.hours_sleep == null ? 'Not shared' : `${answers.hours_sleep} hours`}</dd></div>
        <div><dt className="text-xs text-black/45 dark:text-white/45">Usual sleep</dt><dd className="mt-1 text-black/80 dark:text-white/80">{answers.usual_sleep_hours == null ? 'Not shared' : `${answers.usual_sleep_hours} hours`}</dd></div>
        <div><dt className="text-xs text-black/45 dark:text-white/45">Mood · past two weeks</dt><dd className="mt-1 text-black/80 dark:text-white/80">{answers.mood == null ? 'Not shared' : mood ? answerLabel(mood, answers.mood) : `${answers.mood} / 5`}</dd></div>
        <div><dt className="text-xs text-black/45 dark:text-white/45">Symptoms reported</dt><dd className="mt-1 text-black/80 dark:text-white/80">{symptoms.length ? symptoms.map((key) => key === 'concentration' ? 'concentration difficulty' : key).join(', ') : unknownSymptoms.length ? 'No symptoms selected; some not shared' : 'None reported'}</dd></div>
      </dl>
      {answers.support_need === 'yes' && <p className="mt-3 rounded-lg bg-black/5 p-3 text-black/80 dark:bg-white/5 dark:text-white/80">Would like to discuss mood with the care team. This preference is recorded; no immediate alert is sent.</p>}
      {skipped > 0 && <p className="mt-3 text-xs text-black/50 dark:text-white/50">{skipped} response{skipped === 1 ? '' : 's'} not shared. Unanswered details remain unknown.</p>}
      <details className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
        <summary className="cursor-pointer text-xs font-medium text-black/65 dark:text-white/65">Responses &amp; follow-up question formula</summary>
        <dl className="mt-4 space-y-3">
          {questions.filter((question) => Object.hasOwn(answers, question.id)).map((question) => (
            <div key={question.id}><dt className="text-xs leading-relaxed text-black/45 dark:text-white/45">{question.label}</dt><dd className="mt-1 text-xs text-black/80 dark:text-white/80">{answerLabel(question, answers[question.id])}</dd></div>
          ))}
        </dl>
        <div className="mt-4 border-t border-black/10 pt-3 text-xs leading-relaxed text-black/50 dark:border-white/10 dark:text-white/50">
          <p className="text-black/75 dark:text-white/75">Demo question priority: {wellness.follow_up_score == null ? 'Not calculated' : `${wellness.follow_up_score} / 10${unknownScore.length ? ' (partial)' : ''}`}</p>
          {wellness.score_details?.formula && <p className="mt-2">{wellness.score_details.formula}</p>}
          {wellness.score_details?.branch_rules && <p className="mt-2">{wellness.score_details.branch_rules}</p>}
          <p className="mt-2">Unvalidated weights organize follow-up questions. This is not a diagnostic or neurological risk score and does not change the face / voice score.</p>
          {unknownScore.length > 0 && <p className="mt-2">Missing answers are excluded from the sum, so this partial total must not be interpreted as a low score.</p>}
          {wellness.reasons?.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{wellness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        </div>
      </details>
    </section>
  )
}
