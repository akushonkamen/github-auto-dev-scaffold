# Feature: Add dark mode toggle

## Description
Add a dark mode toggle to the settings page. Should persist preference in localStorage.

## Requirements
- Toggle in Settings > Appearance
- Three modes: Light, Dark, System (follow OS preference)
- Persist choice in localStorage under `theme` key
- Apply immediately without page reload

## Notes
This fixture tests rapid-fire comment handling. The clarify loop's concurrency group
(`clarify-issue-N`, `cancel-in-progress: false`) should queue rapid comments rather
than racing. The sentinel marker `<!-- claude-clarify-round-N -->` in each clarify
comment prevents re-entry (AC-V2-3c). The PAT-owner filter (AC-V2-3b) prevents the
clarify loop from reacting to its own comments.

Test scenario:
1. Open fixture issue with `needs-clarify` label
2. Simulate 3 rapid author comments within 30 seconds
3. Verify only ONE clarify run is active at any time (concurrency queue)
4. Verify sentinel markers prevent duplicate clarify runs
5. Verify PAT owner comments are ignored
