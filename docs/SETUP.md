# Running the demonstration

Reading the PDF, source data and saved evidence does not require running n8n.

## Requirements

- An n8n environment supporting the supplied Data Table, OpenAI and authenticated Form nodes.
- Your own OpenAI/Gateway credentials and access to the model you select. Model calls may incur charges.
- An account allowed to execute the review workflow. Preserve the sign-in and reviewer checks.

These files are templates rather than a fully portable export of every deployed cloud setting. Node or model availability can differ by environment.

## Configure once

1. Import `01_Setup_34_Accounts.json` into a separate new workflow. Inspect the fictional fixture, then manually run Setup once. It writes 34 CRM and 34 delivery records from embedded JSON and prepares the queue and audit tables. Keep Setup unpublished.
2. Import `02_Scheduled_Processing.json` and `03_Human_Review.json` separately.
3. Copy the Setup completion `storage_config` value into both Run settings and Reviewer settings.
4. Set your sign-in email in Reviewer settings. Preserve `n8n User Auth`, execution-access requirements and user identity in the form output. Publish the review workflow and check sign-in before using the form.
5. Select your own model credentials in Classify and draft. Record the model used. Historical runs recorded `gpt-5.4-mini-2026-03-17`; that is evidence of those runs, not a guarantee of future model access.
6. Leave `force_run_key` blank and `simulate_input_failure` false for an ordinary initial demonstration. Publish the processing workflow and allow the scheduled trigger to run. Do not use manual execution as proof of an automatic trigger.

## Review and recovery

Open the review form's Production URL while signed in, select an account and inspect the saved draft, source facts and version. Approval marks that exact current version ready for manual sending; there is no email node.

If validation fails, inspect the failed execution and saved failure evidence before attempting recovery. Recovery keys are deliberately guarded against automatic repeated attempts. Do not erase audit history or bypass validation to make a run succeed.

After collecting demonstration evidence, stop the two-minute schedule when it is no longer needed. The repository does not change the state of the original cloud workflows.

## Local logic checks

With Node.js installed, run from the repository root:

```sh
node check_local.mjs
```

This writes `local_checks.json`. It checks local logic, fixtures, mocked responses and workflow structure. It makes no OpenAI call and does not execute n8n. Passing local checks is not proof that an imported workflow works in your environment.
