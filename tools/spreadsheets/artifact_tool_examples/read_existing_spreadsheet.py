"""Example: load an existing spreadsheet and start editing it."""

from __future__ import annotations

from pathlib import Path
from pprint import pprint

from artifact_tool import SpreadsheetArtifact

FILE_PATH = "sample_xlsx/cell_style_examples.xlsx"

"""
Simple example of how to load in a spreadsheet and read some data about it.
"""


def main() -> None:
    file_path = Path(__file__).resolve().parent / FILE_PATH

    # Create a new spreadsheet artifact
    artifact = SpreadsheetArtifact.read(file_path=file_path)

    assert artifact.artifact_id == "cell_style_examples"

    # Read the artifact
    sheet_names = artifact.sheets()
    print("==Sheet names:")
    print(sheet_names)

    # Look at what exists and render it to a PNG
    first_sheet = artifact.sheet(sheet_names[0])
    assert first_sheet.name == "Cell Styles"
    rendered_sheet_path = first_sheet.render()
    print(f"Rendered sheet to {rendered_sheet_path}")

    print("\n==Summary of the spreadsheet loaded in:")
    summary = artifact.summary()
    pprint(summary)
    """
    SpreadsheetSummary(artifact_id='cell_style_examples',
                   sheets=[SpreadsheetSheetSummary(name='Cell Styles',
                                                   filled_rows=36,
                                                   filled_columns=5,
                                                   minimum_range_filled='A1:E47',
                                                   min_row_idx=1,
                                                   max_row_idx=47,
                                                   min_column_idx=1,
                                                   max_column_idx=5,
                                                   min_column_letter='A',
                                                   max_column_letter='E',
                                                   first_row_address_range='A1:E1')],
    """

    # Render just the first row
    first_row_address_range = summary.sheets[0].first_row_address_range
    assert first_row_address_range is not None
    rendered_first_row = first_sheet.range(first_row_address_range).render()
    print(f"Rendered first row to {rendered_first_row}")

    print("\n==Reading some data about cell B7")
    print(f"B7 value: {first_sheet.cell('B7').value}")
    style_summary = first_sheet.cell("B7").format_summary()
    print("B7's effective style", style_summary.effective_cell_format)
    print("B7's fill", style_summary.fill)
    print("B7's font", style_summary.font)
    print("B7's border", style_summary.border)
    print("B7's number format", style_summary.number_format)

    # Save the spreadsheet to a file
    # Model can just do artifact.save() to save to the current directory
    output_path = Path("/tmp") / f"{artifact.artifact_id}.bin"
    path = artifact.save(
        filename=output_path,  # optional, e.g. set it to Path("/home/oai/share/file.bin")
        overwrite=True,
    )

    print("\n==Saved a copy of the spreadsheet to its proto format at:")
    print(path)

    # Make sure the spreadsheet is the same as the original by reading in the proto format and comparing the dicts
    assert SpreadsheetArtifact.read(path).to_dict() == artifact.to_dict()

    # Export it back to xlsx
    exported_path = artifact.export()
    print(f"Exported spreadsheet to {exported_path}")
    assert exported_path.exists()


if __name__ == "__main__":
    main()
