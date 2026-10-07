# T-020: Demo script and record test results
Sprint: 4 | Epic: E9 Demo and Submission | Points: 2 | Depends on: T-019

## User story
As the presenter, I want a timed 5–8 minute demo script that walks setup → order → escalation →
recorded failure #1 → dashboard/audit, so the video shows every required beat with no dead air
and the test record closes with its results.

## Workplan references
- Section 9 — failure table: record failure #1 in the video; evidence #2 and #3 live in the
  test record (T-017).
- Section 10 block 8 — demo video (success, escalation, failure paths, audit log, dashboard).
- Section 13 item D — Demo Video (5 to 8 min).

## Acceptance criteria
- [ ] `docs/DEMO-SCRIPT.md`: scene list with exact commands, expected on-screen result, timing,
  fallbacks and reset steps between scenes.
- [ ] Scenes cover: health + seed; the T3 order walkthrough (reference quoted in the reply);
  complaint → `TKT-####` + staff alert visible in `logs/whatsapp-outbound.log`; recorded failure
  #1 (`LLM_PROVIDER=none` restart or `"forceLlmFailure": true`); failure #4
  (`WHATSAPP_FORCE_SEND_FAILURE=true` → `notificationStatus=failed`); dashboard plus one audit
  trace by correlation id.
- [ ] Video recorded (5–8 min, no credentials on screen); link stored alongside the test record.
- [ ] Test record (T-017) finalised with the demo run results; repo + video links verified
  accessible for 14 days.

## Implementation notes
- Make the demo reproducible: a shell block (or tiny script) issuing the simulate calls with
  fixed `messageId`s so every run produces the same walkthrough.
- Scene separator = stop/restart for scenes needing fresh state or different env
  (`LLM_PROVIDER=none`, then `WHATSAPP_FORCE_SEND_FAILURE=true` and a second `PORT`).
- The outbound log is the "sent" proof in simulated mode — show it on camera for the staff alert.

## Tests required
- Dry-run the whole script once before recording; the recording is the final acceptance evidence
  and its results flow into T-017's table.

## Explain-it notes
- Why failure #1 is the recorded failure (visual and safe — rules still answer, the audience
  sees graceful degradation) while #2/#3 are evidenced in the record per workplan §9.
- Simulated mode is the demo's superpower: no network, no Meta account, deterministic output.
- What fails first live: ngrok/session hiccups and LLM rate limits — both avoided by recording
  in simulated mode with the rules-only switch demonstrated on purpose.

## Status log
- (not started)
