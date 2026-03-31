# `SpreadsheetArtifact`
This guide describes how the artifact tool can be used to create/edit spreadsheets. It contains a summary of the main models and features.

## Import
```
from artifact_tool import SpreadsheetArtifact
from artifact_tool.spreadsheet import SpreadsheetSheet, SpreadsheetCellRangeRef, SpreadsheetCellRef

# Advanced helpers are available via dedicated submodules, e.g.:
from artifact_tool.spreadsheet.formatting import RangeFormat, RangeTextStyle, RangeNumberFormat, RangeAlignment, RangeFill, RangeBorder
from artifact_tool.spreadsheet.formatting import Underline, HorizontalAlignment, VerticalAlignment, TextWrapOption
from artifact_tool.spreadsheet.conditional_formatting import ConditionalFormatCollection, CfType
from artifact_tool.spreadsheet.tables import SpreadsheetTable
from artifact_tool.spreadsheet.charts import SpreadsheetSheetCharts
from artifact_tool.spreadsheet.types import SpreadsheetCalculationErrorType, SpreadsheetCellValueType

# Some core objects are imported from proto directly. Example:
from oaiproto.coworker.pptx.utils_pb2 import Color, Fill, PatternFill
from oaiproto.coworker.pptx.chart_pb2 import Chart, LegendPosition
from oaiproto.coworker.xlsx.spreadsheet_pb2 import Border, BorderLine, CfRule, Cfvo, ColorScale, DataBar, DifferentialFormat, IconSet
```

## Getting started
Simple example of how to create, import, render, calculate and export
```
from artifact_tool import SpreadsheetArtifact
spreadsheet = SpreadsheetArtifact.load("/path/to/file") # or SpreadsheetArtifact("NewSpreadsheet") to create an empty one
rendered_spreadsheet = artifact.render()
exported_spreadsheet = artifact.export("/path/to/file", overwrite=True)
```

## Models

### Main Models

```
SpreadsheetArtifact                 # Represents a single workbook file
├─ SpreadsheetSheet                 # Represents a sheet in a workbook
│  └─ SpreadsheetCellRef            # Represents a cell in a sheet, e.g. "A1"
│  └─ SpreadsheetCellRangeRef       # Represents a cell range in a sheet, e.g. "A1:B2"
```

Creating a new spreadsheet

```
from artifact_tool import SpreadsheetArtifact

# Creating a new spreadsheet
artifact = SpreadsheetArtifact("Workbook1")
sheet = artifact.sheet("Start")             # SpreadsheetSheet
A1_cell = sheet.cell("A1")                  # SpreadsheetCellRef
A2_B2_range = sheet.range("A2:B2")          # SpreadsheetCellRangeRef

A1_cell.value = 4
A2_B2.values = [[5, "vicky"]]
sheet.cell("A3").formula = "=A1+5"
```

Importing from an existing xlsx

```
# Loading in an existing xlsx
artifact = SpreadsheetArtifact.load("/path/to/file.xlsx")

# Get a summary
summary = artifact.summary()
num_sheets = len(summary.sheets)

# Iterate through the sheets and look at the data
existing_sheet_names = artifact.sheets()
sheets = []
for sheet_name in existing_sheet_names:
   sheet = artifact.sheet[sheet_name]
   sheets.append(sheet)
   range = sheet.minimum_range()
   range.values       # Read all values
   range.formulas     # Read all formulas
   range.data         # Read either formula or value

   # Analyze/do something with data

# Create a new sheet with more analytics
analytics_sheet = artifact.create_sheet("analaytics")
analytics_sheet.range("A1:C1").set_values([["Source", "Summary", "Rating"]])

# ...

```

### Virtual range references

Each `Ref` classes (`SpreadsheetCellRef`, `SpreadsheetCellRangeRef`) are models that enable easier edit and read cells and ranges within a sheet, and are sub-classes of `VirtualRangeRef`, which provides many unified functions like:

```
# Values
ref.set_value()                  # Set all cells's values to the same value where None is considered clearing
ref.set_values()                 # Set all cells' values to a 2D matrix of values
ref.values =                     # Setter (same as set_values())
ref.get_values()                 # Gets 2D array of values (list[list[SpreadsheetCellValueType]])
ref.values                       # Getter (same as get_values())

# Rich text
ref.set_rich_text()              # Set inline rich text runs for each cell in the range

# Formulas
ref.set_formula()                # Set all cell's formula to the same formula, where "" is considered clearing
ref.formulas =                   # Setter, (same as set_formulas())
ref.get_formulas()               # Get 2D array of formulas for the given cells (list[list[str]])
ref.formulas                     # Getter (same as get_formulas)

# Data (formula or value)
ref.get_data()                  # Returns 2D array of either formula, if set, or the value of the cells.

# Styling
ref.format                       # Returns a `RangeFormat` for this range - more methods here
ref.conditional_formats          # Returns a `ConditionalFormatCollection` for this range - more methods here
ref.render()                     # Renders this range as an image and returns path to that image

```

