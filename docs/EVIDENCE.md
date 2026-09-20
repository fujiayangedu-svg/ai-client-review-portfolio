# Evidence register

Evidence was supplied from the author's n8n demonstration and checked against the fictional fixture. The repository contains selected copies, not every private source artifact.

| Execution | Saved accounts | Version | Evidence |
| --- | --- | --- | --- |
| 98 | C001–C008 | 1 | Complete queue snapshot |
| 234 | C009–C016 | 2 | Complete queue snapshot; recovery of failed second batch |
| 270 | C017–C024 | 3 | Complete queue snapshot; recovery after the C017 mismatch |
| 272 | C025–C032 | 1 | Complete queue snapshot |
| 276 | C033–C034 | 2 | Completion JSON and complete queue snapshot |

The saved queue contains 34 unique accounts and source snapshots matching the fixture: 10 Green, 12 Amber, 8 Red and 4 Review Pending. It was captured before C002's approval. See `evidence/queue_before_C002_approval.json` and `saved_output_review.json`.

## Human decision

The displayed-version screenshot identified C002, version 1, `GEN-98-C002-V1`. The subsequent confirmation says approval was recorded, the version was ready for manual sending and no client email was sent. Only the confirmation image is included here. The displayed-version screenshot includes unrelated desktop content and is retained privately. Approval execution ID and raw Save applied decision JSON were not collected. Do not substitute the old four-account prototype's execution 10.

## Observed failure

Execution 238, run `RESUME-01-B03`, misclassified C017 as Green at the 14-day Amber boundary. Seven of eight classifications in that failed batch matched the rubric. Audit row 37 recorded RUN_FAILED for the correct run, and eight claimed queue rows were blocked as Processing failed / Not ready. The sanitized audit output and assessment are included. These observations demonstrate this error path, not every possible failure.

Execution 100 exposed a separate month-start mistake and a defect in initial failure-to-run association. Those issues were investigated before recovery. The selected repository evidence does not reproduce the complete earlier debugging archive.

## Configuration and interpretation

FIX03 changed the division of work: code computes the rubric decision and the model explains it and writes the draft. The successful saved outputs span earlier and later configurations. Do not calculate a single independent AI accuracy score from their final labels. A fresh full cloud workflow export and detailed prompt metadata for every final execution were not collected.

The observed invalid-JSON failure shown in an earlier screenshot has no supplied raw model response, so no exact cause is asserted. Later saved results do not prove that every future response will be valid.

## Redactions

Selected JSON copies replace workspace table IDs and any populated reviewer identity fields. Account names and contacts in the fixture are fictional and retained. Execution IDs, version references and response IDs are retained to trace the supplied evidence. Model output text and observed outcomes have not been rewritten to improve results.

## Not demonstrated

Return for revision, automatic revision from feedback, stale-form rejection, fresh deployment from this repository, live CRM access, a business-day calendar, network/timeout handling, client-message sending and business time savings.
