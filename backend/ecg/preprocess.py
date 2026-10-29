"""Signal preprocessing for ECG classification.

Pure, dependency-light numpy pipeline mirroring the frontend pan-Tompkins-ish
frontend pipeline so classifier input stays consistent across the stack.
"""
import numpy as np


def smooth(samples, window):
    if window <= 1 or len(samples) < window:
        return np.asarray(samples, dtype=float)
    kernel = np.ones(window) / window
    return np.convolve(samples, kernel, mode="same")


def derivative(samples, sampling_rate):
    x = np.asarray(samples, dtype=float)
    d = np.gradient(x) * sampling_rate
    return np.abs(d)


def r_peaks(enhanced, sampling_rate):
    """Detect R-peak positions on the enhanced (|d/dt|) signal.

    Multi-peak detection: within each overlapping 2 s block an adaptive
    mean+1.35σ threshold is applied, contiguous above-threshold regions are
    grouped, and the maximum of each group becomes a candidate peak. A global
    250 ms refractory window applied in signal order prevents re-detecting the
    same complex in overlapping blocks or riding the T wave.
    """
    refractory = max(1, int(0.25 * sampling_rate))
    block = int(2 * sampling_rate)
    step = max(1, block // 2)
    n = len(enhanced)
    peaks = []
    last = -refractory
    for start in range(0, max(1, n - block + 1), step):
        end = min(n, start + block)
        seg = enhanced[start:end]
        if seg.size == 0:
            continue
        threshold = float(seg.mean() + 1.35 * seg.std())
        if threshold <= 0:
            continue
        above = seg > threshold
        idx = 0
        while idx < above.size:
            if above[idx]:
                j = idx
                while j + 1 < above.size and above[j + 1]:
                    j += 1
                peak_idx = start + idx + int(np.argmax(seg[idx : j + 1]))
                if peak_idx - last >= refractory:
                    peaks.append(peak_idx)
                    last = peak_idx
                idx = j + 1
            else:
                idx += 1
    return peaks


def extract_features(samples, sampling_rate):
    """Features consumed by the prototype classifier and risk model."""
    x = np.asarray(samples, dtype=float)
    if x.size < int(2 * sampling_rate):
        return None
    smoothed = smooth(x, max(3, int(0.03 * sampling_rate)))
    enhanced = derivative(smoothed, sampling_rate)
    peaks = r_peaks(enhanced, sampling_rate)
    if len(peaks) < 2:
        return {"beats": len(peaks), "rr": [], "features": None}
    rr = np.diff(peaks) / sampling_rate * 1000.0
    rr = rr[(rr >= 330) & (rr <= 2000)]
    features = {
        "beats": len(peaks),
        "rr_count": int(rr.size),
        "bpm_mean": float(60000.0 / np.median(rr)) if rr.size else None,
        "hrv_rmssd": float(np.sqrt(np.mean(np.diff(rr) ** 2))) if rr.size > 2 else None,
        "signal_std": float(x.std()),
        "qrs_width_ms": float(np.median(np.diff(peaks)) / sampling_rate * 1000.0 * 0.12) if rr.size else None,
    }
    return {"beats": len(peaks), "rr": rr.tolist(), "features": features}
