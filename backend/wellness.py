"""Structured wellness follow-ups; the score chooses questions, not medical risk.

All thresholds and weights below are unvalidated demo interaction rules.
They do not establish that sleep caused a symptom. The separate emergency
route follows https://www.cdc.gov/stroke/signs-symptoms/index.html.
"""

import math


def _choice(question_id, label, options, *, optional=True):
    return {
        "id": question_id,
        "label": label,
        "type": "choice",
        "allow_skip": optional,
        "options": [{"value": value, "label": text} for value, text in options],
    }


def _number(question_id, label, minimum, maximum, step=1):
    return {
        "id": question_id,
        "label": label,
        "type": "number",
        "allow_skip": True,
        "min": minimum,
        "max": maximum,
        "step": step,
    }


BASE_QUESTIONS = [
    _choice(
        "sudden_neurological_symptoms",
        "Are you having sudden new face drooping, one-sided weakness or numbness, "
        "trouble speaking, vision or balance changes, or a severe unexplained headache?",
        [(0, "No"), (1, "Yes")],
        optional=False,
    ),
    _number("hours_sleep", "How many hours did you sleep last night?", 0, 24, 0.5),
    _number("usual_sleep_hours", "How many hours do you usually sleep in a night?", 0, 24, 0.5),
    _choice("sleep_quality", "How restful was last night's sleep?", [
        (1, "1 — Very poor"), (2, "2 — Poor"), (3, "3 — Fair"),
        (4, "4 — Good"), (5, "5 — Very good"),
    ]),
    _choice("mood", "Overall, how have you been feeling over the past two weeks?", [
        (1, "1 — Very low"), (2, "2 — Low"), (3, "3 — Okay / mixed"),
        (4, "4 — Good"), (5, "5 — Very good"),
    ]),
    _choice("fatigue", "Have you felt unusually tired during the past few days?", [(0, "No"), (1, "Yes")]),
    _choice("pain", "Have you had pain or discomfort during the past few days?", [(0, "No"), (1, "Yes")]),
    _choice("concentration", "Have you had difficulty concentrating during the past few days?", [(0, "No"), (1, "Yes")]),
]

FOLLOW_UPS = {
    "sleep": [
        _choice("sleep_disruption", "What most affected your sleep last night?", [
            ("falling_asleep", "Difficulty falling asleep"),
            ("waking", "Waking during the night / too early"),
            ("schedule", "Schedule or environment"),
            ("pain", "Pain or discomfort"),
            ("worry", "Worry or racing thoughts"),
            ("none", "Nothing in particular"),
            ("unsure", "Something else / unsure"),
        ]),
        _choice("daytime_effect", "How much is tiredness affecting your activities today?", [
            (0, "Not at all"), (1, "A little"), (2, "Quite a bit"), (3, "A lot"),
        ]),
    ],
    "pain": [
        _number("pain_severity", "How strong is your pain now? (0 = none, 10 = strongest)", 0, 10),
        _choice("pain_location", "Where is the pain mainly?", [
            ("head", "Head"), ("neck", "Neck / shoulders"), ("back", "Back"),
            ("limbs", "Arms / legs"), ("general", "All over"), ("other", "Elsewhere"),
        ]),
    ],
    "concentration": [
        _choice("concentration_change", "How does your concentration compare with your usual?", [
            ("new", "This difficulty is new"), ("worse", "Worse than usual"),
            ("same", "About the same"), ("better", "Better than usual"),
            ("unsure", "Unsure"),
        ]),
    ],
    "mood": [
        _choice("mood_duration", "How long have you been feeling this way?", [
            ("today", "Just today"), ("days", "Several days"),
            ("weeks", "Several weeks"), ("longer", "Longer"), ("unsure", "Unsure"),
        ]),
        _choice("support_need", "Would you like to discuss how you are feeling with your care team?", [
            ("yes", "Yes"), ("no", "Not right now"), ("unsure", "Unsure"),
        ]),
    ],
}

ALL_QUESTIONS = {
    question["id"]: question
    for question in BASE_QUESTIONS + [q for group in FOLLOW_UPS.values() for q in group]
}
BASE_IDS = {question["id"] for question in BASE_QUESTIONS}


def _validate_value(question, value):
    question_id = question["id"]
    if value is None:
        if not question["allow_skip"]:
            raise ValueError(f"{question_id} must be answered yes or no.")
        return None
    if question["type"] == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{question_id} must be a finite number or null.")
        if not question["min"] <= value <= question["max"]:
            raise ValueError(f"{question_id} must be between {question['min']} and {question['max']}.")
        if not math.isclose(value / question["step"], round(value / question["step"])):
            raise ValueError(f"{question_id} must use increments of {question['step']}.")
        return float(value) if question["step"] < 1 else int(value)
    # Do not accept booleans as 0 / 1, or coerce untrusted strings into numbers.
    for option in question["options"]:
        if type(value) is type(option["value"]) and value == option["value"]:
            return value
    raise ValueError(f"Invalid answer for {question_id}.")


