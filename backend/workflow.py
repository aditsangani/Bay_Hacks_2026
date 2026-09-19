"""
Render Workflow definition for the NeuroTriage-Home check-in pipeline.

This wraps the same logic already used by app.py's Flask routes
(cv_analysis, wellness, anomaly_scoring) as discrete Render Workflow
tasks, so the pipeline can run as a genuine Render Workflow — required
to qualify for the "Best Use of Render" track — rather than just being
described as one.

This does NOT replace app.py / the Flask backend. The frontend keeps
talking to Flask on localhost:5001 as it already does. This file is a
separate, additional entry point specifically for the Render Workflow
service, so you can demo a real Workflow run in the Render dashboard
alongside your working Flask app.

Docs: https://render.com/docs/workflows
(Confirm the exact `render` package API against current docs before
the demo — this is a fast-moving product and the interface may have
changed since this was written.)

Local test (after `pip install render` — check the actual package name
in Render's docs/dashboard, this may differ):
    python workflow.py
"""

from render import TaskContext, Workflows

from cv_analysis import score_from_base64_image, score_from_base64_images
from wellness import evaluate_wellness
from anomaly_scoring import (
    CheckInMetrics,
    compute_risk_score,
    build_telemetry_payload,
    build_fhir_shaped_observation,
)

app = Workflows()


@app.task
def analyze_face_task(ctx: TaskContext, image_b64: str = None, images_b64: list = None) -> dict:
    """
    Mirrors POST /api/checkin/face. Accepts either a single frame or a
    multi-frame burst (median capture). Raises ValueError on bad input,
    same as the Flask route — Render Workflows handles task failure /
    retry for you instead of you writing that logic by hand.
    """
    if images_b64:
        return score_from_base64_images(images_b64)
    return score_from_base64_image(image_b64)


@app.task
def analyze_wellness_task(ctx: TaskContext, answers: dict, require_complete: bool = False) -> dict:
    """Mirrors POST /api/checkin/wellness/plan and the wellness portion of /submit."""
    return evaluate_wellness(answers, require_complete=require_complete)


@app.task
def score_checkin_task(ctx: TaskContext, patient_id: str, face_result: dict, voice_metrics: dict) -> dict:
    """
    Mirrors the scoring portion of POST /api/checkin/submit: builds
    CheckInMetrics, computes the weighted risk score, and produces the
    de-identified telemetry payload + FHIR-shaped observation.
    """
    metrics = CheckInMetrics(
        patient_id=patient_id,
        facial_asymmetry_score=face_result.get("asymmetry_score"),
        voice_jitter=voice_metrics.get("voice_jitter"),
        response_latency_ms=voice_metrics.get("response_latency_ms"),
    )
    risk = compute_risk_score(metrics)
    telemetry = build_telemetry_payload(metrics, risk)
    fhir_observation = build_fhir_shaped_observation(telemetry)
    return {
        "risk": risk,
        "telemetry_payload": telemetry,
        "fhir_shaped_observation": fhir_observation,
    }


@app.task
async def run_checkin_pipeline(
    ctx: TaskContext,
    patient_id: str,
    image_b64: str = None,
    images_b64: list = None,
    voice_metrics: dict = None,
    wellness_answers: dict = None,
) -> dict:
    """
    End-to-end orchestration task: face capture -> wellness follow-up
    -> risk scoring, chained with Render's built-in retry handling on
    each step. This is the task to trigger from the Render dashboard
    or CLI for a live demo — it shows the whole pipeline as one
    Workflow run, with each sub-task's result inspectable individually.
    """
    voice_metrics = voice_metrics or {}

    face_result = await ctx.run(analyze_face_task, image_b64=image_b64, images_b64=images_b64)

    wellness_result = None
    if wellness_answers is not None:
        wellness_result = await ctx.run(analyze_wellness_task, answers=wellness_answers)

    scoring_result = await ctx.run(
        score_checkin_task,
        patient_id=patient_id,
        face_result=face_result,
        voice_metrics=voice_metrics,
    )

    return {
        "face_analysis": face_result,
        "wellness": wellness_result,
        **scoring_result,
    }


if __name__ == "__main__":
    # Render's local dev server / CLI picks this up when you run the
    # file directly. Check `render workflows dev` or similar in the
    # current CLI docs — the exact local-run command may differ from
    # what's here.
    app.start()
