# Bug: Something broke

## Description
After the update, the export feature stopped working. When I click "Export CSV", nothing happens.

## Environment
- Firefox 128
- Windows 11

## Notes
This is a sad-path fixture: the clarify-r-1 label is present but the hidden state
comment `<!-- CLARIFY_STATE round=N -->` was accidentally stripped (e.g. by a GitHub
webhook filtering tool or an issue-body edit). AC-V2-13 should detect the mismatch
and fail the clarify run with `stage:failed`.