def evaluate_wellness(answers, require_complete=False):
    """Validate coded answers and select follow-ups without persisting anything.

    A present null is an explicit skipped response; an absent key is unanswered.
    Inactive follow-ups are removed so editing base answers cannot preserve
    obsolete symptom details. Unknown input keys are rejected (no free text).
    """
    if not isinstance(answers, dict):
        raise ValueError("answers must be an object.")
    unknown = set(answers) - set(ALL_QUESTIONS)
    if unknown:
        raise ValueError("Unknown wellness answer field.")
    cleaned = {
        key: _validate_value(ALL_QUESTIONS[key], value)
        for key, value in answers.items() if key in BASE_IDS
    }
    last_sleep = cleaned.get("hours_sleep")
    usual_sleep = cleaned.get("usual_sleep_hours")
    deficit = max(0.0, usual_sleep - last_sleep) if last_sleep is not None and usual_sleep is not None else None
    quality, mood = cleaned.get("sleep_quality"), cleaned.get("mood")
    urgent = cleaned.get("sudden_neurological_symptoms") == 1
    questions, reasons, branches = [], [], []
    if not urgent:
        if (deficit is not None and deficit >= 1) or (quality is not None and quality <= 2) or cleaned.get("fatigue") == 1:
            sleep_priority = min(3.0, deficit or 0) + ((5 - quality) * 0.5 if quality is not None else 0) + (cleaned.get("fatigue") or 0)
            branches.append((sleep_priority, "sleep", "Sleep or tiredness answers suggest asking about rest and daytime activities."))
        if cleaned.get("pain") == 1:
            branches.append((1, "pain", "Reported pain adds questions about its strength and location."))
        if cleaned.get("concentration") == 1:
            branches.append((1, "concentration", "Reported concentration difficulty adds a comparison with your usual."))
        if mood is not None and mood <= 2:
            branches.append(((5 - mood) * 0.5, "mood", "Lower mood adds questions about duration and support preferences."))
        # Each topic's contribution orders its questions; tied topics retain
        # the stable order above. This is interaction priority, not triage.
        for _, topic, reason in sorted(branches, key=lambda branch: branch[0], reverse=True):
            questions.extend(FOLLOW_UPS[topic])
            reasons.append(reason)

    for question in questions:
        key = question["id"]
        if key in answers:
            cleaned[key] = _validate_value(question, answers[key])

    # Observed contributions only: unknown components remain null, never zero.
    contributions = {
        "sleep_difference": min(3.0, deficit) if deficit is not None else None,
        "sleep_quality": (5 - quality) * 0.5 if quality is not None else None,
        "mood": (5 - mood) * 0.5 if mood is not None else None,
        **{key: cleaned.get(key) for key in ("fatigue", "pain", "concentration")},
    }
    known = [value for value in contributions.values() if value is not None]
    score = round(sum(known), 2) if known else None
    missing = [question["id"] for question in BASE_QUESTIONS + questions if question["id"] not in cleaned]
    complete = not missing and not urgent
    if require_complete:
        if urgent:
            raise ValueError("Sudden new neurological symptoms require emergency help; this check-in cannot be completed.")
        if missing:
            raise ValueError("Please answer or explicitly skip each question: " + ", ".join(missing))
    skipped = [key for key, value in cleaned.items() if value is None]
    if urgent:
        summary = "Sudden new neurological symptoms reported. Call 911 or your local emergency number now."
    else:
        topics = [name for name in ("fatigue", "pain", "concentration") if cleaned.get(name) == 1]
        summary = ("Reported symptoms: " + ", ".join(topics) + ".") if topics else "No symptoms selected in answered questions."
        if skipped:
            summary += f" {len(skipped)} response(s) were declined; those details are unknown."
    return {
        "answers": cleaned,
        "base_questions": BASE_QUESTIONS,
        "questions": questions,
        "follow_up_score": score,
        "score_details": {
            "purpose": "Unvalidated demo question priority; not a diagnostic or neurological risk score.",
            "formula": "min(3, max(0, usual sleep − last night's sleep)) + 0.5 × (5 − sleep quality) + 0.5 × (5 − mood) + reported symptom count",
            "contributions": contributions,
            "unknown_components": [key for key, value in contributions.items() if value is None],
            "maximum": 10,
            "branch_rules": "Sleep follow-ups: at least 1 hour below your usual, quality 1–2, or fatigue. Mood follow-ups: mood 1–2. Pain and concentration follow-ups: symptom reported. Topics with larger score contributions appear first.",
        },
        "reasons": reasons,
        "complete": complete,
        "urgent": urgent,
        "summary": summary,
    }
