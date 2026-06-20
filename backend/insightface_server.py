"""
InsightFace HTTP-server — körs på port 5000 inuti Docker-containern.

Modellen laddas EN gång vid start och hålls i minnet av PM2.
Fastify anropar POST /analyze med en absolut filsökväg och får
tillbaka bounding-boxes + 512-dim ArcFace-embeddings.

Miljövariabler:
  INSIGHTFACE_HOME  — rot för modell-cache (default: /app/models)
                      Mappa denna som Docker Volume i Unraid för att
                      slippa ladda ner ~300 MB vid varje omstart.
  INSIGHTFACE_PORT  — port att lyssna på (default: 5000)
"""

import os
import sys
import logging

import cv2
import numpy as np
from flask import Flask, request, jsonify
from insightface.app import FaceAnalysis

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

MODEL_ROOT = os.environ.get("INSIGHTFACE_HOME", "/app/models")
PORT       = int(os.environ.get("INSIGHTFACE_PORT", "5000"))

logging.basicConfig(
    level=logging.INFO,
    format="[InsightFace] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Modell-laddning (sker EN gång vid process-start)
# ---------------------------------------------------------------------------

log.info(f"Laddar InsightFace-modell 'buffalo_l' från {MODEL_ROOT} …")
log.info("(Första start laddar ner ~300 MB — efterföljande starter är snabba)")

face_app = FaceAnalysis(
    name="buffalo_l",
    root=MODEL_ROOT,
    # CPUExecutionProvider = fungerar utan GPU.
    # Byt till CUDAExecutionProvider om NVIDIA-GPU finns i containern.
    providers=["CPUExecutionProvider"],
)

# ctx_id=-1 = CPU-läge (ctx_id=0 vore GPU device 0).
# det_size=(640, 640) ger bra balans mellan träffsäkerhet och hastighet.
face_app.prepare(ctx_id=-1, det_size=(640, 640))

log.info("Modell laddad och redo — lyssnar på port %d", PORT)

# ---------------------------------------------------------------------------
# Flask-app
# ---------------------------------------------------------------------------

app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    """Används av Fastify's waitForInsightFace() för att veta när vi är redo."""
    return jsonify({"status": "ok"})


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Tar emot: { "path": "/absolut/sökväg/till/bild.jpg" }
    Returnerar:
    {
      "face_count": 2,
      "faces": [
        {
          "region_x": 0.12,   # normaliserat (0.0–1.0) från bildens vänsterkant
          "region_y": 0.05,   # normaliserat från bildens överkant
          "region_w": 0.18,   # normaliserad bredd
          "region_h": 0.31,   # normaliserad höjd
          "embedding": [0.023, -0.412, ...]  # 512 floats (ArcFace)
        },
        ...
      ]
    }
    """
    data = request.get_json(force=True, silent=True)
    if not data or "path" not in data:
        return jsonify({"error": "JSON-body med fältet 'path' krävs"}), 400

    image_path = data["path"]

    if not os.path.isfile(image_path):
        return jsonify({"error": f"Filen hittades inte: {image_path}"}), 400

    # Läs bilden med OpenCV (BGR)
    img = cv2.imread(image_path)
    if img is None:
        return jsonify({"error": f"Kunde inte avkoda bilden: {image_path}"}), 422

    img_h, img_w = img.shape[:2]
    if img_h == 0 or img_w == 0:
        return jsonify({"error": "Bilden har ogiltiga dimensioner"}), 422

    # Kör ansiktsanalys — returnerar lista av Face-objekt
    try:
        detected = face_app.get(img)
    except Exception as exc:
        log.error("InsightFace-analys misslyckades för %s: %s", image_path, exc)
        return jsonify({"error": f"Analysfel: {str(exc)}"}), 500

    if not detected:
        return jsonify({"face_count": 0, "faces": []})

    faces_out = []
    for face in detected:
        # face.bbox = [x1, y1, x2, y2] i pixelkoordinater
        x1, y1, x2, y2 = face.bbox.astype(float)

        # Normalisera till 0.0–1.0, klipp mot bildkanter
        rx = max(0.0, min(1.0, x1 / img_w))
        ry = max(0.0, min(1.0, y1 / img_h))
        rw = max(0.0, min(1.0, (x2 - x1) / img_w))
        rh = max(0.0, min(1.0, (y2 - y1) / img_h))

        # face.embedding = numpy array med 512 floats (ArcFace-vektor)
        embedding = face.embedding.tolist() if face.embedding is not None else []

        faces_out.append({
            "region_x": round(rx, 6),
            "region_y": round(ry, 6),
            "region_w": round(rw, 6),
            "region_h": round(rh, 6),
            "embedding": embedding,
        })

    log.info("Analyserade %s — hittade %d ansikte(n)", image_path, len(faces_out))
    return jsonify({"face_count": len(faces_out), "faces": faces_out})


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # threaded=False är viktigt: InsightFace/ONNX Runtime är inte thread-safe.
    # PM2 hanterar process-övervakning och omstart vid krasch.
    # 0.0.0.0 = nåbar från andra Docker-containers på samma nätverk.
    # I produktion (PM2 i samma container) ändras detta till 127.0.0.1 via INSIGHTFACE_BIND.
    host = os.environ.get("INSIGHTFACE_BIND", "0.0.0.0")
    app.run(host=host, port=PORT, threaded=False)
