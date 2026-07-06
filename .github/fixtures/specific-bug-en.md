# Bug: Login button unresponsive after form submission

## Steps to reproduce
1. Navigate to https://example.com/login
2. Enter valid credentials (tested with user@example.com / validPassword123)
3. Click the "Login" button
4. Observe: no visual feedback, no network request in DevTools, no console errors

## Expected behavior
- Button should show a loading spinner
- POST request to /api/auth/login should fire
- On success: redirect to /dashboard
- On failure: show inline error message below the form

## Environment
- Chrome 126.0.6478.127
- macOS 14.5
- Production (v2.3.1 deployed 2026-06-28)

## Additional context
- Issue started after v2.3.1 deployment
- Affects ~15% of users per Sentry (event ID: LOGIN_BUTTON_NOOP)
- Temporary workaround: refresh the page and try again
