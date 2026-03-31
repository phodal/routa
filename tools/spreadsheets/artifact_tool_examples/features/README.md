## Spreadsheet Golden Images

This directory stores golden images for `SpreadsheetArtifact`.

### How to run the test
From the repo root:

```bash
pytest lib/agent/tools/artifact_tool/tests/test_golden_images.py
```

Each script will:
1. Run all of the `set_<feature>.py` scripts inside `../spreadsheets/features`. The image outputs from these runs will be stored in the respective folders in `../golden_rendered_images` folder
2. You can also uncomment the line that exports `.xlsx` file inside each of the `set_<feature>.py` scripts.
3. The pytest will fail if any of the two images are not alike (in bytes).

### Update golden images
To update the images to your newly created golden images, either run all of the pytests again:
```bash
pytest lib/agent/tools/artifact_tool/tests/test_golden_images.py
```

or run the specific test you want to see the image for (this outputs rendered images faster):
e.g.
```bash
python lib/agent/tools/artifact_tool/examples/spreadsheets/features/set_font_styles.py
```

This will output a temporary output file in each of the folders next to the golden images for comparison.
Just rename the temporary image to the new golden image file name. Anything with `golden-` will not be considered inside gitignore and can be pushed.
