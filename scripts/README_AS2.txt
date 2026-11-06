AS2 reviewed assets
===================
build_as2_package.py writes the reviewed exterior geometry and 12-step data package.
It performs no network/model calls; edit the reviewed data here and regenerate.
Photo/reference calibration is separately bound to input-media SHA256 files in fixtures/teaching.

run_as2_demo.py verifies demo/as2/ and creates/resumes a first-step lesson in var/as2-demo.
demo.ps1 installs locked dependencies, builds frontend and runs it on port 8021.
Use --new-session to append a lesson; it never deletes the old database.
Cloud questions and confirmations require a personal local API key. --offline previews prepared assets only.
No FFmpeg or D: private media paths are needed for the published bundle.

seed_as2_demo.py --data-dir <NEW_FOLDER> --clean-profile uses the published bundle by default.
For legacy private media supply BOTH --media-dir and --manual explicitly.
Only the user-authorized demo/as2 assets are published; private media, keys, databases and optional MiniLM weights stay local.
A clean profile refuses an existing populated database.

local_ai.py download / probe prepares the optional fixed-revision OpenVINO semantic model.
See docs/as2-guided-demo.html for device flags, code audit, database locations and boundaries.
