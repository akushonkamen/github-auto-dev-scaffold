# Feature: CSV import with validation

## Description
We need to import CSV files into the system. Each row should be validated against the schema before insertion.

## Requirements
- Support CSV files up to 10MB
- Validate each row's email, phone, and date fields
- Show a summary of pass/fail counts after import
- Export failed rows as a separate CSV for correction

## Notes
This is a sad-path fixture: the engine output is malformed JSON (missing closing brace,
unquoted string, etc.). The extract.sh script should detect the schema violation and
fail the clarify run.
