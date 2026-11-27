# Daily fluid log for the clinic

This connects the jaw surgery fluid tracker to a Google Sheet and emails **langleyoms@gmail.com** each evening.

You only need to do this once. A computer with a web browser is enough. You do not need to know how to code.

## Before you start

1. Sign in to Google with the clinic account that should own the sheet (the same account that can read **langleyoms@gmail.com** mail is best).
2. Have this GitHub folder open, or download `fluid-log.gs` from this repo.

## 1. Make the spreadsheet

1. Go to [Google Sheets](https://sheets.google.com) and click **Blank** to make a new spreadsheet.
2. Name it something like **Jaw surgery fluid log**.

## 2. Paste the script

1. In the sheet, open **Extensions → Apps Script**.
2. A new tab opens with a file named `Code.gs`. Select everything in that file and delete it.
3. Open `fluid-log.gs` from this folder. Select all of it, copy, and paste it into the Apps Script editor.
4. Click the disk icon (**Save project**). You can name the project **Fluid log**.

## 3. Run setup

1. At the top of the Apps Script editor, open the function list (it may say `doGet` or `doPost`) and choose **setup**.
2. Click **Run**.
3. The first time, Google asks for permission. Click **Review permissions**, pick the clinic Google account, then **Advanced → Go to Fluid log (unsafe)** (Google shows that warning for any clinic-written script). Click **Allow**.
4. When it finishes, the sheet will have two tabs: **Fluid Log** and **Daily Summary**. A clock trigger is created so a summary email goes out around **8:00 PM Vancouver time**.

If you ever run **setup** again, that is safe. It refreshes the tabs and replaces the 8 PM trigger so you do not get two emails.

## 4. Turn it into a web app

Patients’ phones send each hour to this web app.

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear next to **Select type** and choose **Web app**.
3. Fill in:
   - **Description:** `Fluid log`
   - **Execute as:** **Me** (the clinic account)
   - **Who has access:** **Anyone**
4. Click **Deploy**.
5. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/…/exec`.

**Anyone** is required so a patient’s phone can send the hourly totals. The URL is not a password. The script only stores first name + last initial, optional surgery date, hour, syringe count, and a random device id. It does not store PHNs, full last names, birthdates, emails, or phone numbers.

## 5. Point the tracker at this URL

1. In this website repo, open `jaw-surgery-journey/fluids/config.js`.
2. Paste the web app URL between the quotes:

```
var ENDPOINT_URL = "https://script.google.com/macros/s/YOUR-ID/exec";
```

3. Save that file and publish the website as you usually do (merge to `main` after you have reviewed the pull request). Until this URL is pasted, the tracker still works on the phone but nothing is sent to the clinic.

## 6. Quick check

1. Open the web app URL in a browser. You should see: `Fluid log is running.`
2. On your phone, open the fluid tracker, enter a test name like **Test P.**, tap a few syringes, then tap **Send today's log now**.
3. Refresh the Google Sheet. You should see a row on **Fluid Log**.
4. Optional: in Apps Script, choose **sendDailySummary** and click **Run**. **langleyoms@gmail.com** should get one email for that test patient. Delete the test row from the sheet when you are done.

## What the clinic gets

Each finished clock hour (and any hours still waiting if the phone was offline) becomes one row:

| Timestamp received | Patient | Surgery date | Date | Hour | Syringes | Partial | Device id |
| --- | --- | --- | --- | --- | --- | --- | --- |

Around 8 PM Vancouver time, each patient who logged that day gets **one email** with:

- hours logged
- hours at 15/15
- total syringes
- any logged hour under 10, flagged

The same figures are appended to the **Daily Summary** tab.

**Partial** means the patient tapped **Send today's log now** before the hour ended. When the hour actually ends, that row is updated with the final count.

## If something goes wrong

- **Sheet did not change:** confirm **Who has access** is **Anyone**, and that `ENDPOINT_URL` in `config.js` is the full web app URL with no extra space.
- **Permission errors when running setup:** run **setup** again and Allow the clinic account.
- **No 8 PM email:** run **setup** again. In Apps Script, open **Triggers** (clock icon) and confirm **sendDailySummary** is scheduled daily around 20:00, timezone **America/Vancouver**.
- **Need a new URL:** **Deploy → Manage deployments → Edit → Version: New version → Deploy**, then paste the new URL into `config.js`.
