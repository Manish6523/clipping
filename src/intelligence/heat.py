"""Signal Normalization and Multi-Modal Heat Curve Generator.

1. Robust Z-score (median / MAD) normalization clipped to [0, 4] / 4.0 for live streams.
2. Percentile rank within source for VODs.
3. Heat curve H(t) at 1s resolution with Gaussian smoothing (sigma ~3s).
4. Peak detection with prominence >= 0.15 and distance >= 20s.
5. Fallback 90s overlapping windows snapped to sentences when external signals are absent (QuickClip).
"""

import math
from typing import Any, Callable, Dict, List, Optional, Tuple
from src.intelligence.sentences import Sentence


class HeatCurve:
    """Computes continuous 1-second multi-signal heat curve and candidate peak seeds."""

    DEFAULT_WEIGHTS = {
        "chat_velocity": 0.35,
        "audio_energy": 0.25,
        "laughter": 0.20,
        "youtube_heatmap": 0.20,
    }

    @staticmethod
    def robust_z_normalize(values: List[float]) -> List[float]:
        """Robust Z-score using median and median absolute deviation (MAD)."""
        if not values:
            return []
        sorted_vals = sorted(values)
        n = len(sorted_vals)
        median = sorted_vals[n // 2]
        devs = sorted(abs(v - median) for v in values)
        mad = devs[n // 2]
        if mad < 1e-6:
            # Fallback to standard min-max
            max_v = max(values)
            min_v = min(values)
            if max_v <= min_v:
                return [0.5 for _ in values]
            return [(v - min_v) / (max_v - min_v) for v in values]

        # Normalized: (v - median) / (1.4826 * mad), clipped to [0, 4] / 4
        scale = 1.4826 * mad
        out = []
        for v in values:
            z = max(0.0, min(4.0, (v - median) / scale))
            out.append(round(z / 4.0, 3))
        return out

    @classmethod
    def build_heat_curve(
        self,
        duration: float,
        signals: Dict[str, List[Tuple[float, float]]],
        weights: Optional[Dict[str, float]] = None,
        sigma_seconds: float = 3.0,
    ) -> List[float]:
        """Builds a continuous 1-second resolution smoothed heat curve [0.0 - 1.0]."""
        total_seconds = max(1, int(math.ceil(duration)))
        curve = [0.0] * total_seconds
        w_dict = weights or self.DEFAULT_WEIGHTS

        # Map signals into 1s bins
        for sig_name, points in signals.items():
            w = w_dict.get(sig_name, 0.20)
            if not points or w <= 0.0:
                continue

            vals = [p[1] for p in points]
            normed = self.robust_z_normalize(vals)

            for (ts, _), val in zip(points, normed):
                idx = int(math.floor(ts))
                if 0 <= idx < total_seconds:
                    curve[idx] += w * val

        # Gaussian smoothing
        if sigma_seconds > 0.5:
            radius = int(math.ceil(sigma_seconds * 2.5))
            kernel = [
                math.exp(-0.5 * (k / sigma_seconds) ** 2)
                for k in range(-radius, radius + 1)
            ]
            k_sum = sum(kernel)
            smoothed = [0.0] * total_seconds

            for i in range(total_seconds):
                val_sum = 0.0
                weight_sum = 0.0
                for kidx, k_val in enumerate(kernel):
                    offset = kidx - radius
                    pos = i + offset
                    if 0 <= pos < total_seconds:
                        val_sum += curve[pos] * k_val
                        weight_sum += k_val
                smoothed[i] = round(val_sum / weight_sum if weight_sum > 0 else 0.0, 4)
            return smoothed

        return [round(v, 4) for v in curve]

    @staticmethod
    def find_peaks(
        curve: List[float],
        min_prominence: float = 0.15,
        min_distance_seconds: int = 20,
    ) -> List[Dict[str, Any]]:
        """Finds prominent peaks on the 1s heat curve with distance enforcement."""
        peaks: List[Dict[str, Any]] = []
        n = len(curve)
        if n < 3:
            return peaks

        for i in range(1, n - 1):
            if curve[i] > curve[i - 1] and curve[i] >= curve[i + 1]:
                val = curve[i]
                if val < min_prominence:
                    continue

                # Check minimum distance from previous kept peak
                if peaks and (i - peaks[-1]["time"]) < min_distance_seconds:
                    # Keep the higher peak of the two
                    if val > peaks[-1]["heat"]:
                        peaks[-1] = {"time": float(i), "heat": round(val, 3)}
                else:
                    peaks.append({"time": float(i), "heat": round(val, 3)})

        return peaks

    @staticmethod
    def generate_fallback_windows(
        sentences: List[Sentence],
        window_seconds: float = 90.0,
        overlap_seconds: float = 30.0,
    ) -> List[Dict[str, Any]]:
        """Builds overlapping sentence-snapped fallback candidate windows for Quick Clip / no-signal sources."""
        if not sentences:
            return []

        windows: List[Dict[str, Any]] = []
        w_idx = 1
        i = 0
        n = len(sentences)

        while i < n:
            w_start = sentences[i].start
            j = i

            while j + 1 < n and (sentences[j + 1].end - w_start) <= (window_seconds * 1.25):
                j += 1
                if (sentences[j].end - w_start) >= window_seconds:
                    break

            w_end = sentences[j].end
            text = " ".join(s.text for s in sentences[i:j + 1])
            seed_mid = round((w_start + w_end) / 2.0, 3)

            windows.append({
                "id": f"cand_fb_{w_idx:03d}",
                "seed_time": seed_mid,
                "start_time": round(w_start, 3),
                "end_time": round(w_end, 3),
                "start_sentence_id": sentences[i].id,
                "end_sentence_id": sentences[j].id,
                "text": text,
                "heat_score": 0.50,
            })
            w_idx += 1

            if j >= n - 1:
                break

            target = w_end - overlap_seconds
            k = i + 1
            while k <= j and sentences[k].start < target:
                k += 1
            i = max(k, i + 1)

        return windows

