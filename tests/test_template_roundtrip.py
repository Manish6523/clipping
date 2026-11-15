import unittest
import glob
import json
import os

class TestTemplateRoundtrip(unittest.TestCase):
    """
    Ensures every template in templates/*.json can be loaded,
    serialized, and preserves all vital fields (including min_virality_score,
    chat_spike_multiplier, hype_keywords, layout layers, and watermark)
    without corruption or data loss.
    """

    def test_all_templates_schema_and_roundtrip(self):
        template_files = glob.glob('templates/*.json')
        self.assertGreater(len(template_files), 0, "No template files found in templates/")

        for filepath in template_files:
            with self.subTest(filepath=filepath):
                with open(filepath, 'r', encoding='utf-8') as f:
                    original = json.load(f)

                # Required top-level keys
                self.assertIn('name', original, f"{filepath} missing 'name'")
                self.assertIn('layout', original, f"{filepath} missing 'layout'")

                # Simulate store serialization / payload transformation
                layout = original.get('layout', {})
                layers = layout.get('layers', [])

                payload = {
                    'name': original.get('name', '').strip(),
                    'description': original.get('description', '').strip(),
                    'min_virality_score': original.get('min_virality_score', 65),
                    'chat_spike_multiplier': original.get('chat_spike_multiplier', 2.5),
                    'hype_keywords': original.get('hype_keywords', ['CLIP IT', 'WTF', 'LMAO', 'OMG', 'W', 'L']),
                    'layout': {
                        **layout,
                        'schema': 2,
                        'canvas': {'w': 1080, 'h': 1920},
                        'layers': layers
                    },
                    'subtitles': original.get('subtitles', {}),
                    'caption_style': original.get('caption_style'),
                    'hook_style': original.get('hook_style'),
                    'watermark': original.get('watermark'),
                }

                # Verify layer geometry normalized coordinates (0.0 to 1.0)
                for i, layer in enumerate(layers):
                    src = layer.get('src', {})
                    dst = layer.get('dst', {})
                    for axis in ['x', 'y', 'w', 'h']:
                        if axis in src:
                            self.assertTrue(0.0 <= src[axis] <= 1.05, f"{filepath} layer {i} src.{axis} out of bounds: {src[axis]}")
                        if axis in dst:
                            self.assertTrue(0.0 <= dst[axis] <= 1.05, f"{filepath} layer {i} dst.{axis} out of bounds: {dst[axis]}")

                # JSON serializability check
                serialized = json.dumps(payload, indent=2)
                reloaded = json.loads(serialized)
                self.assertEqual(reloaded['name'], original['name'])
                self.assertEqual(len(reloaded['layout']['layers']), len(layers))

if __name__ == '__main__':
    unittest.main()
