from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.db.database import get_db
from backend.app.db.models import Assessment, DetailedRating, Soldier, User
from backend.app.deps import get_current_user
from backend.app.services.ai_scorer import score_assessment
from backend.app.services.eval_reference import aggregate_category_scores, score_from_rating
from backend.app.services.ocr_service import extract_text_from_image, save_upload_locally
from backend.app.services.stt_service import save_audio_locally, transcribe_audio

router = APIRouter(prefix="/assessments", tags=["Assessments — Phase 01"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SubtaskRating(BaseModel):
    task_group: str
    task_name: str = ""
    subtask_number: int
    subtask_description: str = ""
    rating: str  # T / P / U


class StructuredEvalCreate(BaseModel):
    """Full structured evaluation — one of leader/unit/steo."""
    soldier_id: int
    event_id: int | None = None
    eval_category: str              # leader_eval / unit_eval / steo_eval
    steo_mission_name: str | None = None
    leader_ratings: list[SubtaskRating] = []
    unit_ratings: list[SubtaskRating] = []
    steo_ratings: list[SubtaskRating] = []
    notes: str | None = None
    run_ai_scoring: bool = True


class AssessmentCreate(BaseModel):
    soldier_id: int
    event_id: int | None = None
    assessment_type: str = "field_eval"
    notes: str | None = None
    run_ai_scoring: bool = True


class AssessmentUpdate(BaseModel):
    notes: str | None = None
    score_leadership: float | None = None
    score_decision_quality: float | None = None
    score_stress_response: float | None = None
    score_tactical: float | None = None
    score_communication: float | None = None


def _assessment_dict(a: Assessment) -> dict:
    return {
        "id": a.id,
        "soldier_id": a.soldier_id,
        "event_id": a.event_id,
        "assessment_type": a.assessment_type,
        "capture_method": a.capture_method,
        "raw_capture": a.raw_capture,
        "photo_url": a.photo_url,
        "audio_url": a.audio_url,
        "ai_analyzed": a.ai_analyzed,
        "ai_summary": a.ai_summary,
        "ai_detail": a.ai_detail,
        "score_leadership": a.score_leadership,
        "score_decision_quality": a.score_decision_quality,
        "score_stress_response": a.score_stress_response,
        "score_tactical": a.score_tactical,
        "score_communication": a.score_communication,
        # Structured eval fields
        "eval_category": a.eval_category,
        "steo_mission_name": a.steo_mission_name,
        "ldr_planning": a.ldr_planning,
        "ldr_atd": a.ldr_atd,
        "ldr_time_mgmt": a.ldr_time_mgmt,
        "ldr_decisiveness": a.ldr_decisiveness,
        "ldr_tactics": a.ldr_tactics,
        "ump_planning": a.ump_planning,
        "ump_atd": a.ump_atd,
        "ump_time_mgmt": a.ump_time_mgmt,
        "ump_decisiveness": a.ump_decisiveness,
        "ump_tactics": a.ump_tactics,
        "notes": a.notes,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def _apply_skill_deltas(soldier: Soldier, deltas: dict) -> None:
    """Nudge soldier's cumulative skill vector based on assessment AI deltas."""
    mapping = {
        "leadership":     "skill_leadership",
        "decision_making": "skill_decision_making",
        "stress_tolerance": "skill_stress_tolerance",
        "tactical":       "skill_tactical",
        "communication":  "skill_communication",
        "teamwork":       "skill_teamwork",
        "adaptability":   "skill_adaptability",
    }
    for dim, attr in mapping.items():
        delta = deltas.get(dim, 0.0)
        current = getattr(soldier, attr, 0.5) or 0.5
        setattr(soldier, attr, round(max(0.0, min(1.0, current + delta)), 4))


def _skill_deltas_from_cat_scores(cat_scores: dict) -> dict:
    """
    Convert T/P/U category scores (1–5 scale) to skill vector deltas (±0.1).
    A score of 3 (P) produces 0 delta; T (5) → +0.1; U (1) → -0.1.
    """
    def _d(score: float | None) -> float:
        if score is None:
            return 0.0
        return round((score - 3.0) / 20.0, 4)

    planning     = cat_scores.get("Planning")
    tactics      = cat_scores.get("Tactics")
    decisiveness = cat_scores.get("Decisiveness")
    time_mgmt    = cat_scores.get("Time Management")
    atd          = cat_scores.get("Attention to Detail")

    plan_dec_avg = None
    if planning is not None and decisiveness is not None:
        plan_dec_avg = (planning + decisiveness) / 2
    elif planning is not None:
        plan_dec_avg = planning
    elif decisiveness is not None:
        plan_dec_avg = decisiveness

    return {
        "leadership":      _d(decisiveness),
        "decision_making": _d(plan_dec_avg),
        "stress_tolerance": _d(time_mgmt),
        "tactical":        _d(tactics),
        "communication":   _d(atd),
        "teamwork":        0.0,
        "adaptability":    _d(time_mgmt),
    }


def _populate_scores_from_cat_scores(assessment: Assessment, cat_scores: dict) -> None:
    """
    Derive the five AI-score dimensions directly from structured T/P/U category
    scores so the assessment always has scores even when no notes were provided.
    Scores stay on the same 0–5 scale used by the AI scorer.
    """
    planning     = cat_scores.get("Planning")
    tactics      = cat_scores.get("Tactics")
    decisiveness = cat_scores.get("Decisiveness")
    time_mgmt    = cat_scores.get("Time Management")
    atd          = cat_scores.get("Attention to Detail")

    present = [s for s in [planning, tactics, decisiveness, time_mgmt, atd] if s is not None]
    if not present:
        return

    overall = sum(present) / len(present)

    assessment.ai_analyzed         = True
    assessment.score_leadership     = decisiveness if decisiveness is not None else overall
    assessment.score_decision_quality = (
        (planning + decisiveness) / 2
        if planning is not None and decisiveness is not None
        else (planning or decisiveness or overall)
    )
    assessment.score_stress_response = (
        (decisiveness + time_mgmt) / 2
        if decisiveness is not None and time_mgmt is not None
        else (time_mgmt or overall)
    )
    assessment.score_tactical       = tactics if tactics is not None else overall
    assessment.score_communication  = atd if atd is not None else overall

    if not assessment.ai_summary:
        score_lines = ", ".join(
            f"{k}: {v:.1f}" for k, v in cat_scores.items() if v is not None
        )
        assessment.ai_summary = f"Structured evaluation scores — {score_lines}."


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
def list_assessments(
    soldier_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Assessment).order_by(Assessment.created_at.desc())
    if soldier_id:
        q = q.filter(Assessment.soldier_id == soldier_id)
    return [_assessment_dict(a) for a in q.all()]


@router.post("/submit-structured", status_code=status.HTTP_201_CREATED)
def submit_structured_eval(
    body: StructuredEvalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit a full structured evaluation (Leader, Unit, or SQD ST&EO) with T/P/U ratings."""
    soldier = db.query(Soldier).filter(Soldier.id == body.soldier_id).first()
    if not soldier:
        raise HTTPException(404, detail="Soldier not found")

    ratings_map = {
        "leader_eval": body.leader_ratings,
        "unit_eval":   body.unit_ratings,
        "steo_eval":   body.steo_ratings,
    }
    active_ratings = [r.model_dump() for r in ratings_map.get(body.eval_category, [])]

    # Aggregate category scores
    cat_scores = aggregate_category_scores(active_ratings, body.eval_category)

    a = Assessment(
        soldier_id=body.soldier_id,
        event_id=body.event_id,
        evaluator_id=current_user.id,
        assessment_type="structured_eval",
        capture_method="manual",
        eval_category=body.eval_category,
        steo_mission_name=body.steo_mission_name,
        notes=body.notes,
        raw_capture=body.notes,
        owner_user_id=current_user.id,
        created_by_user_id=current_user.id,
    )

    # Populate category scores into the correct columns
    if body.eval_category == "leader_eval":
        a.ldr_planning     = cat_scores.get("Planning")
        a.ldr_atd          = cat_scores.get("Attention to Detail")
        a.ldr_time_mgmt    = cat_scores.get("Time Management")
        a.ldr_decisiveness = cat_scores.get("Decisiveness")
        a.ldr_tactics      = cat_scores.get("Tactics")
    elif body.eval_category == "unit_eval":
        a.ump_planning     = cat_scores.get("Planning")
        a.ump_atd          = cat_scores.get("Attention to Detail")
        a.ump_time_mgmt    = cat_scores.get("Time Management")
        a.ump_decisiveness = cat_scores.get("Decisiveness")
        a.ump_tactics      = cat_scores.get("Tactics")

    # Always derive scores and skill deltas from T/P/U category scores
    _populate_scores_from_cat_scores(a, cat_scores)
    _apply_skill_deltas(soldier, _skill_deltas_from_cat_scores(cat_scores))
    db.add(soldier)

    # If evaluator notes are provided, run AI scoring and let it override/enrich
    if body.run_ai_scoring and body.notes:
        context = {"rank": soldier.rank, "unit": soldier.unit, "mos": soldier.mos}
        ai_result = score_assessment(body.notes, context)
        _populate_ai_scores(a, ai_result)
        _apply_skill_deltas(soldier, ai_result.get("skill_vector_delta", {}))

    db.add(a)
    db.flush()  # get a.id before adding children

    # Save individual T/P/U ratings
    for r in active_ratings:
        dr = DetailedRating(
            assessment_id=a.id,
            eval_type=body.eval_category.replace("_eval", ""),
            task_group=r.get("task_group", ""),
            task_name=r.get("task_name", body.steo_mission_name or ""),
            subtask_number=r.get("subtask_number", 0),
            subtask_description=r.get("subtask_description", ""),
            rating=r.get("rating", "P").upper(),
            rating_score=score_from_rating(r.get("rating", "P")),
        )
        db.add(dr)

    db.commit()
    db.refresh(a)
    return {
        **_assessment_dict(a),
        "category_scores": cat_scores,
        "rating_count": len(active_ratings),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_assessment(
    body: AssessmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    soldier = db.query(Soldier).filter(Soldier.id == body.soldier_id).first()
    if not soldier:
        raise HTTPException(404, detail="Soldier not found")

    a = Assessment(
        soldier_id=body.soldier_id,
        event_id=body.event_id,
        evaluator_id=current_user.id,
        assessment_type=body.assessment_type,
        capture_method="manual",
        raw_capture=body.notes,
        notes=body.notes,
        owner_user_id=current_user.id,
        created_by_user_id=current_user.id,
    )

    if body.run_ai_scoring and body.notes:
        context = {"rank": soldier.rank, "unit": soldier.unit, "mos": soldier.mos}
        result = score_assessment(body.notes, context)
        _populate_ai_scores(a, result)
        _apply_skill_deltas(soldier, result.get("skill_vector_delta", {}))
        db.add(soldier)

    db.add(a)
    db.commit()
    db.refresh(a)
    return _assessment_dict(a)


def _populate_ai_scores(assessment: Assessment, ai_result: dict) -> None:
    assessment.ai_analyzed = True
    assessment.ai_summary = ai_result.get("ai_summary")
    assessment.ai_detail = ai_result
    assessment.score_leadership = ai_result.get("score_leadership")
    assessment.score_decision_quality = ai_result.get("score_decision_quality")
    assessment.score_stress_response = ai_result.get("score_stress_response")
    assessment.score_tactical = ai_result.get("score_tactical")
    assessment.score_communication = ai_result.get("score_communication")


@router.post("/capture/ocr", status_code=status.HTTP_201_CREATED)
async def capture_ocr(
    soldier_id: int = Form(...),
    event_id: int | None = Form(None),
    assessment_type: str = Form("field_eval"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    soldier = db.query(Soldier).filter(Soldier.id == soldier_id).first()
    if not soldier:
        raise HTTPException(404, detail="Soldier not found")

    image_bytes = await file.read()
    mime = file.content_type or "image/jpeg"
    ocr_result = extract_text_from_image(image_bytes, mime)

    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    photo_path = save_upload_locally(image_bytes, safe_name)

    raw_text = ocr_result.get("extracted_text", "")
    context = {"rank": soldier.rank, "unit": soldier.unit, "mos": soldier.mos,
               "document_type": ocr_result.get("extracted_context")}
    ai_result = score_assessment(raw_text, context)

    a = Assessment(
        soldier_id=soldier_id,
        event_id=event_id,
        evaluator_id=current_user.id,
        assessment_type=assessment_type,
        capture_method="ocr",
        raw_capture=raw_text,
        photo_url=photo_path,
        owner_user_id=current_user.id,
        created_by_user_id=current_user.id,
    )
    _populate_ai_scores(a, ai_result)
    _apply_skill_deltas(soldier, ai_result.get("skill_vector_delta", {}))
    db.add(soldier)
    db.add(a)
    db.commit()
    db.refresh(a)
    return {**_assessment_dict(a), "ocr": ocr_result}


@router.post("/capture/stt", status_code=status.HTTP_201_CREATED)
async def capture_stt(
    soldier_id: int = Form(...),
    event_id: int | None = Form(None),
    assessment_type: str = Form("field_eval"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    soldier = db.query(Soldier).filter(Soldier.id == soldier_id).first()
    if not soldier:
        raise HTTPException(404, detail="Soldier not found")

    audio_bytes = await file.read()
    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    audio_path = save_audio_locally(audio_bytes, safe_name)
    stt_result = transcribe_audio(audio_bytes, file.filename or "audio.m4a")

    transcript = stt_result.get("transcript", "")
    context = {"rank": soldier.rank, "unit": soldier.unit, "mos": soldier.mos,
               "source": "voice_recording"}
    ai_result = score_assessment(transcript, context)

    a = Assessment(
        soldier_id=soldier_id,
        event_id=event_id,
        evaluator_id=current_user.id,
        assessment_type=assessment_type,
        capture_method="speech_to_text",
        raw_capture=transcript,
        audio_url=audio_path,
        owner_user_id=current_user.id,
        created_by_user_id=current_user.id,
    )
    _populate_ai_scores(a, ai_result)
    _apply_skill_deltas(soldier, ai_result.get("skill_vector_delta", {}))
    db.add(soldier)
    db.add(a)
    db.commit()
    db.refresh(a)
    return {**_assessment_dict(a), "stt": stt_result}


@router.get("/{assessment_id}")
def get_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    a = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not a:
        raise HTTPException(404, detail="Assessment not found")
    return _assessment_dict(a)


@router.post("/{assessment_id}/score")
def rescore_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-run AI scoring on an existing assessment's raw_capture."""
    a = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not a:
        raise HTTPException(404, detail="Assessment not found")
    if not a.raw_capture:
        raise HTTPException(400, detail="No raw capture text to score")

    soldier = db.query(Soldier).filter(Soldier.id == a.soldier_id).first()
    context = {"rank": soldier.rank if soldier else None, "unit": soldier.unit if soldier else None}
    result = score_assessment(a.raw_capture, context)
    _populate_ai_scores(a, result)
    if soldier:
        _apply_skill_deltas(soldier, result.get("skill_vector_delta", {}))
        db.add(soldier)
    db.commit()
    db.refresh(a)
    return _assessment_dict(a)


@router.patch("/{assessment_id}")
def update_assessment(
    assessment_id: int,
    body: AssessmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    a = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not a:
        raise HTTPException(404, detail="Assessment not found")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(a, field, val)
    db.commit()
    db.refresh(a)
    return _assessment_dict(a)


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    a = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not a:
        raise HTTPException(404, detail="Assessment not found")
    db.delete(a)
    db.commit()
