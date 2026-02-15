# AI Inference Integration Guide

This document explains how to plug in custom AI models for person detection, face matching, obstacle detection, and segmentation. Each component has a clean interface — swap the implementation without changing the pipeline.

---

## Architecture

The frame processing pipeline runs in `server/ws_handler.py`. Each frame flows through different processing stages depending on the current state:

```
Phone frame (JPEG) → decode → state router
                                  │
                    ┌─────────────┼─────────────────┐
                    ▼             ▼                  ▼
              NAVIGATION    IDENTIFICATION       APPROACH
                    │             │                  │
              ┌─────┘       ┌─────┘            ┌─────┘
              ▼             ▼                  ▼
        GPS waypoint   SAM masks          SAM masks
        following      → person_detector   → person_detector
              │        → face_matcher      → face_matcher
              ▼             │              → approach_command
        obstacle_detect     ▼                  │
        (optional)     match found?            ▼
              │             │             bbox tracking
              ▼             ▼                  │
        movement cmd   transition to       movement cmd
                       APPROACH            or "arrived"
```

### Key files

| File | Role |
|------|------|
| `server/ws_handler.py` | Frame pipeline — calls each component |
| `server/models/sam_loader.py` | SAM model loading & mask generation |
| `server/identification/person_detector.py` | Filters SAM masks for person shapes |
| `server/identification/face_matcher.py` | Compares face crops to reference photo |
| `server/identification/approach.py` | Bbox → movement commands |
| `server/navigation/obstacle_avoidance.py` | Pluggable obstacle detection backends |
| `server/config.py` | All tuneable parameters (.env) |

---

## 1. Segmentation (SAM)

**File:** `server/models/sam_loader.py`

The `SAMInference` class wraps Facebook's Segment Anything Model. It generates masks for every distinct region in a frame.

### Interface

```python
class SAMInference:
    def load(self) -> None:
        """Load model at startup. Called once."""

    def generate_masks(self, image: np.ndarray) -> List[Dict]:
        """
        Args:
            image: BGR numpy array (H, W, 3)

        Returns:
            List of mask dicts, each containing:
              - 'segmentation': bool array (H, W)
              - 'area': int (pixel count)
              - 'bbox': [x, y, w, h]
              - 'predicted_iou': float
              - 'stability_score': float
        """
```

### Current implementation

- **Model:** SAM ViT-B (`sam_vit_b_01ec64.pth`, 358 MB)
- **Generator params:** `points_per_side=16`, `pred_iou_thresh=0.86`, `stability_score_thresh=0.92`, `min_mask_region_area=500`
- **Device:** CUDA with CPU fallback

### How to replace

To use a different segmentation model (e.g., SAM2, FastSAM, YOLO-Seg), edit `sam_loader.py` and keep the same return format. The rest of the pipeline only cares about the mask dict shape.

```python
# Example: replace with FastSAM
class SAMInference:
    def load(self):
        from ultralytics import YOLO
        self._model = YOLO("FastSAM-x.pt")
        self._loaded = True

    def generate_masks(self, image: np.ndarray) -> List[Dict]:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = self._model(rgb, retina_masks=True)
        masks = []
        for r in results:
            for i, mask in enumerate(r.masks.data):
                seg = mask.cpu().numpy().astype(bool)
                bbox = r.boxes.xywh[i].cpu().numpy().tolist()
                masks.append({
                    "segmentation": seg,
                    "area": int(seg.sum()),
                    "bbox": bbox,
                    "predicted_iou": float(r.boxes.conf[i]),
                    "stability_score": float(r.boxes.conf[i]),
                })
        masks.sort(key=lambda x: x["area"], reverse=True)
        return masks
```

### Config

```env
SAM_MODEL_TYPE=vit_b          # vit_b | vit_l | vit_h
SAM_CHECKPOINT_PATH=models/sam_vit_b_01ec64.pth
SAM_DEVICE=cuda               # cuda | cpu
```

---

## 2. Person Detection

**File:** `server/identification/person_detector.py`

Filters SAM masks into person candidates using shape heuristics. Called during `IDENTIFICATION` and `APPROACH` states.

### Interface

```python
def detect_persons(
    frame: np.ndarray,       # BGR image (H, W, 3)
    masks: List[Dict],       # SAM mask dicts
) -> List[Dict]:
    """
    Returns list of person detections:
      - 'bbox': [x1, y1, x2, y2] pixel coordinates
      - 'area': int
      - 'mask': bool array (H, W)
      - 'confidence': float (0-1)
    """
```

