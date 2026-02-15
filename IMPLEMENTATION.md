# AI Inference Integration Guide

This document explains how the AI components work and how to swap them for custom models. Each component has a clean interface — replace the implementation without changing the pipeline.

---

## Architecture

The frame processing pipeline runs in `server/ws_handler.py`. Each frame flows through different processing stages depending on the current state:

```
Phone frame (JPEG) -> decode -> state router
                                  |
                    +-------------+------------------+
                    v             v                   v
              NAVIGATION    IDENTIFICATION        APPROACH
                    |             |                   |
              GPS waypoint   YOLOv8 detect       YOLOv8 detect
              following      -> face_matcher      -> face_matcher
                    |             |               -> approach_command
                    v             v                   |
              movement cmd   match found?            v
                             -> APPROACH         bbox tracking
                                                 or "arrived"

  (any state with detect toggle ON)
              -> YOLOv8 detect
              -> face_matcher (if reference photo uploaded)
```

### Key files

| File | Role |
|------|------|
| `server/ws_handler.py` | Frame pipeline — calls each component |
| `server/identification/person_detector.py` | YOLOv8 nano person detection |
| `server/identification/face_matcher.py` | AWS Rekognition face comparison |
| `server/identification/approach.py` | Bbox -> movement commands |
| `server/navigation/obstacle_avoidance.py` | Obstacle detection stub (placeholder) |
| `server/config.py` | All tuneable parameters (.env) |

---

## 1. Person Detection (YOLOv8)

**File:** `server/identification/person_detector.py`

Uses YOLOv8 nano for fast, accurate person detection. The model auto-downloads (~6MB) on first use.

### Interface

```python
class PersonDetector:
    def detect(self, frame: np.ndarray) -> List[Dict]:
        """
        Args:
            frame: BGR numpy array (H, W, 3)

        Returns:
            List of person detections:
              - 'bbox': [x1, y1, x2, y2] pixel coordinates (int)
              - 'confidence': float (0-1)
        """
```

### Current implementation

- **Model:** YOLOv8n (`yolov8n.pt`, ~6MB, auto-downloads)
- **Class filter:** COCO class 0 (person) only
- **Confidence threshold:** `PERSON_CONFIDENCE_THRESHOLD` (default 0.4)
- **Speed:** ~20-50ms on CPU, ~5-10ms on GPU
- **Lazy loading:** Model loaded on first `detect()` call

### How to replace

To use a different detector (e.g., YOLOv8s for better accuracy, or a custom model):

```python
class PersonDetector:
    def _load(self):
        from ultralytics import YOLO
        self._model = YOLO("yolov8s.pt")  # or your custom model

    def detect(self, frame: np.ndarray) -> List[Dict]:
        # Just keep the same return format: [{"bbox": [...], "confidence": float}]
```

### Config

```env
PERSON_CONFIDENCE_THRESHOLD=0.4    # minimum YOLO confidence to accept detection
```

---

## 2. Face Matching (AWS Rekognition)

**File:** `server/identification/face_matcher.py`

Compares a cropped person region against the reference photo. Called for each YOLO detection during `IDENTIFICATION`, `APPROACH`, and dashboard detect-only mode.

### Interface

```python
def compare_face(
    reference_bytes: bytes,      # JPEG bytes of reference photo
    face_crop: np.ndarray,       # BGR numpy array of cropped region
) -> Optional[Dict]:
    """
    Returns:
      - {'confidence': float, 'bounding_box': dict} if match found
      - None if no match or no face detected
    """
```

### Current implementation

- **Service:** AWS Rekognition `CompareFaces` API
- **Input:** Raw JPEG bytes (no S3 upload needed)
- **Minimum crop size:** 20x20 pixels
- **Threshold:** `REKOGNITION_SIMILARITY_THRESHOLD` (default 90%)
- **Credentials:** Via environment variables or AWS default credentials chain

### How to replace with local inference

To avoid AWS dependency, use a local face recognition model:

```python
# Example: InsightFace (local, no cloud)
import insightface
from insightface.app import FaceAnalysis

_app = None
_ref_embedding = None

def compare_face(reference_bytes: bytes, face_crop: np.ndarray) -> Optional[Dict]:
    global _app, _ref_embedding
    if _app is None:
        _app = FaceAnalysis(allowed_modules=["detection", "recognition"])
        _app.prepare(ctx_id=-1)  # -1 = CPU

    if _ref_embedding is None:
        arr = np.frombuffer(reference_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        faces = _app.get(img)
        if faces:
            _ref_embedding = faces[0].embedding

    if _ref_embedding is None:
        return None

    faces = _app.get(face_crop)
    if not faces:
        return None

    best = max(faces, key=lambda f: np.dot(f.embedding, _ref_embedding))
    similarity = float(np.dot(best.embedding, _ref_embedding) /
                       (np.linalg.norm(best.embedding) * np.linalg.norm(_ref_embedding)))
    return {"confidence": max(0, similarity * 100), "bounding_box": {}}
```

