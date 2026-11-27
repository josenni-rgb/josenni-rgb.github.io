/**
 * Jaw surgery fluid log for Langley Oral & Maxillofacial Surgery.
 *
 * Paste this whole file into Extensions > Apps Script on the clinic sheet,
 * then follow apps-script/README.md.
 */

var CLINIC_EMAIL = "langleyoms@gmail.com";
var TZ = "America/Vancouver";
var LOG_SHEET = "Fluid Log";
var SUMMARY_SHEET = "Daily Summary";
var LOG_HEADERS = [
  "Timestamp received",
  "Patient",
  "Surgery date",
  "Date",
  "Hour",
  "Syringes",
  "Partial",
  "Device id"
];
var SUMMARY_HEADERS = [
  "Timestamp sent",
  "Date",
  "Patient",
  "Surgery date",
  "Hours logged",
  "Hours at 15/15",
  "Total syringes",
  "Hours under 10",
  "Device id"
];

function parsePostedRecord(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  var data;
  try {
    data = JSON.parse(String(raw));
  } catch (e) {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  var hour = Number(data.hour);
  var syringes = Number(data.syringes);
  if (!isFinite(hour) || hour < 0 || hour > 23) return null;
  hour = Math.round(hour);
  if (!isFinite(syringes) || syringes < 0 || syringes > 15) return null;
  syringes = Math.round(syringes);
  var patient = String(data.patient || "").trim();
  if (!patient) return null;
  var date = String(data.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  var deviceId = String(data.deviceId || "").trim();
  if (!deviceId) return null;
  var surgeryDate = String(data.surgeryDate || "").trim();
  if (surgeryDate && !/^\d{4}-\d{2}-\d{2}$/.test(surgeryDate)) surgeryDate = "";
  return {
    patient: patient,
    surgeryDate: surgeryDate,
    date: date,
    hour: hour,
    syringes: syringes,
    partial: data.partial === true || data.partial === "true" || data.partial === "yes",
    deviceId: deviceId
  };
}

function recordKey(rec) {
  return String(rec.deviceId) + "|" + String(rec.date) + "|" + String(rec.hour);
}

function decideLogWrite(existing, rec) {
  if (!rec) return "skip";
  if (!existing) return "append";
  if (!existing.partial && rec.partial) return "skip";
  if (!existing.partial && !rec.partial) return "skip";
  return "update";
}

function rowToLogRecord(row) {
  if (!row || !row.length) return null;
  return {
    patient: String(row[1] || ""),
    surgeryDate: String(row[2] || ""),
    date: String(row[3] || ""),
    hour: Number(row[4]),
    syringes: Number(row[5]),
    partial: String(row[6]).toLowerCase() === "yes" || row[6] === true,
    deviceId: String(row[7] || "")
  };
}

function logRecordToRow(rec, receivedAt) {
  return [
    receivedAt,
    rec.patient,
    rec.surgeryDate,
    rec.date,
    rec.hour,
    rec.syringes,
    rec.partial ? "yes" : "no",
    rec.deviceId
  ];
}

function findLogRowIndex(rows, rec) {
  var key = recordKey(rec);
  var i;
  for (i = 0; i < rows.length; i++) {
    var existing = rowToLogRecord(rows[i]);
    if (existing && recordKey(existing) === key) return i;
  }
  return -1;
}

function applyLogWrite(rows, rec, receivedAt) {
  if (!rec) return { action: "skip", rows: rows };
  var idx = findLogRowIndex(rows, rec);
  var existing = idx === -1 ? null : rowToLogRecord(rows[idx]);
  var action = decideLogWrite(existing, rec);
  if (action === "append") {
    rows.push(logRecordToRow(rec, receivedAt));
  } else if (action === "update" && idx !== -1) {
    rows[idx] = logRecordToRow(rec, receivedAt);
  }
  return { action: action, rows: rows };
}

function groupRowsByDevice(records, dateStr) {
  var groups = {};
  var i;
  for (i = 0; i < records.length; i++) {
    var rec = records[i];
    if (!rec || rec.date !== dateStr) continue;
    var id = rec.deviceId || rec.patient;
    if (!groups[id]) groups[id] = [];
    groups[id].push(rec);
  }
  return groups;
}

function summarizePatient(records) {
  var hours = {};
  var i;
  for (i = 0; i < records.length; i++) {
    var rec = records[i];
    var h = rec.hour;
    if (!hours[h] || (hours[h].partial && !rec.partial)) {
      hours[h] = rec;
    }
  }
  var keys = [];
  for (var k in hours) {
    if (hours.hasOwnProperty(k)) keys.push(Number(k));
  }
  keys.sort(function (a, b) { return a - b; });
  var at15 = 0;
  var total = 0;
  var under10 = [];
  var sample = hours[keys[0]] || records[0] || {};
  for (i = 0; i < keys.length; i++) {
    var row = hours[keys[i]];
    total += Number(row.syringes) || 0;
    if (Number(row.syringes) >= 15) at15 += 1;
    if (Number(row.syringes) < 10) {
      under10.push({ hour: keys[i], syringes: Number(row.syringes) || 0, partial: !!row.partial });
    }
  }
  return {
    patient: sample.patient || "",
    surgeryDate: sample.surgeryDate || "",
    deviceId: sample.deviceId || "",
    hoursLogged: keys.length,
    hoursAt15: at15,
    totalSyringes: total,
    under10: under10
  };
}

function formatHourLabel(hour) {
  var h = Number(hour);
  if (!isFinite(h)) return String(hour);
  var suffix = h >= 12 ? "PM" : "AM";
  var twelve = h % 12;
  if (twelve === 0) twelve = 12;
  return twelve + ":00 " + suffix;
}

function formatUnder10(list) {
  if (!list || !list.length) return "none";
  return list.map(function (item) {
    var bit = formatHourLabel(item.hour) + " (" + item.syringes + "/15)";
    if (item.partial) bit += " partial";
    return bit;
  }).join(", ");
}

function formatPatientEmail(summary, dateLabel) {
  var lines = [];
  lines.push("Fluid log for " + (summary.patient || "Unknown") + " · " + dateLabel);
  if (summary.surgeryDate) lines.push("Surgery date: " + summary.surgeryDate);
  lines.push("");
  lines.push("Hours logged: " + summary.hoursLogged);
  lines.push("Hours at 15/15: " + summary.hoursAt15);
  lines.push("Total syringes: " + summary.totalSyringes);
  lines.push("Hours under 10: " + formatUnder10(summary.under10));
  lines.push("");
  lines.push("Only hours this patient tracked on their phone are listed.");
  lines.push("Device id: " + (summary.deviceId || ""));
  return lines.join("\n");
}

function formatDateLabel(dateStr) {
  var p = String(dateStr).split("-");
  if (p.length !== 3) return dateStr;
  var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return days[dt.getDay()] + " " + dt.getDate() + " " + months[dt.getMonth()] + " " + dt.getFullYear();
}

function vancouverYmd(now) {
  if (typeof Utilities !== "undefined" && Utilities.formatDate) {
    return Utilities.formatDate(now || new Date(), TZ, "yyyy-MM-dd");
  }
  var d = now || new Date();
  var pad = function (n) { return n < 10 ? "0" + n : String(n); };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var missing = !existing[0];
  var i;
  for (i = 0; i < headers.length; i++) {
    if (String(existing[i] || "") !== headers[i]) missing = true;
  }
  if (missing) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function readLogRecords_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues();
  var out = [];
  var i;
  for (i = 0; i < values.length; i++) out.push(rowToLogRecord(values[i]));
  return out;
}

function handlePostedText(raw, receivedAt) {
  var rec = parsePostedRecord(raw);
  if (!rec) return { ok: false, error: "invalid" };
  return { ok: true, rec: rec, receivedAt: receivedAt || new Date() };
}

function doGet() {
  return ContentService.createTextOutput("Fluid log is running.");
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var raw = e && e.postData ? e.postData.contents : "";
    var parsed = handlePostedText(raw, new Date());
    if (!parsed.ok) {
      return ContentService.createTextOutput("invalid");
    }
    var ss = SpreadsheetApp.getActive();
    var sheet = ensureSheet_(ss, LOG_SHEET, LOG_HEADERS);
    var last = sheet.getLastRow();
    var rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues();
    var result = applyLogWrite(rows, parsed.rec, parsed.receivedAt);
    if (result.action === "append") {
      sheet.appendRow(logRecordToRow(parsed.rec, parsed.receivedAt));
    } else if (result.action === "update") {
      var idx = findLogRowIndex(rows, parsed.rec);
      if (idx !== -1) {
        sheet.getRange(idx + 2, 1, 1, LOG_HEADERS.length).setValues([
          logRecordToRow(parsed.rec, parsed.receivedAt)
        ]);
      }
    }
    return ContentService.createTextOutput(result.action);
  } finally {
    lock.releaseLock();
  }
}

function sendDailySummary() {
  var ss = SpreadsheetApp.getActive();
  var logSheet = ensureSheet_(ss, LOG_SHEET, LOG_HEADERS);
  var summarySheet = ensureSheet_(ss, SUMMARY_SHEET, SUMMARY_HEADERS);
  var today = vancouverYmd(new Date());
  var records = readLogRecords_(logSheet);
  var groups = groupRowsByDevice(records, today);
  var dateLabel = formatDateLabel(today);
  var sentAt = new Date();
  var id;
  for (id in groups) {
    if (!groups.hasOwnProperty(id)) continue;
    var summary = summarizePatient(groups[id]);
    var body = formatPatientEmail(summary, dateLabel);
    var subject = "Fluid log · " + (summary.patient || "Patient") + " · " + dateLabel;
    MailApp.sendEmail(CLINIC_EMAIL, subject, body);
    summarySheet.appendRow([
      sentAt,
      today,
      summary.patient,
      summary.surgeryDate,
      summary.hoursLogged,
      summary.hoursAt15,
      summary.totalSyringes,
      formatUnder10(summary.under10),
      summary.deviceId
    ]);
  }
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  ensureSheet_(ss, LOG_SHEET, LOG_HEADERS);
  ensureSheet_(ss, SUMMARY_SHEET, SUMMARY_HEADERS);

  var triggers = ScriptApp.getProjectTriggers();
  var i;
  for (i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "sendDailySummary") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("sendDailySummary")
    .timeBased()
    .atHour(20)
    .everyDays(1)
    .inTimezone(TZ)
    .create();
}
