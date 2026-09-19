import unittest

from wellness import evaluate_wellness


def base_answers(**changes):
    return {
        "sudden_neurological_symptoms": 0,
        "hours_sleep": 8,
        "usual_sleep_hours": 8,
        "sleep_quality": 5,
        "mood": 5,
        "fatigue": 0,
        "pain": 0,
        "concentration": 0,
        **changes,
    }


class WellnessTests(unittest.TestCase):
    def test_restful_checkin_has_no_followups(self):
        result = evaluate_wellness(base_answers(), require_complete=True)
        self.assertTrue(result["complete"])
        self.assertEqual(result["questions"], [])
        self.assertEqual(result["follow_up_score"], 0)

    def test_sleep_compares_with_persons_usual_duration(self):
        result = evaluate_wellness(base_answers(hours_sleep=6, usual_sleep_hours=8))
        self.assertEqual(result["follow_up_score"], 2)
        self.assertEqual({q["id"] for q in result["questions"]}, {"sleep_disruption", "daytime_effect"})
        self.assertFalse(result["complete"])
        # Six hours alone is not a hardcoded clinical threshold.
        self.assertTrue(evaluate_wellness(base_answers(hours_sleep=6, usual_sleep_hours=6))["complete"])

    def test_all_concern_branches_and_bounded_formula(self):
        result = evaluate_wellness(base_answers(hours_sleep=1, sleep_quality=1, mood=1, fatigue=1, pain=1, concentration=1))
        self.assertEqual(result["follow_up_score"], 10)
        self.assertEqual(len(result["questions"]), 7)
        self.assertFalse(result["complete"])

    def test_fatigue_alone_prompts_sleep_followups(self):
        result = evaluate_wellness(base_answers(fatigue=1))
        self.assertEqual({q["id"] for q in result["questions"]}, {"sleep_disruption", "daytime_effect"})

    def test_formula_contribution_prioritizes_topics(self):
        result = evaluate_wellness(base_answers(mood=1, pain=1))
        self.assertEqual(result["questions"][0]["id"], "mood_duration")
        self.assertEqual(result["questions"][2]["id"], "pain_severity")

    def test_missing_and_explicitly_declined_are_different(self):
        answers = {key: None for key in base_answers() if key != "sudden_neurological_symptoms"}
        answers["sudden_neurological_symptoms"] = 0
        result = evaluate_wellness(answers, require_complete=True)
        self.assertTrue(result["complete"])
        self.assertIsNone(result["follow_up_score"])
        self.assertEqual(len(result["score_details"]["unknown_components"]), 6)
        del answers["mood"]
        with self.assertRaises(ValueError):
            evaluate_wellness(answers, require_complete=True)

    def test_visible_followups_can_be_declined(self):
        answers = base_answers(mood=2, mood_duration=None, support_need=None)
        self.assertTrue(evaluate_wellness(answers, require_complete=True)["complete"])

    def test_editing_base_answers_prunes_stale_details(self):
        result = evaluate_wellness(base_answers(pain_severity=9, pain_location="head", mood_duration="weeks", support_need="yes"), require_complete=True)
        self.assertNotIn("pain_severity", result["answers"])
        self.assertNotIn("pain_location", result["answers"])
        self.assertNotIn("mood_duration", result["answers"])

    def test_urgent_gate_is_independent_of_sleep_or_score(self):
        result = evaluate_wellness({"sudden_neurological_symptoms": 1})
        self.assertTrue(result["urgent"])
        self.assertFalse(result["complete"])
        self.assertEqual(result["questions"], [])
        with self.assertRaises(ValueError):
            evaluate_wellness(base_answers(sudden_neurological_symptoms=1), require_complete=True)

    def test_rejects_malformed_or_out_of_range_answers(self):
        cases = [
            None, [], {"notes": "free text"}, {"hours_sleep": float("nan")},
            {"hours_sleep": float("inf")}, {"hours_sleep": 25}, {"hours_sleep": 7.25},
            {"hours_sleep": True}, {"pain": True}, {"mood": "5"}, {"mood": 0},
            {"sudden_neurological_symptoms": None},
            base_answers(pain=1, pain_location="invalid"),
        ]
        for answers in cases:
            with self.subTest(answers=answers), self.assertRaises(ValueError):
                evaluate_wellness(answers)


if __name__ == "__main__":
    unittest.main()