### Config

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
REKOGNITION_SIMILARITY_THRESHOLD=90.0    # minimum confidence to accept match
```

---

## 3. Obstacle Detection

**File:** `server/navigation/obstacle_avoidance.py`

Currently a stub that always returns `None`. The interface is preserved so a proper detection backend can be dropped in later.

### Interface

```python
def detect_obstacles(frame: np.ndarray) -> Optional[Dict]:
    """
    Returns:
      - {"direction": str, "intensity": float, "duration_ms": int} to avoid
      - {"direction": ..., "reroute": True} to avoid AND trigger route replanning
      - None if path is clear
    """
```

### How to implement

Replace the stub with a depth estimation or object detection model:

```python
def detect_obstacles(frame: np.ndarray) -> Optional[Dict]:
    depth_map = estimate_depth(frame)  # your depth model (MiDaS, ZoeDepth, etc.)
    h, w = depth_map.shape
    center_depth = depth_map[h//3:2*h//3, w//3:2*w//3].mean()

    if center_depth < 5.0:  # obstacle within 5 meters
        left_depth = depth_map[:, :w//3].mean()
        right_depth = depth_map[:, 2*w//3:].mean()
        return {
            "direction": "left" if left_depth > right_depth else "right",
            "intensity": 0.7,
            "duration_ms": 600,
            "reroute": True,
        }
    return None
```

---

## 4. Approach Control

**File:** `server/identification/approach.py`

Converts bounding box position to movement commands. Not ML-based, but tuneable.

### Interface

```python
def compute_approach_command(
    bbox: list,              # [x1, y1, x2, y2]
    frame_width: int,
    frame_height: int,
) -> Dict:
    """
    Returns:
      - {"arrived": True} if person fills >15% of frame
      - {"direction": str, "intensity": float, "duration_ms": int} otherwise
    """
```

### Parameters

| Constant | Default | Description |
|----------|---------|-------------|
| `ARRIVAL_AREA_THRESHOLD` | 0.15 | Person bbox area fraction to trigger delivery |
| `CENTER_DEAD_ZONE` | 0.15 | Fraction of frame center where no correction is applied |

---

## 5. Dashboard Detect Mode

The dashboard at `/dashboard` has a **Detect** toggle that runs person detection + face matching outside of any mission state. This is useful for testing.

### How it works

1. Dashboard sends `{"type": "toggle_detect"}` via WebSocket
2. Server sets `detect_enabled = True` on `ConnectionManager`
3. On every 10th frame (to preserve FPS), `_process_detect_only()` runs:
   - YOLOv8 person detection in a thread executor
   - If a reference photo is available, each YOLO crop is sent to Rekognition
   - Results cached and reused for intermediate frames
4. Detections broadcast to dashboard as metadata (green = matched, red = unmatched)

### Reference photo flow

- Phone sends `{"type": "reference_photo", "photo": "<base64>"}` on upload or stream start
- Server stores bytes in `ConnectionManager.reference_photo_bytes`
- Dashboard metadata includes `has_reference: true/false` for status display

---

## Pipeline Flow (ws_handler.py)

### NAVIGATION state (`_process_navigation`)
```
1. Check if within IDENTIFICATION_RANGE_M of destination -> switch to IDENTIFICATION
2. Check if within WAYPOINT_REACHED_RADIUS_M of current waypoint -> advance
3. Run detect_obstacles(frame) -> currently returns None (stub)
4. compute_navigation_command() toward next waypoint
```

### IDENTIFICATION state (`_process_identification`)
```
1. Run YOLOv8 on frame -> person detections (in thread executor)
2. If no persons: rotate slowly to scan
3. For each person:
   a. Crop face region from bbox
   b. compare_face(reference, crop) -> confidence
   c. If confidence >= threshold: transition to APPROACH
4. If no match: keep rotating
```

### APPROACH state (`_process_approach`)
```
1. Run YOLOv8 on frame -> person detections (in thread executor)
2. Re-match each person against reference photo via Rekognition
3. Track best match by confidence
4. If lost (no match): fall back to IDENTIFICATION
5. compute_approach_command(bbox, frame_size) -> command
6. If arrived: transition to DELIVERY + hover
```

### Detect-only mode (`_process_detect_only`)
```
1. Skip unless Nth frame (every 10th, configurable)
2. Run YOLOv8 on frame -> person detections (in thread executor)
3. If reference photo available:
   a. Crop each detection
   b. compare_face(reference, crop) -> confidence
   c. Mark as matched if above threshold
4. Cache results for intermediate frames
```

---

## Performance Notes

- **YOLOv8 nano** is ~20-50ms on CPU, ~5-10ms on GPU
- **AWS Rekognition** adds ~200-500ms per API call (network latency)
- Dashboard detect mode runs every 10th frame (~1 detect/sec at 10fps input) to preserve stream FPS
- All inference runs in thread executors (`run_in_executor`) to avoid blocking the async event loop
- At 10fps input, mission states (IDENTIFICATION/APPROACH) have ~100ms budget per frame for YOLO; Rekognition runs async per detection
