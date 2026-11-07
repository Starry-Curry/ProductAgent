# ViTTrack browser adaptation

Model: OpenCV Zoo `object_tracking_vittrack_2023sep.onnx`, Apache-2.0.
Pinned revision and SHA-256: see provenance.json. Original LICENSE is included.

Preprocessing and decoding adapted from OpenCV `tracker_vit.cpp`, author Pengyu Liu:
https://github.com/opencv/opencv/blob/6d381e029fe26248675f48b2d44df23f4f288d11/modules/video/src/tracking/tracker_vit.cpp

The TypeScript port uses ONNX Runtime Web, canvas cropping and bounded ROI sizes.
It retains template/search normalization, Hann window, confidence map and box
decoding. Source includes OpenCV's bounds fix; this implementation also rejects
nonfinite, implausible or oversized crops instead of allocating unbounded images.
No categories, demonstration coordinates, or saved cloud answers are embedded.

This is a visual tracker initialized by a cloud/user box, not a semantic detector
or proof of correct real-world operation. Scores are not calibrated accuracy.