### Current implementation (heuristic)

Filters on:
- **Aspect ratio:** 1.2–5.0 (people are taller than wide)
- **Area:** 1–60% of frame
- **Height:** at least 10% of frame height
- **Width:** at most 50% of frame width
- **Color variance:** HSV hue standard deviation (rejects uniform sky/grass)

Confidence is a heuristic score based on how well the mask fits expected person proportions.

### How to replace with a real detector

For better accuracy, replace the heuristic filter with YOLO, Detectron2, or any object detector:

```python
# Example: YOLO person detection (ignores SAM masks entirely)
from ultralytics import YOLO

_model = None

def detect_persons(frame: np.ndarray, masks: List[Dict]) -> List[Dict]:
    global _model
    if _model is None:
        _model = YOLO("yolov8n.pt")

    results = _model(frame, classes=[0])  # class 0 = person
    persons = []
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
            persons.append({
                "bbox": [int(x1), int(y1), int(x2), int(y2)],
                "area": int((x2 - x1) * (y2 - y1)),
                "mask": None,
                "confidence": float(box.conf[0]),
            })
    persons.sort(key=lambda p: p["confidence"], reverse=True)
    return persons
```

If you use a dedicated person detector, you can also skip SAM entirely during identification — just don't call `sam.generate_masks()` in `ws_handler.py`.

---

## 3. Face Matching

**File:** `server/identification/face_matcher.py`

Compares a cropped face region against the reference photo to identify the target person. Called for each person candidate during `IDENTIFICATION` and `APPROACH`.

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

Uses **AWS Rekognition** `CompareFaces` API. Requires AWS credentials.

### How to replace with local inference

To avoid AWS dependency, use a local face recognition model:

```python
# Example: InsightFace (local, no cloud)
import insightface
from insightface.app import FaceAnalysis

_app = None
_ref_embedding = None

def _get_app():
    global _app
    if _app is None:
        _app = FaceAnalysis(allowed_modules=["detection", "recognition"])
        _app.prepare(ctx_id=0)  # 0 = GPU, -1 = CPU
    return _app

def set_reference(reference_bytes: bytes):
    """Call once when mission starts to cache reference embedding."""
    global _ref_embedding
    arr = np.frombuffer(reference_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    app = _get_app()
    faces = app.get(img)
    if faces:
        _ref_embedding = faces[0].embedding

def compare_face(reference_bytes: bytes, face_crop: np.ndarray) -> Optional[Dict]:
    global _ref_embedding
    if _ref_embedding is None:
        set_reference(reference_bytes)
    if _ref_embedding is None:
        return None

    app = _get_app()
    faces = app.get(face_crop)
    if not faces:
        return None

    best = max(faces, key=lambda f: np.dot(f.embedding, _ref_embedding))
    similarity = float(np.dot(best.embedding, _ref_embedding) /
                       (np.linalg.norm(best.embedding) * np.linalg.norm(_ref_embedding)))
    confidence = max(0, similarity * 100)  # scale to 0-100

    return {"confidence": confidence, "bounding_box": {}}
```

### Config

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
REKOGNITION_SIMILARITY_THRESHOLD=90.0    # minimum confidence to accept match
```

---

## 4. Obstacle Detection

**File:** `server/navigation/obstacle_avoidance.py`

Pluggable backend system for detecting obstacles during `NAVIGATION`. Disabled by default.

### Interface

```python
# Backend signature
def my_detector(
    frame: np.ndarray,       # BGR image (H, W, 3)
    masks: List[Dict],       # SAM masks (may be empty if SAM disabled)
) -> Optional[Dict]:
    """
    Returns:
      - {"direction": str, "intensity": float, "duration_ms": int} to avoid
      - {"direction": str, "intensity": float, "duration_ms": int, "reroute": True}
        to avoid AND trigger route replanning from current GPS position
      - None if path is clear
    """
```

### Registering a backend

```python
from navigation.obstacle_avoidance import register_backend

