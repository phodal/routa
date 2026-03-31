# Artifact Tool: Supported Spreadsheet Formulas

These are the set of formulas that are supported or unsupported in artifact_tool for recalculation. Even if the function is unsupported, you may still set a cell's formula to that function, but it will not calculate properly and instead produce an error like #NAME? or #ERROR? but upon export, it may still work.

*Generated on 01/26/2026 at 04:23 +0000*

Number of formulas: 520 (Implemented: 450, Not implemented: 70)

| Function Name | Category | Description | Implemented |
|---|---|---|---|
| ABS | Math and trigonometry | Returns the absolute value of a number | Yes |
| ACCRINT | Financial | Returns the accrued interest for a security that pays periodic interest | Yes |
| ACCRINTM | Financial | Returns the accrued interest for a security that pays interest at maturity | No |
| ACOS | Math and trigonometry | Returns the arccosine of a number | Yes |
| ACOSH | Math and trigonometry | Returns the inverse hyperbolic cosine of a number | Yes |
| ACOT | Math and trigonometry | Returns the arccotangent of a number | Yes |
| ACOTH | Math and trigonometry | Returns the hyperbolic arccotangent of a number | Yes |
| ADDRESS | Lookup and reference | Returns a reference as text to a single cell in a worksheet | Yes |
| AGGREGATE | Math and trigonometry | Returns an aggregate in a list or database | Yes |
| AMORDEGRC | Financial | Returns the depreciation for each accounting period by using a depreciation coefficient | No |
| AMORLINC | Financial | Returns the depreciation for each accounting period | No |
| AND | Logical | Returns TRUE if all of its arguments are TRUE | Yes |
| ARABIC | Math and trigonometry | Converts a Roman number to Arabic, as a number | Yes |
| AREAS | Lookup and reference | Returns the number of areas in a reference | No |
| ARRAYTOTEXT | Text | Returns an array of text values from any specified range | Yes |
| ASC | Text | Changes full-width (double-byte) English letters or katakana within a character string to half-width (single-byte) characters | No |
| ASIN | Math and trigonometry | Returns the arcsine of a number | Yes |
| ASINH | Math and trigonometry | Returns the inverse hyperbolic sine of a number | Yes |
| ATAN | Math and trigonometry | Returns the arctangent of a number | Yes |
| ATAN2 | Math and trigonometry | Returns the arctangent from x- and y-coordinates | Yes |
| ATANH | Math and trigonometry | Returns the inverse hyperbolic tangent of a number | Yes |
| AVEDEV | Statistical | Returns the average of the absolute deviations of data points from their mean | Yes |
| AVERAGE | Statistical | Returns the average of its arguments | Yes |
| AVERAGEA | Statistical | Returns the average of its arguments, including numbers, text, and logical values | Yes |
| AVERAGEIF | Statistical | Returns the average (arithmetic mean) of all the cells in a range that meet a given criteria | Yes |
| AVERAGEIFS | Statistical | Returns the average (arithmetic mean) of all cells that meet multiple criteria | Yes |
| BAHTTEXT | Text | Converts a number to text, using the ß (baht) currency format | No |
| BASE | Math and trigonometry | Converts a number into a text representation with the given radix (base) | Yes |
| BESSELI | Engineering | Returns the modified Bessel function In(x) | Yes |
| BESSELJ | Engineering | Returns the Bessel function Jn(x) | Yes |
| BESSELK | Engineering | Returns the modified Bessel function Kn(x) | Yes |
| BESSELY | Engineering | Returns the Bessel function Yn(x) | Yes |
| BETA.DIST | Statistical | Returns the beta cumulative distribution function | Yes |
| BETA.INV | Statistical | Returns the inverse of the cumulative distribution function for a specified beta distribution | Yes |
| BETADIST | Compatibility | Returns the beta cumulative distribution function | Yes |
| BETAINV | Compatibility | Returns the inverse of the cumulative distribution function for a specified beta distribution | Yes |
| BIN2DEC | Engineering | Converts a binary number to decimal | Yes |
| BIN2HEX | Engineering | Converts a binary number to hexadecimal | Yes |
| BIN2OCT | Engineering | Converts a binary number to octal | Yes |
| BINOM.DIST | Statistical | Returns the individual term binomial distribution probability | Yes |
| BINOM.DIST.RANGE | Statistical | Returns the probability of a trial result using a binomial distribution | Yes |
| BINOM.INV | Statistical | Returns the smallest value for which the cumulative binomial distribution is less than or equal to a criterion value | Yes |
| BINOMDIST | Compatibility | Returns the individual term binomial distribution probability | Yes |
| BITAND | Engineering | Returns a 'Bitwise And' of two numbers | Yes |
| BITLSHIFT | Engineering | Returns a value number shifted left by shift_amount bits | Yes |
| BITOR | Engineering | Returns a bitwise OR of 2 numbers | Yes |
| BITRSHIFT | Engineering | Returns a value number shifted right by shift_amount bits | Yes |
| BITXOR | Engineering | Returns a bitwise 'Exclusive Or' of two numbers | Yes |
| BYCOL | Logical | Applies a LAMBDA to each column and returns an array of the results | Yes |
| BYROW | Logical | Applies a LAMBDA to each row and returns an array of the results | Yes |
| CALL | User defined functions that are installed with add-ins | Calls a procedure in a dynamic link library or code resource | No |
| CEILING | Math and trigonometry | Rounds a number to the nearest integer or to the nearest multiple of significance | Yes |
| CEILING.MATH | Math and trigonometry | Rounds a number up, to the nearest integer or to the nearest multiple of significance | Yes |
| CEILING.PRECISE | Math and trigonometry | Rounds a number the nearest integer or to the nearest multiple of significance. Regardless of the sign of the number, the number is rounded up. | Yes |
| CELL | Information | Returns information about the formatting, location, or contents of a cell | No |
| CHAR | Text | Returns the character specified by the code number | Yes |
| CHIDIST | Compatibility | Returns the one-tailed probability of the chi-squared distribution | Yes |
| CHIINV | Compatibility | Returns the inverse of the one-tailed probability of the chi-squared distribution | Yes |
| CHISQ.DIST | Statistical | Returns the cumulative beta probability density function | Yes |
| CHISQ.DIST.RT | Statistical | Returns the one-tailed probability of the chi-squared distribution | Yes |
| CHISQ.INV | Statistical | Returns the cumulative beta probability density function | Yes |
| CHISQ.INV.RT | Statistical | Returns the inverse of the one-tailed probability of the chi-squared distribution | Yes |
| CHISQ.TEST | Statistical | Returns the test for independence | Yes |
| CHITEST | Compatibility | Returns the test for independence | Yes |
| CHOOSE | Lookup and reference | Chooses a value from a list of values | Yes |
| CHOOSECOLS | Lookup and reference | Returns the specified columns from an array | Yes |
| CHOOSEROWS | Lookup and reference | Returns the specified rows from an array | Yes |
| CLEAN | Text | Removes all nonprintable characters from text | Yes |
| CODE | Text | Returns a numeric code for the first character in a text string | Yes |
| COLUMN | Lookup and reference | Returns the column number of a reference | Yes |
| COLUMNS | Lookup and reference | Returns the number of columns in a reference | Yes |
| COMBIN | Math and trigonometry | Returns the number of combinations for a given number of objects | Yes |
| COMBINA | Math and trigonometry | Returns the number of combinations with repetitions for a given number of items | Yes |
| COMPLEX | Engineering | Converts real and imaginary coefficients into a complex number | Yes |
| CONCAT | Text | Combines the text from multiple ranges and/or strings, but it doesn't provide the delimiter or IgnoreEmpty arguments. | Yes |
| CONCATENATE | Compatibility | Joins two or more text strings into one string | Yes |
| CONFIDENCE | Compatibility | Returns the confidence interval for a population mean | No |
| CONFIDENCE.NORM | Statistical | Returns the confidence interval for a population mean | Yes |
| CONFIDENCE.T | Statistical | Returns the confidence interval for a population mean, using a Student's t distribution | Yes |
| CONVERT | Engineering | Converts a number from one measurement system to another | Yes |
| CORREL | Statistical | Returns the correlation coefficient between two data sets | Yes |
| COS | Math and trigonometry | Returns the cosine of a number | Yes |
| COSH | Math and trigonometry | Returns the hyperbolic cosine of a number | Yes |
| COT | Math and trigonometry | Returns the cotangent of an angle | Yes |
| COTH | Math and trigonometry | Returns the hyperbolic cotangent of a number | Yes |
| COUNT | Statistical | Counts how many numbers are in the list of arguments | Yes |
| COUNTA | Statistical | Counts how many values are in the list of arguments | Yes |
| COUNTBLANK | Statistical | Counts the number of blank cells within a range | Yes |
| COUNTIF | Statistical | Counts the number of cells within a range that meet the given criteria | Yes |
| COUNTIFS | Statistical | Counts the number of cells within a range that meet multiple criteria | Yes |
| COUPDAYBS | Financial | Returns the number of days from the beginning of the coupon period to the settlement date | Yes |
| COUPDAYS | Financial | Returns the number of days in the coupon period that contains the settlement date | Yes |
| COUPDAYSNC | Financial | Returns the number of days from the settlement date to the next coupon date | Yes |
| COUPNCD | Financial | Returns the next coupon date after the settlement date | Yes |
| COUPNUM | Financial | Returns the number of coupons payable between the settlement date and maturity date | Yes |
| COUPPCD | Financial | Returns the previous coupon date before the settlement date | Yes |
| COVAR | Compatibility | Returns covariance, the average of the products of paired deviations | Yes |
| COVARIANCE.P | Statistical | Returns covariance, the average of the products of paired deviations | Yes |
| COVARIANCE.S | Statistical | Returns the sample covariance, the average of the products deviations for each data point pair in two data sets | Yes |
| CRITBINOM | Compatibility | Returns the smallest value for which the cumulative binomial distribution is less than or equal to a criterion value | Yes |
| CSC | Math and trigonometry | Returns the cosecant of an angle | Yes |
| CSCH | Math and trigonometry | Returns the hyperbolic cosecant of an angle | Yes |
| CUBEKPIMEMBER | Cubes | Returns a key performance indicator (KPI) property and displays the KPI name in the cell. A KPI is a quantifiable measurement, such as monthly gross profit or quarterly employee turnover, that is used to monitor an organization's performance. | No |
| CUBEMEMBER | Cubes | Returns a member or tuple from the cube. Use to validate that the member or tuple exists in the cube. | No |
| CUBEMEMBERPROPERTY | Cubes | Returns the value of a member property from the cube. Use to validate that a member name exists within the cube and to return the specified property for this member. | No |
| CUBERANKEDMEMBER | Cubes | Returns the nth, or ranked, member in a set. Use to return one or more elements in a set, such as the top sales performer or the top 10 students. | No |
| CUBESET | Cubes | Defines a calculated set of members or tuples by sending a set expression to the cube on the server, which creates the set, and then returns that set to Microsoft Excel. | No |
| CUBESETCOUNT | Cubes | Returns the number of items in a set. | No |
| CUBEVALUE | Cubes | Returns an aggregated value from the cube. | No |
| CUMIPMT | Financial | Returns the cumulative interest paid between two periods | Yes |
| CUMPRINC | Financial | Returns the cumulative principal paid on a loan between two periods | Yes |
| DATE | Date and time | Returns the serial number of a particular date | Yes |
| DATEDIF | Date and time | Calculates the number of days, months, or years between two dates. This function is useful in formulas where you need to calculate an age. | No |
| DATEVALUE | Date and time | Converts a date in the form of text to a serial number | Yes |
| DAVERAGE | Database | Returns the average of selected database entries | Yes |
| DAY | Date and time | Converts a serial number to a day of the month | Yes |
| DAYS | Date and time | Returns the number of days between two dates | Yes |
| DAYS360 | Date and time | Calculates the number of days between two dates based on a 360-day year | Yes |
| DB | Financial | Returns the depreciation of an asset for a specified period by using the fixed-declining balance method | Yes |
| DBCS | Text | Changes half-width (single-byte) English letters or katakana within a character string to full-width (double-byte) characters | No |
| DCOUNT | Database | Counts the cells that contain numbers in a database | Yes |
| DCOUNTA | Database | Counts nonblank cells in a database | Yes |
| DDB | Financial | Returns the depreciation of an asset for a specified period by using the double-declining balance method or some other method that you specify | Yes |
| DEC2BIN | Engineering | Converts a decimal number to binary | Yes |
| DEC2HEX | Engineering | Converts a decimal number to hexadecimal | Yes |
| DEC2OCT | Engineering | Converts a decimal number to octal | Yes |
| DECIMAL | Math and trigonometry | Converts a text representation of a number in a given base into a decimal number | Yes |
| DEGREES | Math and trigonometry | Converts radians to degrees | Yes |
| DELTA | Engineering | Tests whether two values are equal | Yes |
| DETECTLANGUAGE | Text | Identifies the language of a specified text | No |
| DEVSQ | Statistical | Returns the sum of squares of deviations | Yes |
| DGET | Database | Extracts from a database a single record that matches the specified criteria | Yes |
| DISC | Financial | Returns the discount rate for a security | Yes |
| DMAX | Database | Returns the maximum value from selected database entries | Yes |
| DMIN | Database | Returns the minimum value from selected database entries | Yes |
| DOLLAR | Text | Converts a number to text, using the $ (dollar) currency format | Yes |
| DOLLARDE | Financial | Converts a dollar price, expressed as a fraction, into a dollar price, expressed as a decimal number | Yes |
| DOLLARFR | Financial | Converts a dollar price, expressed as a decimal number, into a dollar price, expressed as a fraction | Yes |
| DPRODUCT | Database | Multiplies the values in a particular field of records that match the criteria in a database | Yes |
| DROP | Lookup and reference | Excludes a specified number of rows or columns from the start or end of an array | Yes |
| DSTDEV | Database | Estimates the standard deviation based on a sample of selected database entries | Yes |
| DSTDEVP | Database | Calculates the standard deviation based on the entire population of selected database entries | Yes |
| DSUM | Database | Adds the numbers in the field column of records in the database that match the criteria | Yes |
| DURATION | Financial | Returns the annual duration of a security with periodic interest payments | No |
| DVAR | Database | Estimates variance based on a sample from selected database entries | Yes |
| DVARP | Database | Calculates variance based on the entire population of selected database entries | Yes |
| EDATE | Date and time | Returns the serial number of the date that is the indicated number of months before or after the start date | Yes |
| EFFECT | Financial | Returns the effective annual interest rate | Yes |
| ENCODEURL | Web | Returns a URL-encoded string | No |
| EOMONTH | Date and time | Returns the serial number of the last day of the month before or after a specified number of months | Yes |
| ERF | Engineering | Returns the error function | Yes |
| ERF.PRECISE | Engineering | Returns the error function | Yes |
| ERFC | Engineering | Returns the complementary error function | Yes |
| ERFC.PRECISE | Engineering | Returns the complementary ERF function integrated between x and infinity | Yes |
| ERROR.TYPE | Information | Returns a number corresponding to an error type | Yes |
| EUROCONVERT | User defined functions that are installed with add-ins | Converts a number to euros, converts a number from euros to a euro member currency, or converts a number from one euro member currency to another by using the euro as an intermediary (triangulation) | No |
| EVEN | Math and trigonometry | Rounds a number up to the nearest even integer | Yes |
| EXACT | Text | Checks to see if two text values are identical | Yes |
| EXP | Math and trigonometry | Returns e raised to the power of a given number | Yes |
| EXPAND | Lookup and reference | Expands or pads an array to specified row and column dimensions | Yes |
| EXPON.DIST | Statistical | Returns the exponential distribution | Yes |
| EXPONDIST | Compatibility | Returns the exponential distribution | Yes |
| F.DIST | Statistical | Returns the F probability distribution | Yes |
| F.DIST.RT | Statistical | Returns the F probability distribution | Yes |
| F.INV | Statistical | Returns the inverse of the F probability distribution | Yes |
| F.INV.RT | Statistical | Returns the inverse of the F probability distribution | Yes |
| F.TEST | Statistical | Returns the result of an F-test | Yes |
| FACT | Math and trigonometry | Returns the factorial of a number | Yes |
| FACTDOUBLE | Math and trigonometry | Returns the double factorial of a number | Yes |
| FALSE | Logical | Returns the logical value FALSE | Yes |
| FDIST | Compatibility | Returns the F probability distribution | Yes |
| FILTER | Lookup and reference | Filters a range of data based on criteria you define | Yes |
| FILTERXML | Web | Returns specific data from the XML content by using the specified XPath | No |
| FIND | Text | Finds one text value within another (case-sensitive) | Yes |
| FINDB | Text | Finds one text value within another (case-sensitive) | No |
| FINV | Compatibility | Returns the inverse of the F probability distribution | Yes |
| FISHER | Statistical | Returns the Fisher transformation | Yes |
| FISHERINV | Statistical | Returns the inverse of the Fisher transformation | Yes |
| FIXED | Text | Formats a number as text with a fixed number of decimals | Yes |
| FLOOR | Compatibility | Rounds a number down, toward zero | Yes |
| FLOOR.MATH | Math and trigonometry | Rounds a number down, to the nearest integer or to the nearest multiple of significance | Yes |
| FLOOR.PRECISE | Math and trigonometry | Rounds a number down to the nearest integer or to the nearest multiple of significance. Regardless of the sign of the number, the number is rounded down. | Yes |
| FORECAST | Compatibility | Calculates, or predicts, a future value by using existing values. | Yes |
| FORECAST.ETS | Statistical | Returns a future value based on existing (historical) values by using the AAA version of the Exponential Smoothing (ETS) algorithm | No |
| FORECAST.ETS.CONFINT | Statistical | Returns a confidence interval for the forecast value at the specified target date | No |
| FORECAST.ETS.SEASONALITY | Statistical | Returns the length of the repetitive pattern Excel detects for the specified time series | No |
| FORECAST.ETS.STAT | Statistical | Returns a statistical value as a result of time series forecasting | No |
| FORECAST.LINEAR | Statistical | Returns a future value based on existing values | Yes |
| FORMULATEXT | Lookup and reference | Returns the formula at the given reference as text | No |
| FREQUENCY | Statistical | Returns a frequency distribution as a vertical array | Yes |
| FTEST | Compatibility | Returns the result of an F-test | Yes |
| FV | Financial | Returns the future value of an investment | Yes |
| FVSCHEDULE | Financial | Returns the future value of an initial principal after applying a series of compound interest rates | Yes |
| GAMMA | Statistical | Returns the Gamma function value | Yes |
| GAMMA.DIST | Statistical | Returns the gamma distribution | Yes |
| GAMMA.INV | Statistical | Returns the inverse of the gamma cumulative distribution | Yes |
| GAMMADIST | Compatibility | Returns the gamma distribution | Yes |
| GAMMAINV | Compatibility | Returns the inverse of the gamma cumulative distribution | Yes |
| GAMMALN | Statistical | Returns the natural logarithm of the gamma function, Γ(x) | Yes |
| GAMMALN.PRECISE | Statistical | Returns the natural logarithm of the gamma function, Γ(x) | Yes |
| GAUSS | Statistical | Returns 0.5 less than the standard normal cumulative distribution | Yes |
| GCD | Math and trigonometry | Returns the greatest common divisor | Yes |
| GEOMEAN | Statistical | Returns the geometric mean | Yes |
| GESTEP | Engineering | Tests whether a number is greater than a threshold value | Yes |
| GETPIVOTDATA | Lookup and reference | Returns data stored in a PivotTable report | No |
| GROUPBY | Lookup and reference | Helps a user group, aggregate, sort, and filter data based on the fields you specify | No |
| GROWTH | Statistical | Returns values along an exponential trend | Yes |
| HARMEAN | Statistical | Returns the harmonic mean | Yes |
| HEX2BIN | Engineering | Converts a hexadecimal number to binary | Yes |
| HEX2DEC | Engineering | Converts a hexadecimal number to decimal | Yes |
| HEX2OCT | Engineering | Converts a hexadecimal number to octal | Yes |
| HLOOKUP | Lookup and reference | Looks in the top row of an array and returns the value of the indicated cell | Yes |
| HOUR | Date and time | Converts a serial number to an hour | Yes |
| HSTACK | Lookup and reference | Appends arrays horizontally and in sequence to return a larger array | Yes |
| HYPERLINK | Lookup and reference | Creates a shortcut or jump that opens a document stored on a network server, an intranet, or the Internet | No |
| HYPGEOM.DIST | Statistical | Returns the hypergeometric distribution | Yes |
| HYPGEOMDIST | Compatibility | Returns the hypergeometric distribution | Yes |
| IF | Logical | Specifies a logical test to perform | Yes |
| IFERROR | Logical | Returns a value you specify if a formula evaluates to an error; otherwise, returns the result of the formula | Yes |
| IFNA | Logical | Returns the value you specify if the expression resolves to #N/A, otherwise returns the result of the expression | Yes |
| IFS | Logical | Checks whether one or more conditions are met and returns a value that corresponds to the first TRUE condition. | Yes |
| IMABS | Engineering | Returns the absolute value (modulus) of a complex number | Yes |
| IMAGE | Lookup and reference | Returns an image from a given source | No |
| IMAGINARY | Engineering | Returns the imaginary coefficient of a complex number | Yes |
| IMARGUMENT | Engineering | Returns the argument theta, an angle expressed in radians | Yes |
| IMCONJUGATE | Engineering | Returns the complex conjugate of a complex number | Yes |
| IMCOS | Engineering | Returns the cosine of a complex number | Yes |
| IMCOSH | Engineering | Returns the hyperbolic cosine of a complex number | Yes |
| IMCOT | Engineering | Returns the cotangent of a complex number | Yes |
| IMCSC | Engineering | Returns the cosecant of a complex number | Yes |
| IMCSCH | Engineering | Returns the hyperbolic cosecant of a complex number | Yes |
| IMDIV | Engineering | Returns the quotient of two complex numbers | Yes |
| IMEXP | Engineering | Returns the exponential of a complex number | Yes |
| IMLN | Engineering | Returns the natural logarithm of a complex number | Yes |
| IMLOG10 | Engineering | Returns the base-10 logarithm of a complex number | Yes |
| IMLOG2 | Engineering | Returns the base-2 logarithm of a complex number | Yes |
| IMPOWER | Engineering | Returns a complex number raised to an integer power | Yes |
| IMPRODUCT | Engineering | Returns the product of from 2 to 255 complex numbers | Yes |
| IMREAL | Engineering | Returns the real coefficient of a complex number | Yes |
| IMSEC | Engineering | Returns the secant of a complex number | Yes |
| IMSECH | Engineering | Returns the hyperbolic secant of a complex number | Yes |
| IMSIN | Engineering | Returns the sine of a complex number | Yes |
| IMSINH | Engineering | Returns the hyperbolic sine of a complex number | Yes |
| IMSQRT | Engineering | Returns the square root of a complex number | Yes |
| IMSUB | Engineering | Returns the difference between two complex numbers | Yes |
| IMSUM | Engineering | Returns the sum of complex numbers | Yes |
| IMTAN | Engineering | Returns the tangent of a complex number | Yes |
| INDEX | Lookup and reference | Uses an index to choose a value from a reference or array | Yes |
| INDIRECT | Lookup and reference | Returns a reference indicated by a text value | No |
| INFO | Information | Returns information about the current operating environment Note: This function is not available in Excel for the web. | No |
| INT | Math and trigonometry | Rounds a number down to the nearest integer | Yes |
| INTERCEPT | Statistical | Returns the intercept of the linear regression line | Yes |
| INTRATE | Financial | Returns the interest rate for a fully invested security | No |
| IPMT | Financial | Returns the interest payment for an investment for a given period | Yes |
| IRR | Financial | Returns the internal rate of return for a series of cash flows | Yes |
| ISBLANK | Information | Returns TRUE if the value is blank | Yes |
| ISERR | Information | Returns TRUE if the value is any error value except #N/A | Yes |
| ISERROR | Information | Returns TRUE if the value is any error value | Yes |
| ISEVEN | Information | Returns TRUE if the number is even | Yes |
| ISFORMULA | Information | Returns TRUE if there is a reference to a cell that contains a formula | No |
| ISLOGICAL | Information | Returns TRUE if the value is a logical value | Yes |
| ISNA | Information | Returns TRUE if the value is the #N/A error value | Yes |
| ISNONTEXT | Information | Returns TRUE if the value is not text | Yes |
| ISNUMBER | Information | Returns TRUE if the value is a number | Yes |
| ISO.CEILING | Math and trigonometry | Returns a number that is rounded up to the nearest integer or to the nearest multiple of significance | Yes |
| ISODD | Information | Returns TRUE if the number is odd | Yes |
| ISOMITTED | Information | Checks whether the value in a LAMBDA is missing and returns TRUE or FALSE | No |
| ISOWEEKNUM | Date and time | Returns the number of the ISO week number of the year for a given date | Yes |
| ISPMT | Financial | Calculates the interest paid during a specific period of an investment | Yes |
| ISREF | Information | Returns TRUE if the value is a reference | No |
| ISTEXT | Information | Returns TRUE if the value is text | Yes |
| KURT | Statistical | Returns the kurtosis of a data set | Yes |
| LAMBDA | Logical | Create custom, reusable functions and call them by a friendly name | No |
| LARGE | Statistical | Returns the k-th largest value in a data set | Yes |
| LCM | Math and trigonometry | Returns the least common multiple | Yes |
| LEFT | Text | Returns the leftmost characters from a text value | Yes |
| LEFTB | Text | Returns the leftmost characters from a text value | No |
| LEN | Text | Returns the number of characters in a text string | Yes |
| LENB | Text | Returns the number of characters in a text string | No |
| LET | Logical | Assigns names to calculation results | No |
| LINEST | Statistical | Returns the parameters of a linear trend | Yes |
| LN | Math and trigonometry | Returns the natural logarithm of a number | Yes |
| LOG | Math and trigonometry | Returns the logarithm of a number to a specified base | Yes |
| LOG10 | Math and trigonometry | Returns the base-10 logarithm of a number | Yes |
| LOGEST | Statistical | Returns the parameters of an exponential trend | Yes |
| LOGINV | Compatibility | Returns the inverse of the lognormal cumulative distribution function | Yes |
| LOGNORM.DIST | Statistical | Returns the cumulative lognormal distribution | Yes |
| LOGNORM.INV | Statistical | Returns the inverse of the lognormal cumulative distribution | Yes |
| LOGNORMDIST | Compatibility | Returns the cumulative lognormal distribution | Yes |
| LOOKUP | Lookup and reference | Looks up values in a vector or array | Yes |
| LOWER | Text | Converts text to lowercase | Yes |
| MAKEARRAY | Logical | Returns a calculated array of a specified row and column size, by applying a LAMBDA | No |
| MAP | Logical | Returns an array formed by mapping each value in the array(s) to a new value by applying a LAMBDA to create a new value | No |
| MATCH | Lookup and reference | Looks up values in a reference or array | Yes |
| MAX | Statistical | Returns the maximum value in a list of arguments | Yes |
| MAXA | Statistical | Returns the maximum value in a list of arguments, including numbers, text, and logical values | Yes |
| MAXIFS | Statistical | Returns the maximum value among cells specified by a given set of conditions or criteria | Yes |
| MDETERM | Math and trigonometry | Returns the matrix determinant of an array | Yes |
| MDURATION | Financial | Returns the Macauley modified duration for a security with an assumed par value of $100 | No |
| MEDIAN | Statistical | Returns the median of the given numbers | Yes |
| MID | Text | Returns a specific number of characters from a text string starting at the position you specify | Yes |
| MIDB | Text | Returns a specific number of characters from a text string starting at the position you specify | No |
| MIN | Statistical | Returns the minimum value in a list of arguments | Yes |
| MINA | Statistical | Returns the smallest value in a list of arguments, including numbers, text, and logical values | Yes |
| MINIFS | Statistical | Returns the minimum value among cells specified by a given set of conditions or criteria. | Yes |
| MINUTE | Date and time | Converts a serial number to a minute | Yes |
| MINVERSE | Math and trigonometry | Returns the matrix inverse of an array | Yes |
| MIRR | Financial | Returns the internal rate of return where positive and negative cash flows are financed at different rates | Yes |
| MMULT | Math and trigonometry | Returns the matrix product of two arrays | Yes |
| MOD | Math and trigonometry | Returns the remainder from division | Yes |
| MODE | Compatibility | Returns the most common value in a data set | No |
| MODE.MULT | Statistical | Returns a vertical array of the most frequently occurring, or repetitive values in an array or range of data | Yes |
| MODE.SNGL | Statistical | Returns the most common value in a data set | Yes |
| MONTH | Date and time | Converts a serial number to a month | Yes |
| MROUND | Math and trigonometry | Returns a number rounded to the desired multiple | Yes |
| MULTINOMIAL | Math and trigonometry | Returns the multinomial of a set of numbers | Yes |
| MUNIT | Math and trigonometry | Returns the unit matrix or the specified dimension | Yes |
| N | Information | Returns a value converted to a number | Yes |
| NA | Information | Returns the error value #N/A | Yes |
| NEGBINOM.DIST | Statistical | Returns the negative binomial distribution | Yes |
| NEGBINOMDIST | Compatibility | Returns the negative binomial distribution | Yes |
| NETWORKDAYS | Date and time | Returns the number of whole workdays between two dates | Yes |
| NETWORKDAYS.INTL | Date and time | Returns the number of whole workdays between two dates using parameters to indicate which and how many days are weekend days | Yes |
| NOMINAL | Financial | Returns the annual nominal interest rate | Yes |
| NORM.DIST | Statistical | Returns the normal cumulative distribution | Yes |
| NORM.INV | Statistical | Returns the inverse of the normal cumulative distribution | Yes |
| NORM.S.DIST | Statistical | Returns the standard normal cumulative distribution | Yes |
| NORM.S.INV | Statistical | Returns the inverse of the standard normal cumulative distribution | Yes |
| NORMDIST | Compatibility | Returns the normal cumulative distribution | Yes |
| NORMINV | Compatibility | Returns the inverse of the normal cumulative distribution | Yes |
| NORMSDIST | Compatibility | Returns the standard normal cumulative distribution | Yes |
| NORMSINV | Compatibility | Returns the inverse of the standard normal cumulative distribution | Yes |
| NOT | Logical | Reverses the logic of its argument | Yes |
| NOW | Date and time | Returns the serial number of the current date and time | Yes |
| NPER | Financial | Returns the number of periods for an investment | Yes |
| NPV | Financial | Returns the net present value of an investment based on a series of periodic cash flows and a discount rate | Yes |
| NUMBERVALUE | Text | Converts text to number in a locale-independent manner | Yes |
| OCT2BIN | Engineering | Converts an octal number to binary | Yes |
| OCT2DEC | Engineering | Converts an octal number to decimal | Yes |
| OCT2HEX | Engineering | Converts an octal number to hexadecimal | Yes |
| ODD | Math and trigonometry | Rounds a number up to the nearest odd integer | Yes |
| ODDFPRICE | Financial | Returns the price per $100 face value of a security with an odd first period | No |
| ODDFYIELD | Financial | Returns the yield of a security with an odd first period | No |
| ODDLPRICE | Financial | Returns the price per $100 face value of a security with an odd last period | No |
| ODDLYIELD | Financial | Returns the yield of a security with an odd last period | No |
| OFFSET | Lookup and reference | Returns a reference offset from a given reference | No |
| OR | Logical | Returns TRUE if any argument is TRUE | Yes |
| PDURATION | Financial | Returns the number of periods required by an investment to reach a specified value | Yes |
| PEARSON | Statistical | Returns the Pearson product moment correlation coefficient | Yes |
| PERCENTILE | Compatibility | Returns the k-th percentile of values in a range | Yes |
| PERCENTILE.EXC | Statistical | Returns the k-th percentile of values in a range, where k is in the range 0..1, exclusive | Yes |
| PERCENTILE.INC | Statistical | Returns the k-th percentile of values in a range | Yes |
| PERCENTOF | Math and trigonometry | Sums the values in the subset and divides it by all the values | No |
| PERCENTRANK | Compatibility | Returns the percentage rank of a value in a data set | Yes |
| PERCENTRANK.EXC | Statistical | Returns the rank of a value in a data set as a percentage (0..1, exclusive) of the data set | Yes |
| PERCENTRANK.INC | Statistical | Returns the percentage rank of a value in a data set | Yes |
| PERMUT | Statistical | Returns the number of permutations for a given number of objects | Yes |
| PERMUTATIONA | Statistical | Returns the number of permutations for a given number of objects (with repetitions) that can be selected from the total objects | Yes |
| PHI | Statistical | Returns the value of the density function for a standard normal distribution | Yes |
| PHONETIC | Text | Extracts the phonetic (furigana) characters from a text string | No |
| PI | Math and trigonometry | Returns the value of pi | Yes |
| PIVOTBY | Lookup and reference | Helps a user group, aggregate, sort, and filter data based on the row and column fields that you specify | No |
| PMT | Financial | Returns the periodic payment for an annuity | Yes |
| POISSON | Compatibility | Returns the Poisson distribution | No |
| POISSON.DIST | Statistical | Returns the Poisson distribution | Yes |
| POWER | Math and trigonometry | Returns the result of a number raised to a power | Yes |
| PPMT | Financial | Returns the payment on the principal for an investment for a given period | Yes |
| PRICE | Financial | Returns the price per $100 face value of a security that pays periodic interest | Yes |
| PRICEDISC | Financial | Returns the price per $100 face value of a discounted security | Yes |
| PRICEMAT | Financial | Returns the price per $100 face value of a security that pays interest at maturity | Yes |
| PROB | Statistical | Returns the probability that values in a range are between two limits | Yes |
| PRODUCT | Math and trigonometry | Multiplies its arguments | Yes |
| PROPER | Text | Capitalizes the first letter in each word of a text value | Yes |
| PV | Financial | Returns the present value of an investment | Yes |
| QUARTILE | Compatibility | Returns the quartile of a data set | Yes |
| QUARTILE.EXC | Statistical | Returns the quartile of the data set, based on percentile values from 0..1, exclusive | Yes |
| QUARTILE.INC | Statistical | Returns the quartile of a data set | Yes |
| QUOTIENT | Math and trigonometry | Returns the integer portion of a division | Yes |
| RADIANS | Math and trigonometry | Converts degrees to radians | Yes |
| RAND | Math and trigonometry | Returns a random number between 0 and 1 | Yes |
| RANDARRAY | Math and trigonometry | Returns an array of random numbers between 0 and 1. However, you can specify the number of rows and columns to fill, minimum and maximum values, and whether to return whole numbers or decimal values. | Yes |
| RANDBETWEEN | Math and trigonometry | Returns a random number between the numbers you specify | Yes |
| RANK | Compatibility | Returns the rank of a number in a list of numbers | Yes |
| RANK.AVG | Statistical | Returns the rank of a number in a list of numbers | Yes |
| RANK.EQ | Statistical | Returns the rank of a number in a list of numbers | Yes |
| RATE | Financial | Returns the interest rate per period of an annuity | Yes |
| RECEIVED | Financial | Returns the amount received at maturity for a fully invested security | Yes |
| REDUCE | Logical | Reduces an array to an accumulated value by applying a LAMBDA to each value and returning the total value in the accumulator | No |
| REGEXEXTRACT | Text | Extracts strings within the provided text that matches the pattern | Yes |
| REGEXREPLACE | Text | Replaces strings within the provided text that matches the pattern with replacement | Yes |
| REGEXTEST | Text | Determines whether any part of text matches the pattern | Yes |
| REGISTER.ID | User defined functions that are installed with add-ins | Returns the register ID of the specified dynamic link library (DLL) or code resource that has been previously registered | No |
| REPLACE | Text | Replaces characters within text | Yes |
| REPLACEB | Text | Replaces characters within text | No |
| REPT | Text | Repeats text a given number of times | Yes |
| RIGHT | Text | Returns the rightmost characters from a text value | Yes |
| RIGHTB | Text | Returns the rightmost characters from a text value | No |
| ROMAN | Math and trigonometry | Converts an Arabic numeral to Roman, as text | Yes |
| ROUND | Math and trigonometry | Rounds a number to a specified number of digits | Yes |
| ROUNDDOWN | Math and trigonometry | Rounds a number down, toward zero | Yes |
| ROUNDUP | Math and trigonometry | Rounds a number up, away from zero | Yes |
| ROW | Lookup and reference | Returns the row number of a reference | Yes |
| ROWS | Lookup and reference | Returns the number of rows in a reference | Yes |
| RRI | Financial | Returns an equivalent interest rate for the growth of an investment | Yes |
| RSQ | Statistical | Returns the square of the Pearson product moment correlation coefficient | Yes |
| RTD | Lookup and reference | Retrieves real-time data from a program that supports COM automation | No |
| SCAN | Logical | Scans an array by applying a LAMBDA to each value and returns an array that has each intermediate value | No |
| SEARCH | Text | Finds one text value within another (not case-sensitive) | Yes |
| SEARCHB | Text | Finds one text value within another (not case-sensitive) | No |
| SEC | Math and trigonometry | Returns the secant of an angle | Yes |
| SECH | Math and trigonometry | Returns the hyperbolic secant of an angle | Yes |
| SECOND | Date and time | Converts a serial number to a second | Yes |
| SEQUENCE | Math and trigonometry | Generates a list of sequential numbers in an array, such as 1, 2, 3, 4 | Yes |
| SERIESSUM | Math and trigonometry | Returns the sum of a power series based on the formula | Yes |
| SHEET | Information | Returns the sheet number of the referenced sheet | Yes |
| SHEETS | Information | Returns the number of sheets in a reference | Yes |
| SIGN | Math and trigonometry | Returns the sign of a number | Yes |
| SIN | Math and trigonometry | Returns the sine of the given angle | Yes |
| SINH | Math and trigonometry | Returns the hyperbolic sine of a number | Yes |
| SKEW | Statistical | Returns the skewness of a distribution | Yes |
| SKEW.P | Statistical | Returns the skewness of a distribution based on a population: a characterization of the degree of asymmetry of a distribution around its mean | Yes |
| SLN | Financial | Returns the straight-line depreciation of an asset for one period | Yes |
| SLOPE | Statistical | Returns the slope of the linear regression line | Yes |
| SMALL | Statistical | Returns the k-th smallest value in a data set | Yes |
| SORT | Lookup and reference | Sorts the contents of a range or array | Yes |
| SORTBY | Lookup and reference | Sorts the contents of a range or array based on the values in a corresponding range or array | Yes |
| SQRT | Math and trigonometry | Returns a positive square root | Yes |
| SQRTPI | Math and trigonometry | Returns the square root of (number * pi) | Yes |
| STANDARDIZE | Statistical | Returns a normalized value | Yes |
| STDEV | Compatibility | Estimates standard deviation based on a sample | Yes |
| STDEV.P | Statistical | Calculates standard deviation based on the entire population | Yes |
| STDEV.S | Statistical | Estimates standard deviation based on a sample | Yes |
| STDEVA | Statistical | Estimates standard deviation based on a sample, including numbers, text, and logical values | Yes |
| STDEVP | Compatibility | Calculates standard deviation based on the entire population | Yes |
| STDEVPA | Statistical | Calculates standard deviation based on the entire population, including numbers, text, and logical values | Yes |
| STEYX | Statistical | Returns the standard error of the predicted y-value for each x in the regression | Yes |
| STOCKHISTORY | Information | Retrieves historical data about a financial instrument | No |
| SUBSTITUTE | Text | Substitutes new text for old text in a text string | Yes |
| SUBTOTAL | Math and trigonometry | Returns a subtotal in a list or database | Yes |
| SUM | Math and trigonometry | Adds its arguments | Yes |
| SUMIF | Math and trigonometry | Adds the cells specified by a given criteria | Yes |
| SUMIFS | Math and trigonometry | Adds the cells in a range that meet multiple criteria | Yes |
| SUMPRODUCT | Math and trigonometry | Returns the sum of the products of corresponding array components | Yes |
| SUMSQ | Math and trigonometry | Returns the sum of the squares of the arguments | Yes |
| SUMX2MY2 | Math and trigonometry | Returns the sum of the difference of squares of corresponding values in two arrays | Yes |
| SUMX2PY2 | Math and trigonometry | Returns the sum of the sum of squares of corresponding values in two arrays | Yes |
| SUMXMY2 | Math and trigonometry | Returns the sum of squares of differences of corresponding values in two arrays | Yes |
| SWITCH | Logical | Evaluates an expression against a list of values and returns the result corresponding to the first matching value. If there is no match, an optional default value may be returned. | Yes |
| SYD | Financial | Returns the sum-of-years' digits depreciation of an asset for a specified period | Yes |
| T | Text | Converts its arguments to text | Yes |
| T.DIST | Statistical | Returns the Percentage Points (probability) for the Student t-distribution | Yes |
| T.DIST.2T | Statistical | Returns the Percentage Points (probability) for the Student t-distribution | Yes |
| T.DIST.RT | Statistical | Returns the Student's t-distribution | Yes |
| T.INV | Statistical | Returns the t-value of the Student's t-distribution as a function of the probability and the degrees of freedom | Yes |
| T.INV.2T | Statistical | Returns the inverse of the Student's t-distribution | Yes |
| T.TEST | Statistical | Returns the probability associated with a Student's t-test | Yes |
| TAKE | Lookup and reference | Returns a specified number of contiguous rows or columns from the start or end of an array | Yes |
| TAN | Math and trigonometry | Returns the tangent of a number | Yes |
| TANH | Math and trigonometry | Returns the hyperbolic tangent of a number | Yes |
| TBILLEQ | Financial | Returns the bond-equivalent yield for a Treasury bill | Yes |
| TBILLPRICE | Financial | Returns the price per $100 face value for a Treasury bill | Yes |
| TBILLYIELD | Financial | Returns the yield for a Treasury bill | Yes |
| TDIST | Compatibility | Returns the Student's t-distribution | Yes |
| TEXT | Text | Formats a number and converts it to text | Yes |
| TEXTAFTER | Text | Returns text that occurs after given character or string | Yes |
| TEXTBEFORE | Text | Returns text that occurs before a given character or string | Yes |
| TEXTJOIN | Text | Text: Combines the text from multiple ranges and/or strings | Yes |
| TEXTSPLIT | Text | Splits text strings by using column and row delimiters | Yes |
| TIME | Date and time | Returns the serial number of a particular time | Yes |
| TIMEVALUE | Date and time | Converts a time in the form of text to a serial number | Yes |
| TINV | Compatibility | Returns the inverse of the Student's t-distribution | Yes |
| TOCOL | Lookup and reference | Returns the array in a single column | Yes |
| TODAY | Date and time | Returns the serial number of today's date | Yes |
| TOROW | Lookup and reference | Returns the array in a single row | Yes |
| TRANSLATE | Text | Translates a text from one language to another | No |
| TRANSPOSE | Lookup and reference | Returns the transpose of an array | Yes |
| TREND | Statistical | Returns values along a linear trend | Yes |
| TRIM | Text | Removes spaces from text | Yes |
| TRIMMEAN | Statistical | Returns the mean of the interior of a data set | Yes |
| TRIMRANGE | Lookup and reference | Scans in from the edges of a range or array until it finds a non-blank cell (or value), it then excludes those blank rows or columns | No |
| TRUE | Logical | Returns the logical value TRUE | Yes |
| TRUNC | Math and trigonometry | Truncates a number to an integer | Yes |
| TTEST | Compatibility | Returns the probability associated with a Student's t-test | Yes |
| TYPE | Information | Returns a number indicating the data type of a value | Yes |
| UNICHAR | Text | Returns the Unicode character that is references by the given numeric value | Yes |
| UNICODE | Text | Returns the number (code point) that corresponds to the first character of the text | Yes |
| UNIQUE | Lookup and reference | Returns a list of unique values in a list or range | Yes |
| UPPER | Text | Converts text to uppercase | Yes |
| VALUE | Text | Converts a text argument to a number | Yes |
| VALUETOTEXT | Text | Returns text from any specified value | Yes |
| VAR | Compatibility | Estimates variance based on a sample | Yes |
| VAR.P | Statistical | Calculates variance based on the entire population | Yes |
| VAR.S | Statistical | Estimates variance based on a sample | Yes |
| VARA | Statistical | Estimates variance based on a sample, including numbers, text, and logical values | Yes |
| VARP | Compatibility | Calculates variance based on the entire population | Yes |
| VARPA | Statistical | Calculates variance based on the entire population, including numbers, text, and logical values | Yes |
| VDB | Financial | Returns the depreciation of an asset for a specified or partial period by using a declining balance method | No |
| VLOOKUP | Lookup and reference | Looks in the first column of an array and moves across the row to return the value of a cell | Yes |
| VSTACK | Lookup and reference | Appends arrays vertically and in sequence to return a larger array | Yes |
| WEBSERVICE | Web | Returns data from a web service | No |
| WEEKDAY | Date and time | Converts a serial number to a day of the week | Yes |
| WEEKNUM | Date and time | Converts a serial number to a number representing where the week falls numerically with a year | Yes |
| WEIBULL | Compatibility | Returns the Weibull distribution | No |
| WEIBULL.DIST | Statistical | Returns the Weibull distribution | Yes |
| WORKDAY | Date and time | Returns the serial number of the date before or after a specified number of workdays | Yes |
| WORKDAY.INTL | Date and time | Returns the serial number of the date before or after a specified number of workdays using parameters to indicate which and how many days are weekend days | Yes |
| WRAPCOLS | Lookup and reference | Wraps the provided row or column of values by columns after a specified number of elements | Yes |
| WRAPROWS | Lookup and reference | Wraps the provided row or column of values by rows after a specified number of elements | Yes |
| XIRR | Financial | Returns the internal rate of return for a schedule of cash flows that is not necessarily periodic | Yes |
| XLOOKUP | Lookup and reference | Searches a range or an array, and returns an item corresponding to the first match it finds. If a match doesn't exist, then XLOOKUP can return the closest (approximate) match. | Yes |
| XMATCH | Lookup and reference | Returns the relative position of an item in an array or range of cells. | Yes |
| XNPV | Financial | Returns the net present value for a schedule of cash flows that is not necessarily periodic | Yes |
| XOR | Logical | Returns a logical exclusive OR of all arguments | Yes |
| YEAR | Date and time | Converts a serial number to a year | Yes |
| YEARFRAC | Date and time | Returns the year fraction representing the number of whole days between start_date and end_date | Yes |
| YIELD | Financial | Returns the yield on a security that pays periodic interest | Yes |
| YIELDDISC | Financial | Returns the annual yield for a discounted security; for example, a Treasury bill | Yes |
| YIELDMAT | Financial | Returns the annual yield of a security that pays interest at maturity | Yes |
| Z.TEST | Statistical | Returns the one-tailed probability-value of a z-test | Yes |
| ZTEST | Compatibility | Returns the one-tailed probability-value of a z-test | Yes |
