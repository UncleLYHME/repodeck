import unittest
from pathlib import Path

from repodeck import hero


class HeroTest(unittest.TestCase):
    def test_phase_and_greeting_by_hour(self):
        self.assertEqual([hero.phase_for(h) for h in (4, 5, 7, 8, 16, 17, 19, 20, 23)],
                         ["night", "dawn", "dawn", "day", "day", "dusk", "dusk", "night", "night"])
        self.assertEqual([hero.greeting(h) for h in (6, 13, 18, 2)],
                         ["Good morning", "Good afternoon", "Good evening", "Burning the midnight oil"])

    def test_every_phase_has_every_layer(self):
        for phase in ("dawn", "day", "dusk", "night"):
            for layer in ("sky", "sky2", "clouds", "beam", "fg"):
                self.assertTrue(Path(hero.DATA, phase, f"{layer}.png").exists(), f"{phase}/{layer}")


if __name__ == "__main__":
    unittest.main()