def my_depth_obstacle_detector(frame, masks):
    # Run depth estimation
    depth_map = estimate_depth(frame)  # your depth model
    center_depth = depth_map[h//3:2*h//3, w//3:2*w//3].mean()

    if center_depth < 5.0:  # obstacle within 5 meters
        # Find clearest direction
        left_depth = depth_map[:, :w//3].mean()
        right_depth = depth_map[:, 2*w//3:].mean()
        direction = "left" if left_depth > right_depth else "right"
        return {
            "direction": direction,
            "intensity": 0.7,
            "duration_ms": 600,
            "reroute": True,  # trigger OSRM reroute from current position
        }
    return None

register_backend("depth", my_depth_obstacle_detector)
```

### Built-in placeholder

There's an HSV sky-detection backend (`_hsv_sky_detector`) included as an example but **not registered by default**. To enable it:

```python
from navigation.obstacle_avoidance import register_backend, _hsv_sky_detector
register_backend("hsv_sky", _hsv_sky_detector)
```

### Rerouting

When a backend returns `"reroute": True`, the pipeline calls `_reroute_from_current_position()` in `ws_handler.py`, which gets fresh OSRM waypoints from the drone's current GPS to the destination and replaces the remaining route.

### Config

```env
OBSTACLE_DETECTION_ENABLED=false   # set to true to enable
```

Constants in `config.py`:
- `OBSTACLE_CENTER_THRESHOLD = 0.3` — fraction of frame center considered "in path"
- `OBSTACLE_MIN_AREA_FRACTION = 0.05` — minimum segment area to count as obstacle

---

## 5. Approach Control

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

### Tuning

- **Increase `ARRIVAL_AREA_THRESHOLD`** to make the drone get closer before delivering
- **Decrease `CENTER_DEAD_ZONE`** for more precise centering (may cause oscillation)
- Movement intensity scales with the offset from center (capped at 0.8)

---

## 6. Navigation Commands

**File:** `server/navigation/commander.py`

Converts GPS positions to drone movement commands via bearing computation.

### Interface

```python
def compute_navigation_command(
    current_lat: float, current_lng: float,
    target_lat: float, target_lng: float,
) -> Dict:
    """
    Returns: {"direction": str, "intensity": float}
    Directions: "forward", "rotate_cw", "rotate_ccw"
    """
```

### Config

```env
WAYPOINT_REACHED_RADIUS_M=10.0    # meters to consider waypoint reached
IDENTIFICATION_RANGE_M=50.0       # meters from destination to switch to identification
```

---

## Pipeline Flow (ws_handler.py)

Here's exactly where each component is called:

### NAVIGATION state (`_process_navigation`)
```
1. Check if within IDENTIFICATION_RANGE_M of destination → switch to IDENTIFICATION
2. Check if within WAYPOINT_REACHED_RADIUS_M of current waypoint → advance
3. If OBSTACLE_DETECTION_ENABLED:
   a. Run SAM on frame
   b. Run obstacle backend on (frame, masks)
   c. If obstacle found: send avoidance command, optionally reroute
4. Else: compute_navigation_command() toward next waypoint
```

### IDENTIFICATION state (`_process_identification`)
```
1. Run SAM on frame → masks
2. detect_persons(frame, masks) → person candidates
3. If no persons: rotate slowly to scan
4. For each person:
   a. Crop face region from bbox
   b. compare_face(reference, crop) → confidence
   c. If confidence >= threshold: transition to APPROACH
5. If no match: keep rotating
```

### APPROACH state (`_process_approach`)
```
1. Run SAM on frame → masks
2. detect_persons(frame, masks) → person candidates
3. Re-match each person against reference photo
4. Track best match by confidence
5. If lost (no match): fall back to IDENTIFICATION
6. compute_approach_command(bbox, frame_size) → command
7. If arrived: transition to DELIVERY + hover
```

---

## Quick Start: Minimal Local Setup

To run without AWS credentials using local models:

```bash
# 1. Install dependencies
pip install insightface onnxruntime-gpu ultralytics

# 2. Replace face_matcher.py with InsightFace (see section 3)

# 3. Optionally replace person_detector.py with YOLO (see section 2)

# 4. Configure .env
SAM_DEVICE=cpu          # or cuda if you have GPU
OBSTACLE_DETECTION_ENABLED=false
REKOGNITION_SIMILARITY_THRESHOLD=70.0   # lower for local models

# 5. Start server
python main.py
```

---

## Performance Notes

- **SAM on CPU** takes ~2-4s per frame. On CUDA it's ~200ms. Consider FastSAM (~30ms) if latency matters.
- **YOLO person detection** is ~10ms on GPU, ~50ms on CPU — much faster than SAM + heuristic filtering.
- If you replace person detection with YOLO, you can skip SAM during `IDENTIFICATION` and `APPROACH` entirely for major speedup.
- The frame pipeline runs synchronously per frame. At 10 fps input, you have ~100ms budget per frame for all inference.
- SAM inference runs in a thread executor (`run_in_executor`) to avoid blocking the async event loop.