See `cell_range_ref.py` for all the functions.
If you're the LLM, look at `artifact_tool_spreadsheets_api.md` for the list of relevant methods, signatures and inputs available.

The models it uses and returns are defined in:

```
models/
 └─ spreadsheets/              # More Spreadsheet models
   └─ cell_format_summary.py   # Dataclasses to more easily read a cell format
   └─ cell_range_ref.py        # Contains VirtualRangeRef, with .set_values, .set_formulas
   └─ conditional_format.py    # Model to add/view conditional formattings to a sheet
   └─ format.py                # Model set cells/ranges formats (e.g. bold, fill, number)
```

### Values
We support the follow value types: bool, int, float, datetime, str. Any "number-like" object,
including implementations of `numbers.Real`, `numbers.Integral`, [`decimal.Decimal`](https://docs.python.org/3/library/decimal.html),
[`typing.SupportsInt`](https://docs.python.org/3/library/typing.html#typing.SupportsInt), or
[`typing.SupportsFloat`](https://typing.readthedocs.io/en/latest/spec/protocol.html#typing-supportsfloat), is automatically
converted to the appropriate native Python scalar. This means values such as NumPy integer or floating scalars
(`numpy.int64`, `numpy.float64`), `Decimal` instances, or custom classes that implement `__int__`/`__float__` all work without
any additional handling when provided as cell values.

It is represented in the type alias `SpreadsheetCellValueType` in  `artifact_tool/types/spreadsheet_types.py`


### Rich text
Call `set_rich_text` on a cell or range to author inline rich text. Provide either a list of run specs for a single cell or a matrix for multi-cell ranges. Each run spec uses the following keys:

- `t` (required): the text for the run
- `b`: bold (bool)
- `i`: italic (bool)
- `u`: underline string, e.g. `"single"` or `"double"`
- `fs`: font size in points
- `c`: font color in `"#RRGGBB"` (or `AARRGGBB`) format

Example:

```
sheet.cell("A1").set_rich_text(
    [
        {"t": "prefix "},
        {"t": "bold", "b": True},
        {"t": " and "},
        {"t": "big red", "fs": 24, "c": "#FF0000"},
        {"t": " with underline", "u": "single"},
    ]
)
```

Advanced callers can also pass existing `TextRun`/`TextStyle` protos or include additional `TextRun` fields such as `id` or `hyperlink`.


### Formulas
Formulas are set on cell(s) or ranges by first fetching the cell or range and doing using the `.formula` setter. Formulas start with "=" and should be set to formulas actually supported by Excel (e.g. `"=SUM(A1:B1)"`). In order to read the calculated results and verify the work, however, only a subset of all formulas are supported in artifact_tool calculation engine (~400 functions). We support calculating most common Excel spreadsheet functions, but not all. However, even if unsupported, the formula (if it's officially supported by Excel) can still be stored and exported to XLSX.

When you set a cell's formula to a value that is not supported by the engine, but is a valid Excel formula,
the cell's value will be set to the error message (e.g. "#NAME?"), which indicates the formula function is not supported.
Upon export to XLSX and opening in Excel, the cell properly calculates.

To see the full list of supported functions for calculations, see: `artifact_tool_spreadsheet_formulas.md`

To check on if there's a calculation error:
- SpreadsheetCellRef.is_calculation_error() to check if the cell's value is an error.
- SpreadsheetCellRef.get_calculation_error_message() to get the error message if it is an error.


If the cell's value is NOT a calculation error, the value will be the result of the formula post-calculation,
unless the cell was set with recalculate=False

Example: sheet.set_cell(address, value, recalculate=False).


```
spreadsheet = SpreadsheetArtifact("MySpreadsheet")
first_sheet = spreadsheet.sheet("FirstSheet")

A1 = first_sheet.cell("A1")
range = first_sheet.range("A2:C2")

A1.formula = "=1+2"
range.formulas = [["=1+2", "=2+3", "=SUM(A2:B2)"]]
```

Known formulas currently not supported for calculation (they are supported in the resulting xlsx):
See artifact_tool_spreadsheet_formulas.md


Relative named expressions
Functions cannot use UI metadata (e.g., hidden rows for SUBTOTAL).


<b>Limitations on `=TEXT(A1, <format string>)` formula function</b>

Not all formatting options are supported,
e.g., only some date formatting options: (hh, mm, ss, am, pm, a, p, dd, yy, and yyyy).

No currency formatting inside the TEXT function.

Allowed: `=TEXT(A1,"dd-mm-yy")`

#### Errors in formulas
On a cell, you can see if there was a calculation error:
```
cell.is_calculation_error() # returns bool
cell.get_calculation_error_message()  # returns error msg or none

# You may also just get all values of a range and you may see an error directly
range.values      # 2D array of values
```

You can tell if a value is an error via `SpreadsheetCalculationErrorType.is_calculation_error(value)` and they typically start with `"#"` and end with `'?'` or `!'`, e.g. `"#N/A"` (value not available) or `"#NAME?"` (function not supported)

### Cell references in Formulas
Formulas may reference other cells, e.g.
```
A1.formula = "=A1+B2"
```

#### We support the following types of references:
1. Relative: `=A1` in current sheet or `='Sheet2'!A1` for A1 in Sheet2
2. Absolute: `=$A$1`	or `=Sheet2!$A$1`
3. Mixed: `=$A1` or `=Sheet2!$A1`
4. Range	`=A1:B2` or `=Sheet2!A1:B2`

When referencing cells or ranges from different sheets, you can specify the sheet name using the following syntax:

`=SheetName!CellReference`
If a sheet name contains any character other than [A-Za-z\u00C0-\u02AF0-9_], it must be enclosed in single quotes. E.g.:
`='My Sheet'!A1`

#### References not supported
- You can't mix two different types of range references together (=A1:B).
- Named expressions
- Multi-cell range references (=A1:B2:C3).

### Reading

The main models contains a lot of helper functions to read data on the spreadsheet. `spreadsheets_api.md` contains all methods.

For example:

```
# Returns a summary of the sheet including the min/max row/column with data
sheet.summary()

# Returns the cell's value/formula/style indices
cell.value
cell.formula
cell.style_index
cell.data

# Returns the range's values/formulas/style indices
range.values()
range.formulas()
range.style_indices
range.get_data()
```

## Styling

We support the following styling features:

- Cell formatting: See `VirtualRangeRef.format()` and `RangeFormat`
  - Use this to set a cell(s)' text style (e.g. font, underline), fill, number format, border, alignment (vertical or horizontal), etc.
  - You can also set wrap text for when content is cut off
- Conditional Formatting: You can create a conditional formatting for a range in a sheet
  - Fetch the conditional formatting collection via
    - `cf_collection = range.conditional_formatting`
    - `cd_collection.add(...)`
  - To view all conditional formatting on a sheet, see `SpreadsheetSheet.get_conditional_formatting()`
  - To delete a conditional formatting, you must do it on the sheet `SpreadsheetSheet.delete_conditional_formatting()`
- Merge / Unmerge cells: Via `merge()` and `unmerge()` on the virtual ref ranges
  - Helper methods for reading exists like `is_merged()` and `has_merged_cells()`
- Setting column widths
  - `SpreadsheetSheet.set_column_widths("A:C", 30)` sets a single width to the provided columns
  - `SpreadsheetSheet.set_column_widths_bulk({"B:D": 100, "F": 150})` sets the widths to the provided columns, taking in a dictionary
  - `SpreadsheetSheet.get_column_width("B")`: gets the column width for a given address
  - `SpreadsheetSheet.default_col_width` returns the default column width for all columns in the sheet
  - `SpreadsheetSheet.set_sheet_styles(default_col_width: 20)` to set the default column width
- Setting row heights
  - `SpreadsheetSheet.default_row_height`
  - `SpreadsheetSheet.set_row_height(5, 20)` to set the row height for a single row index
  - `SpreadsheetSheet.set_row_heights(1, 3, 20)` to set the row height to 20 for all rows from row 1 to 3
  - `SpreadsheetSheet.set_row_heights_bulk(...)` to set the row height for different rows, taking in a dictionary.
  - `SpreadsheetSheet.set_sheet_styles(default_row_height:10)` to set the default row width
- Setting up grid lines
  - `SpreadsheetSheet.show_grid_lines` returns if grid lines are showing
  - `SpreadsheetSheet.show_grid_lines = <bool>` sets it

### Cell formatting

```
spreadsheet = SpreadsheetArtifact.read("/path/to/file.xlsx")
A1_to_C5 = spreadsheet.sheet("FirstSheet").range("A1:C5")

# Wrap all text here
A1_to_C5.format.wrap()                                      # Set wrap text to "wrap" mode
A1_to_C5.format.unwrap()                                    # Set wrap text to "auto" mode
A1_to_C5.format.wrap_text = TextWrapOption.WRAP

# Set text style
A1_to_C5.format.text_style                                  # returns RangeTextStyle
A1_to_C5.format.text_style.bold = True                      # bolds all cells in the range
A1_to_C5.format.text_style.font_size = 13                   # set font size to 13
A1_to_C5.format.text_style.font_size                        # read font size
# Set a bunch of fields for text style
A1_to_C5.format.text_style.set(bold=True, font_size=13, font_face=FontFace(typeface="Calibri", scheme="minor", family=2))

# Set borders
A1_to_C5.format.borders                                     # returns RangeBorder
A1_to_C5.format.borders.left = BorderLine(style="thin")     # set left border to be thin
A1_to_C5.format.borders.left                                # read left border

# Set fills
A1_to_C5.format.fill                                        # returns RangeFill
A1_to_C5.format.fill.set_solid_color("#797979")             # sets the fill for all cells in the range
A1_to_C5.format.fill.color                                  # read the color

# Set alignment
A1_to_C5.format.alignment                                   # returns RangeAlignment
A1_to_C5.format.alignment.vertical = VerticalAlignment.TOP  # sets vertical alignment to top

# Set number format
A1_to_C5.format.number_format                               # returns RangeNumberFormat
A1_to_C5.format.number_format.format_code = "m/d/yy"        # sets the date format
A1_to_C5.format.number_format.format_code                   # read format code
```

See `artifact_tool_examples` directory for more examples.
`styling_spreadsheets.py` is a good place to start, but
`features` directory contains examples of how to do specific features like setting cell borders, etc.

### To understand what styling a cell/range has

Styling in spreadsheets is evaluated based on order-of-operations and you may have overlapping
styling. Conditional formatting also takes precedence over normal cell style formatting when the
condition evaluates to true. If you want to see how things are styled, use `render()` functions
to actually view them.

If you just want to see what cell styling cell has, you may use `CellFormatSummary` but
note it may not be what is rendered if there is a conditional formatting applied.
This is why `render()` is recommended.

```
# Render to see how it looks
artifact.render()
sheet.render()
range.render()

# Read cell-level formatting settings.
format_for_range.format_summary()
```

## Tables

On a `SpreadsheetSheet` instance, you have the following methods to help you view, get, add and delete tables:

- `tables()`
- `get_table()`
- `add_table()`
- `delete_table()`

## Charts

We provide the `SpreadsheetSheet#charts` property to interact with charts for a sheet.

- Iterate through existing charts: `for chart in sheet.charts: ...`
- Get a specific chart: `sheet.charts.get(id="id-123anbs")` / `sheet.charts[0]`
- Delete a specific chart: `sheet.charts.delete(id="id123ansb")` / `del sheet.charts[0]`
- Create a new chart: `sheet.charts.add(...)`

### Creating a new chart

```python
from oaiproto.coworker.pptx.chart_pb2 import Chart, LegendPosition

...

# Set up some ranges to use as labels (categories) and values for the charts
labels = sheet.range("A2:A5")
values1 = sheet.range("B2:B5")
values2 = sheet.range("C2:C5")

# Add a vertical bar chart to the cell range E2:I14
chart1 = sheet.charts.add(
   sheet.range("E2:I14"),
   Chart.ChartType.CHART_TYPE_BAR,
   title="Chart Title",
)
chart1.add_series("Series 1 Title", categories_range=labels, values_range=values1)
chart1.add_series("Series 2 Title", categories_range=labels, values_range=values2)

# Show the legend and position it to the right
chart1.legend.visible = True
chart1.legend.position = LegendPosition.LEGEND_POSITION_RIGHT
```

See examples for specifics on building different chart types.

## Pivot Tables

We allow viewing existing pivot tables (by rendering the sheet). However, editing them or creating new one's is not currently supported.

## Data Tables

Currently not supported. Thus, if you set a formula to be `=TABLE(row_input_cell, column_input_cell)` it will not render properly and produce `#VALUE!` or `#N/A` errors

## Not Supported / Limitations

- Structured references ("Tables" or data tables), e.g. `=TABLE()`
- 3D references
- Constant or dynamic arrays
- Asynchronous functions


## Code Examples

Below is a quick script to get started but look at `artifact_tool_examples` directory for specifics:

```
# Create spreadsheet
spreadsheet = SpreadsheetArtifact()
sheet1 = spreadsheet.sheets("sheet1")  # SpreadsheetSheet
B2 = sheet1.cell("B2")                 # SpreadsheetCellRef
A1_B2 = sheet1.range("A1:B2")          # SpreadsheetCellRangeRef

# Set and get
A1_B2.values = [["Name", "Age"], ["Vicky", 1]]
B2.value # 1

# Render and export
output_image_file = spreadsheet.render()
output_xlsx = spreadsheet.export()

# For imports
spreadsheet_imported = SpreadsheetArtifact.read("/path/to/file.xlsx")
```

### API Spec

The full API is specified in `artifact_tool_spreadsheet_api.md` which contains all the possible functions for all classes.
