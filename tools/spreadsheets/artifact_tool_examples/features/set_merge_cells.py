from pathlib import Path

from artifact_tool import FileOutputType, SpreadsheetArtifact


def main() -> None:
    spreadsheet = SpreadsheetArtifact("Scores")
    sheet = spreadsheet.create_sheet("MonsterBattle")

    sheet.range("B2:D2").set_values([["Monster", "Level", "Info"]])
    sheet.range("B3:D4").set_values(
        [["Lizardman", "100", "Fire type"], ["Hydra", "90", "Water type"]]
    )

    B5_to_D5_range = sheet.range("B5:D5")
    B5_to_D5_range.merge()

    # After merging, you can edit the value of the merged cell by either
    # updating the range itself or setting the top-left cell
    B5_to_D5_range.set_value("Winner TBD")
    sheet.cell("B5").set_value("Winner TBD V2")

    # Set formatting and styling on the merged cells.
    B5_to_D5_range.format.fill.set_solid_color("#E8E4F7")  # lavender

    # Render
    output_dir = Path(__file__).resolve().parent / "golden_rendered_images" / "set_merge_cells"
    output_path = spreadsheet.render(output=output_dir)
    print(f"Spreadsheet rendered to {output_path} up till F6")

    spreadsheet.save(
        file_type=FileOutputType.C_STAR_PROTO_JSON,
        filename=output_dir / "workbook__auto.json",
        overwrite=True,
    )

    # Export
    # output_path = spreadsheet.export()
    # print(f"Spreadsheet exported to {output_path}")


if __name__ == "__main__":
    main()
