# Review recovery with synthetic findings

Analyst status and provider status have different owners. A provider refresh can change a finding's version while an analyst has its details open. The version check prevents a decision based on an older view from overwriting current data.

## What happens during a conflict

The API rejects a stale status save with 409. The dashboard refreshes the queue, analytics, and finding details, keeps unsaved resolution and note text in the open drawer, and asks the analyst to review the refreshed details before saving again. It does not resubmit the action automatically.

Status and note saves are disabled while details load. If the refresh fails, the error offers **Reload details** and saves remain disabled until a reload succeeds. When another analyst has changed the status, the **Move to** list shows transitions allowed by the current status. Review that selection as well as the draft text before retrying.

Other rejected saves leave the queue usable and keep the submitted draft available for a manual retry. If a note's response is lost, keep the review open. You can use **Reload details** to inspect recorded notes, then retry the unchanged text; the original submission is reused without adding a duplicate note or activity event.

## Demonstrate a provider update during an open review

Start the local Compose services and sign in as an analyst using the [README setup](../README.md#preview-the-dashboard). This example needs a local development database where the committed `provider-update` scenario has not yet been applied. Re-importing the older baseline cannot undo a newer provider snapshot.

1. Import the baseline from the repository root:

   ```text
   docker compose exec api flask --app tracker:create_app access-analyzer-import-fixture --confirm-synthetic
   ```

2. Open **External access: AWS::S3::Bucket**. With its analyst status **New**, select **Dismissed**. Enter a fabricated resolution reason and an investigation note, leaving both unsaved.
3. Keep the drawer open and run the update in another terminal:

   ```text
   docker compose exec api flask --app tracker:create_app access-analyzer-import-fixture --confirm-synthetic --scenario provider-update
   ```

4. Click **Save status**. The stale save is rejected. After the automatic refresh, the provider status is **Archived**, public access is **No**, and triage priority is **Medium**. Analyst status is still **New**, and both draft text fields retain their contents.
5. Review the provider context and history, then click **Save status** again. The reviewed save changes analyst status to **Dismissed** and records one status change in Analyst activity. The rejected attempt adds no activity. Provider history remains separate.
6. The note is still a draft. Click **Add note** separately to record it and its analyst activity event.

Repeating the same update creates no new version or conflict. To demonstrate a colleague's change on existing synthetic data, open the same finding in two tabs. Save an allowed status transition in the first tab, then try to save the second tab's older view. The second review must refresh and use a currently allowed transition before retrying.

## Browse notes and analyst activity

Each list opens on its newest page and shows the total number of records for that finding. If there are more than 25, **Older notes** and **Newer notes**, or **Older activity events** and **Newer activity events**, move through pages. Records are displayed chronologically within each page. The range and page label show which part of the history is visible.

Paging one list leaves the other list and unsaved form text in place. After a successful note or status save, or a finding refresh, both lists open their newest page so recently recorded work is visible. Drafts in the other form survive that refresh.

A failed list read shows an error and its own retry control. Other successfully loaded sections remain available. If the session expires, **Reload finding details** recovers through the sign-in flow. Counts reflect each response; another analyst may add records between page requests.

## Retry a note after an interrupted save

The dashboard keeps a failed note submission associated with its unchanged trimmed text while that review remains open. If the server recorded the note before its response was lost, retrying **Add note** acknowledges the original note and its single activity event. If the first attempt never committed, the retry records it once. **Reload details** keeps this retry protection as well as the draft.

An acknowledged save clears the submission, so intentionally entering and saving the same text again records a separate note. Editing the submitted text starts a new submission too. The earlier note may already exist after an uncertain response, so inspect the notes before replacing the text with a different submission.

Closing or reopening the drawer, signing out, or refreshing the page discards the temporary retry state. If you copy the text into a new review, inspect existing notes before saving; that is a new submission. No write is automatically retried.

## Draft lifetime and pending saves

Draft text lives only in the open review's memory. Closing the drawer, pressing Escape, opening another finding, signing out, an expired session, or reloading the page discards it. No draft is written to browser storage. A successful save clears the submitted text only if it has not been edited while the request was pending; the other form's draft remains available.

Closing a review does not cancel a request already sent. A successful pending request still refreshes the queue. Its detail response or error cannot replace a later review, including one reopened for the same finding. Reopen the original finding to inspect the recorded result.

The [automated checks](testing.md) cover these synthetic application behaviors. This walkthrough performs no AWS calls and needs no live credentials.
