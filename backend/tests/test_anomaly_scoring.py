import unittest

from anomaly_scoring import CheckInMetrics, compute_risk_score


class TriageBandTests(unittest.TestCase):
    def metrics(self, face=0.01, jitter=0.01, latency=1000):
        return CheckInMetrics("patient", face, jitter, latency)

    def test_tier_one_is_stable(self):
        risk = compute_risk_score(self.metrics())

        self.assertEqual(risk["triage"]["tier"], 1)
        self.assertEqual(risk["triage"]["color"], "green")

    def test_tier_two_requires_three_consecutive_drift_checkins(self):
        history = [
            {"metrics": {"facial_asymmetry_score": 0.016, "voice_jitter": 0.01, "response_latency_ms": 1000}},
            {"metrics": {"facial_asymmetry_score": 0.019, "voice_jitter": 0.01, "response_latency_ms": 1000}},
        ]
        risk = compute_risk_score(self.metrics(face=0.023), history=history)

        self.assertEqual(risk["triage"]["tier"], 2)
        self.assertEqual(risk["triage"]["color"], "amber")
        self.assertIn("three_day_consecutive_drift", risk["triage"]["flags"])

    def test_tier_three_takes_precedence_for_acute_threshold(self):
        risk = compute_risk_score(self.metrics(face=0.03))

        self.assertEqual(risk["triage"]["tier"], 3)
        self.assertEqual(risk["triage"]["color"], "red")
        self.assertIn("acute_facial_asymmetry_threshold_crossed", risk["triage"]["flags"])


if __name__ == "__main__":
    unittest.main()
