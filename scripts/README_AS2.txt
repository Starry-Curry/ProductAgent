AS2 reviewed assets
===================
build_as2_package.py writes the reviewed exterior geometry and 12-step data package.
It performs no network/model calls; edit the reviewed data here and regenerate.
Photo/reference calibration is separately bound to input-media SHA256 files in fixtures/teaching.

seed_as2_demo.py --data-dir <NEW_FOLDER> --manual <OFFICIAL_PDF> --clean-profile
creates a single-object profile. The original user media must exist at data/realdemo/LOKLiK_AS2.
Media/PDF/weights/databases never belong in Git. A clean profile refuses an existing populated database.

local_ai.py download / probe prepares the optional fixed-revision OpenVINO semantic model.
See docs/as2-guided-demo.html for device flags, code audit, database locations and boundaries.
