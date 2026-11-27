# Review recovery with synthetic findings

Analyst status and provider status have different owners. A provider refresh can change a finding's version while an analyst has its details open. The version check prevents a decision based on an older view from overwriting current data.

## Refresh without closing the investigation

Choose **Refresh finding** in the drawer header after a synthetic import or a colleague's update. It reloads the current local finding, notes, analyst activity, and provider history, and refreshes the overview, queue, charts, and Region map. Filters stay selected; the queue returns to page 1. The drawer remains open even if the updated finding no longer matches the queue filters.

Resolution and note drafts stay in place. Notes/activity return to their newest pages and provider history reloads even if the finding's version did not change. A failed unchanged note keeps its retry protection through this action. **Reload details** in an error message performs the same refresh.

The button shows **Refreshing…** during the detail read, and saves are disabled until that read succeeds. A failed detail refresh keeps the drafts and requires a successful retry before saving. Other panels can finish independently or offer their own retry. An expired session still returns to sign-in and discards the temporary review state.

Refresh does not save a draft or run an import. Review any new provider/analyst state before choosing to save. Refresh is unavailable while a note or status save is pending; closing the drawer remains available.

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

For a baseline that has not yet received the update, an alternative is to follow steps 1–3 and then choose **Refresh finding** before saving. The provider context and history update while both drafts remain. This read adds no analyst activity; a subsequent explicit status save uses the refreshed version.

## Filter by provider status

Use **Provider status** beside the analyst filter to choose **Provider: Active**, **Provider: Archived**, **Provider: Resolved**, or **No provider data**. This narrows the queue, resource/time charts, and Region map together. Analyst status, priority, and source remain separate filters and can be combined with that selection.

After importing the synthetic provider-update scenario, select **Provider: Archived** and analyst status **New** to find archived provider records still awaiting analyst review. This can include the S3 finding from the walkthrough as well as other archived synthetic records. Open the S3 finding to inspect its provider history; choosing a filter does not change its analyst status.

**No provider data** finds records without provider-owned fields. **All provider statuses** includes them alongside imported records. **Clear filters**, including the button shown for empty results, removes all criteria. Every filter change returns the queue to page 1.

Overview cards show global totals. Charts and the map show matching findings observed in the last 30 UTC days, while the queue can also contain older records. Their totals can differ for that reason.

## Filter by resource location

Choose **Resource location** to select **Regional resources**, **Global resources**, or **Unknown location**. Regional resources expose an **AWS Region code** field. Enter a complete code such as `ap-southeast-1`, then choose **Apply Region**; typing alone leaves the applied filter unchanged. The helper text reports the applied code. Surrounding whitespace and uppercase letters are normalized on submission. Applying a blank code includes every regional resource.

You can also select a Region in the map's count list, including a **List only** code with no plotted marker, or choose a nonzero Regional, Global, or Unknown count. These choices retain analyst status, provider status, priority, and source criteria. Map markers remain informational. Counts describe the current filtered 30-day UTC window; zero-count scope buttons are disabled. Choose **All locations** to broaden the map before selecting another location, or use the selector directly to reach scopes with no recent matches.

To find an older-only Region, use the code field even if the map has no entry for it. The queue may contain matches while the charts and map show no matches in their period. Global and unknown locations remain separate, and legacy event metadata never determines this filter. The code field validates syntax rather than AWS Region availability; a well-formed unused code produces empty results.

Every applied change returns the queue to page 1. Switching scope clears the exact Region. Either **Clear filters** control removes all criteria, and **Refresh finding** preserves the applied location while retaining open-review drafts.

## Choose a source across the full dataset

The **Source** menu includes selectable sources from all stored findings, including later queue pages and records older than the chart/map window. Its choices stay available when other filters change. Selecting a source applies the same exact identifier to the queue, charts, and map and returns the queue to page 1. A source with only older findings can have queue results and empty analytics. Other criteria can also make a source's results empty.

Choose **Refresh sources** after new synthetic findings are imported to reload the menu independently. This keeps your current criteria, queue page, and open-review drafts in place. **Refresh finding** and other dashboard refreshes also reload the list. Refreshing source choices does not automatically select a new source or save a draft.

While loading, known choices remain usable. A failed read shows **Source list unavailable** with **Retry sources**; the selected source and previously loaded choices remain. This failure does not block the queue or drawer. An empty inventory has its own message, and an expired session returns to sign-in. If a selected source no longer appears in a refreshed inventory, its selection stays until you change or clear it.

**All sources** removes the source criterion. A source actually named `all` is a separate exact selection. Both **Clear filters** controls remove the applied source along with other criteria. The inventory contains only identifiers valid for source filtering; legacy findings with invalid identifiers remain available through unfiltered reads.

## Browse notes and analyst activity

Each list opens on its newest page and shows the total number of records for that finding. If there are more than 25, **Older notes** and **Newer notes**, or **Older activity events** and **Newer activity events**, move through pages. Records are displayed chronologically within each page. The range and page label show which part of the history is visible.

Paging one list leaves the other list and unsaved form text in place. After a successful note or status save, or a finding refresh, both lists open their newest page so recently recorded work is visible. Drafts in the other form survive that refresh.

A failed list read shows an error and its own retry control. Other successfully loaded sections remain available. If the session expires, **Reload finding details** recovers through the sign-in flow. Counts reflect each response; another analyst may add records between page requests.

## Retry a note after an interrupted save

The dashboard keeps a failed note submission associated with its unchanged trimmed text while that review remains open. If the server recorded the note before its response was lost, retrying **Add note** acknowledges the original note and its single activity event. If the first attempt never committed, the retry records it once. **Reload details** and **Refresh finding** keep this retry protection as well as the draft.

An acknowledged save clears the submission, so intentionally entering and saving the same text again records a separate note. Editing the submitted text starts a new submission too. The earlier note may already exist after an uncertain response, so inspect the notes before replacing the text with a different submission.

Closing or reopening the drawer, signing out, or refreshing the page discards the temporary retry state. If you copy the text into a new review, inspect existing notes before saving; that is a new submission. No write is automatically retried.

## Draft lifetime and pending saves

Draft text lives only in the open review's memory. Closing the drawer, pressing Escape, opening another finding, signing out, an expired session, or reloading the page discards it. No draft is written to browser storage. A successful save clears the submitted text only if it has not been edited while the request was pending; the other form's draft remains available.

Closing a review does not cancel a request already sent. A successful pending request still refreshes the queue. Its detail response or error cannot replace a later review, including one reopened for the same finding. Reopen the original finding to inspect the recorded result.

The [automated checks](testing.md) cover these synthetic application behaviors. This walkthrough performs no AWS calls and needs no live credentials.
