import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, Alert,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { loadData, saveData, todayKey, formatDisplayDate, addDays } from '../utils/storage';

// ── WCAG AA compliant status colors against white (#fff) ──────────────
// "Taken"   #1b5e20  contrast ~13.7:1  ✓
// "Skipped" #7f0000  contrast ~14.8:1  ✓
// "Empty"   #555555  contrast ~7.0:1   ✓
const COLOR = {
  taken: '#1b5e20',
  skipped: '#7f0000',
  empty: '#555555',
  blue: '#4f8ef7',
};

// ── HELPERS ───────────────────────────────────────────────────────────

function parseLocalDate(key) {
  return new Date(key + 'T12:00:00');
}

function keyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay(); // 0=Sun
}

function buildPDFHtml(data) {
  const log = data.log || {};
  const setColors = data.setColors || {};
  const entries = Object.entries(log).sort((a, b) => a[0].localeCompare(b[0]));
  const patientName = data.userName || '___________________________';
  const doctorName = data.doctorName || '';
  const dob = data.patientDOB
    ? new Date(data.patientDOB + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
    : '';
  const sheetDate = data.dosageSheetDate
    ? new Date(data.dosageSheetDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
    : '';
  const exportDate = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const isMD = data.currentSet === 5;
  const hasMinusOne = Object.values(log).some(e => e.set === -1);
  const ruSets = hasMinusOne ? [-1, 1, 2, 3, 4] : [1, 2, 3, 4];
  const todayStr = keyFromDate(new Date());

  let colHeaders = DOW_ABBR;
  let tableBody = '';

  if (!isMD && data.dosageSheetDate) {
    // RU sheet: generate full grid for all sets/weeks, fill log data where available
    const startDOW = new Date(data.dosageSheetDate + 'T12:00:00').getDay();
    colHeaders = Array.from({ length: 7 }, (_, i) => DOW_ABBR[(startDOW + i) % 7]);

    let calendarWeekIdx = 0;
    const HEADER_STYLE = 'background:#1a3a6b;color:#fff;font-weight:700;font-size:11px;padding:5px 8px;letter-spacing:1px;text-align:left';

    ruSets.forEach(setId => {
      const accent = setColors[setId] || '#4f8ef7';
      const lightBg = accent + '18';
      const headerLabel = setId === -1 ? 'SET -1' : `SET ${setId}`;
      tableBody += `<tr><td colspan="9" style="${HEADER_STYLE}">${headerLabel}</td></tr>`;

      [1, 2, 3].forEach(weekNum => {
        const weekStartDate = addDays(data.dosageSheetDate, calendarWeekIdx * 7);
        const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
        const drops = weekNum;
        const accent2 = accent;
        const weekNotes = [];

        const dateCells = weekDates.map(dateStr => {
          const d = new Date(dateStr + 'T12:00:00');
          const lbl = `${d.getMonth() + 1}/${d.getDate()}`;
          const e = log[dateStr];
          if (!e) {
            const isFuture = dateStr > todayStr;
            return isFuture ? '<td></td>' : `<td style="color:#bbb">${lbl}</td>`;
          }
          if (e.notes || e.reaction) {
            const note = `${lbl}:${e.status === 'skipped' ? ' SKIPPED' : ''}${e.reaction ? ' ⚠️ Adverse reaction' : ''}${e.notes ? ` — ${e.notes.replace(/</g, '&lt;')}` : ''}`;
            weekNotes.push(note);
          }
          if (e.status === 'taken') return `<td style="color:#1b5e20;font-weight:600">${lbl}</td>`;
          if (e.status === 'skipped') return `<td style="color:#7f0000;font-style:italic">${lbl}<br><small>SKIP</small></td>`;
          return `<td>${lbl}</td>`;
        }).join('');

        tableBody += `
          <tr>
            <td style="border-left:4px solid ${accent2};background:${lightBg};text-align:left;padding:5px 8px;white-space:nowrap;font-weight:700">Wk #${weekNum}</td>
            ${dateCells}
            <td style="border-right:4px solid ${accent2};background:${lightBg};font-weight:700;color:${accent2};white-space:nowrap;font-size:10px">${drops} DROP${drops !== 1 ? 'S' : ''}</td>
          </tr>`;

        if (weekNotes.length > 0) {
          tableBody += `<tr><td colspan="9" style="background:#fffbea;border-left:4px solid ${accent2};padding:4px 10px;font-size:10px;color:#555;text-align:left">${weekNotes.map(n => `• ${n}`).join('<br>')}</td></tr>`;
        }

        calendarWeekIdx++;
      });
    });

  } else if (entries.length > 0) {
    // MD sheet or no sheet date: generate from log entries
    const startDate = new Date(entries[0][0] + 'T12:00:00');
    const startDOW = startDate.getDay();
    colHeaders = Array.from({ length: 7 }, (_, i) => DOW_ABBR[(startDOW + i) % 7]);

    const endDate = new Date(entries[entries.length - 1][0] + 'T12:00:00');
    const allDates = [];
    const cur = new Date(startDate);
    while (cur <= endDate) { allDates.push(keyFromDate(cur)); cur.setDate(cur.getDate() + 1); }

    const weeks = [];
    for (let i = 0; i < allDates.length; i += 7) weeks.push(allDates.slice(i, i + 7));

    let currentWeekSet = null;
    let groupWeekNum = 0;
    const HEADER_STYLE = 'background:#1a3a6b;color:#fff;font-weight:700;font-size:11px;padding:5px 8px;letter-spacing:1px;text-align:left';

    weeks.forEach(weekDates => {
      let weekSet = null, weekDrops = null;
      const weekNotes = [];

      for (const dateStr of weekDates) {
        const e = log[dateStr];
        if (e) {
          if (weekSet == null && e.set != null) weekSet = e.set;
          if (!weekDrops && e.drops) weekDrops = e.drops;
          if (e.notes || e.reaction) {
            const d = new Date(dateStr + 'T12:00:00');
            const note = `${d.getMonth() + 1}/${d.getDate()}:${e.status === 'skipped' ? ' SKIPPED' : ''}${e.reaction ? ' ⚠️ Adverse reaction' : ''}${e.notes ? ` — ${e.notes.replace(/</g, '&lt;')}` : ''}`;
            weekNotes.push(note);
          }
        }
      }

      const accent = (weekSet != null && setColors[weekSet]) ? setColors[weekSet] : '#4f8ef7';
      const lightBg = accent + '18';

      if (weekSet !== currentWeekSet) {
        currentWeekSet = weekSet;
        groupWeekNum = 0;
        const headerLabel = weekSet === 5 ? 'MAINTENANCE' : weekSet != null ? `SET ${weekSet}` : '';
        if (headerLabel) tableBody += `<tr><td colspan="9" style="${HEADER_STYLE}">${headerLabel}</td></tr>`;
      }
      groupWeekNum++;

      const dateCells = weekDates.map(dateStr => {
        if (!dateStr) return '<td></td>';
        const e = log[dateStr];
        const d = new Date(dateStr + 'T12:00:00');
        const lbl = `${d.getMonth() + 1}/${d.getDate()}`;
        if (!e) return '<td></td>';
        if (e.status === 'taken') return `<td style="color:#1b5e20;font-weight:600">${lbl}</td>`;
        if (e.status === 'skipped') return `<td style="color:#7f0000;font-style:italic">${lbl}<br><small>SKIP</small></td>`;
        return `<td>${lbl}</td>`;
      }).join('');

      tableBody += `
        <tr>
          <td style="border-left:4px solid ${accent};background:${lightBg};text-align:left;padding:5px 8px;white-space:nowrap;font-weight:700">Wk #${groupWeekNum}</td>
          ${dateCells}
          <td style="border-right:4px solid ${accent};background:${lightBg};font-weight:700;color:${accent};white-space:nowrap;font-size:10px">${weekDrops ? `${weekDrops} DROP${weekDrops !== 1 ? 'S' : ''}` : '—'}</td>
        </tr>`;

      if (weekNotes.length > 0) {
        tableBody += `<tr><td colspan="9" style="background:#fffbea;border-left:4px solid ${accent};padding:4px 10px;font-size:10px;color:#555;text-align:left">${weekNotes.map(n => `• ${n}`).join('<br>')}</td></tr>`;
      }
    });
  }

  const taken = entries.filter(([, e]) => e.status === 'taken').length;
  const skipped = entries.filter(([, e]) => e.status === 'skipped').length;
  const reactions = entries.filter(([, e]) => e.reaction).length;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:20px;font-size:12px;color:#222}
    h2{font-size:14px;color:#1a3a6b;margin:0 0 10px;text-align:center;text-transform:uppercase;letter-spacing:1px}
    .prow{display:flex;border:1px solid #999;margin-bottom:10px}
    .pf{flex:1;padding:5px 8px;border-right:1px solid #ccc}
    .pf:last-child{border-right:none}
    .pl{font-size:9px;font-weight:700;color:#777;text-transform:uppercase;letter-spacing:0.4px;display:block;margin-bottom:1px}
    .pv{font-size:11px;color:#222;border-bottom:1px solid #999;min-height:16px;display:block}
    .sumrow{display:flex;gap:8px;margin-bottom:10px}
    .stat{flex:1;text-align:center;background:#f0f4ff;padding:6px;border-radius:4px}
    .sv{font-size:18px;font-weight:800;color:#1a3a6b}
    .sl{font-size:9px;color:#555}
    table{width:100%;border-collapse:collapse;font-size:10px}
    th{background:#1a3a6b;color:#fff;padding:5px 3px;text-align:center;font-size:9px}
    td{padding:4px 2px;border:1px solid #ddd;text-align:center;vertical-align:middle}
    .footer{margin-top:12px;font-size:9px;color:#999;border-top:1px solid #eee;padding-top:6px;text-align:center}
  </style></head><body>
    <h2>Allergy Drop Tracker — Dosage Log</h2>
    <div class="prow">
      <div class="pf" style="flex:2"><span class="pl">Patient Name</span><span class="pv">${patientName}</span></div>
      <div class="pf"><span class="pl">Sheet Date</span><span class="pv">${sheetDate}</span></div>
    </div>
    <div class="prow">
      <div class="pf" style="flex:2"><span class="pl">Date of Birth</span><span class="pv">${dob}</span></div>
      <div class="pf"><span class="pl">Dr.</span><span class="pv">${doctorName}</span></div>
    </div>
    <div class="sumrow">
      <div class="stat"><div class="sv">${entries.length}</div><div class="sl">Total</div></div>
      <div class="stat"><div class="sv" style="color:#1b5e20">${taken}</div><div class="sl">Taken</div></div>
      <div class="stat"><div class="sv" style="color:#7f0000">${skipped}</div><div class="sl">Skipped</div></div>
      <div class="stat"><div class="sv" style="color:#b45309">${reactions}</div><div class="sl">Reactions</div></div>
    </div>
    <table>
      <thead><tr>
        <th style="text-align:left;padding-left:6px">Week</th>
        ${colHeaders.map(h => `<th>${h}</th>`).join('')}
        <th>Drops</th>
      </tr></thead>
      <tbody>${tableBody || '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:16px">No entries yet</td></tr>'}</tbody>
    </table>
    <div class="footer">Drops are applied under the tongue and held for two minutes, then swallowed. &nbsp;·&nbsp; Generated by Allergy Drop Tracker &nbsp;·&nbsp; ${exportDate}</div>
  </body></html>`;
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────

export default function LogScreen() {
  const [data, setData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [notes, setNotes] = useState('');
  const [reaction, setReaction] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef(null);

  useFocusEffect(useCallback(() => {
    loadData().then(d => { setData(d); fillFields(d, selectedDate); });
  }, [selectedDate]));

  function fillFields(d, date) {
    const entry = d?.log?.[date];
    setNotes(entry?.notes || '');
    setReaction(entry?.reaction || false);
    setDirty(false);
  }

  function selectDate(date) {
    setSelectedDate(date);
    if (data) fillFields(data, date);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function changeMonth(delta) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    // Don't navigate past current month
    const now = new Date();
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return;
    setViewMonth(m);
    setViewYear(y);
  }

  async function saveEntry() {
    const existing = data?.log?.[selectedDate] || {};
    const updated = {
      ...data,
      log: {
        ...data.log,
        [selectedDate]: {
          status: existing.status || 'manual',
          set: existing.set || data.currentSet,
          week: existing.week || data.currentWeek,
          drops: existing.drops || data.currentWeek,
          ...existing,
          notes,
          reaction,
        },
      },
    };
    setData(updated);
    await saveData(updated);
    setDirty(false);
  }

  async function exportPDF() {
    try {
      setExporting(true);
      const html = buildPDFHtml(data);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Export Dose Log' });
      } else {
        Alert.alert('Saved', `PDF saved to:\n${uri}`);
      }
    } catch (e) {
      Alert.alert('Export failed', e.message);
    } finally {
      setExporting(false);
    }
  }

  if (!data) return (
    <View style={[s.root, s.center]}>
      <Text style={s.muted}>Loading...</Text>
    </View>
  );

  const today = todayKey();
  const entry = data.log?.[selectedDate];

  return (
    <ScrollView ref={scrollRef} style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* ── DAY CARD ── */}
      <View style={s.card}>
        <Text style={s.cardDateLabel}>{formatDisplayDate(selectedDate)}</Text>

        {/* Status badge */}
        {entry && (
          <View style={s.statusBadge}>
            <Text style={[s.statusBadgeText, { color: entry.status === 'taken' ? COLOR.taken : entry.status === 'skipped' ? COLOR.skipped : COLOR.empty }]}>
              {entry.status === 'taken' ? '✓ Taken' : entry.status === 'skipped' ? '✗ Skipped' : '— Manual'}
            </Text>
            {entry.set && (
              <Text style={s.statusMeta}>Set {entry.set}  ·  {entry.drops} drop{entry.drops !== 1 ? 's' : ''}</Text>
            )}
          </View>
        )}
        {!entry && (
          <Text style={[s.statusBadgeText, { color: COLOR.empty }]}>No entry — tap fields below to add</Text>
        )}

        {/* Notes */}
        <Text style={s.fieldLabel}>Notes</Text>
        <TextInput
          style={s.input}
          placeholder="Add notes for this day..."
          placeholderTextColor="#999"
          value={notes}
          onChangeText={v => { setNotes(v); setDirty(true); }}
          multiline numberOfLines={3} textAlignVertical="top"
        />

        {/* Reaction */}
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Adverse reaction?</Text>
          <Switch value={reaction}
            onValueChange={v => { setReaction(v); setDirty(true); }}
            trackColor={{ true: '#b45309', false: '#ccc' }}
            thumbColor={reaction ? '#fff' : '#fff'} />
        </View>

        <TouchableOpacity style={[s.saveBtn, !dirty && s.saveBtnOff]} onPress={saveEntry} disabled={!dirty}>
          <Text style={s.saveBtnText}>{dirty ? 'Save' : 'Saved'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── CALENDAR ── */}
      <View style={s.calCard}>
        {/* Month navigation */}
        <View style={s.monthNav}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={s.monthArrow}>
            <Text style={s.monthArrowText}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthTitle}>
            {new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
          <TouchableOpacity
            onPress={() => changeMonth(1)}
            style={s.monthArrow}
            disabled={viewYear === new Date().getFullYear() && viewMonth === new Date().getMonth()}>
            <Text style={[s.monthArrowText,
              viewYear === new Date().getFullYear() && viewMonth === new Date().getMonth() && s.monthArrowOff]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Day of week headers */}
        <View style={s.dowRow}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <Text key={d} style={s.dowLabel}>{d}</Text>
          ))}
        </View>

        {/* Calendar grid */}
        <CalendarGrid
          year={viewYear} month={viewMonth}
          log={data.log} today={today}
          selected={selectedDate}
          onSelect={selectDate}
        />
      </View>

      {/* ── EXPORT ── */}
      <TouchableOpacity style={[s.exportBtn, exporting && s.exportBtnOff]} onPress={exportPDF} disabled={exporting}>
        <Text style={s.exportBtnText}>{exporting ? 'Generating PDF…' : '📄  Export Log as PDF'}</Text>
      </TouchableOpacity>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

// ── CALENDAR GRID ─────────────────────────────────────────────────────

function CalendarGrid({ year, month, log, today, selected, onSelect }) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDOW = getFirstDayOfWeek(year, month);
  const todayDate = parseLocalDate(today);

  const cells = [];
  // Leading empty cells
  for (let i = 0; i < firstDOW; i++) cells.push(null);
  // Day cells
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  return (
    <View>
      {rows.map((row, ri) => (
        <View key={ri} style={cg.row}>
          {row.map((day, ci) => {
            if (!day) return <View key={ci} style={cg.cell} />;
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const entry = log?.[dateKey];
            const isToday = dateKey === today;
            const isSelected = dateKey === selected;
            const isFuture = new Date(dateKey + 'T12:00:00') > todayDate;

            let statusText = '';
            let statusColor = COLOR.empty;
            let notesSnippet = '';

            if (entry) {
              if (entry.status === 'taken') { statusText = 'Taken'; statusColor = COLOR.taken; }
              else if (entry.status === 'skipped') { statusText = 'Skipped'; statusColor = COLOR.skipped; }
              else { statusText = 'Manual'; statusColor = COLOR.empty; }
              if (entry.notes) notesSnippet = entry.notes.length > 18 ? entry.notes.slice(0, 16) + '…' : entry.notes;
            }

            return (
              <TouchableOpacity
                key={ci}
                style={[cg.cell, isSelected && cg.cellSelected, isToday && cg.cellToday, isFuture && cg.cellFuture]}
                onPress={() => !isFuture && onSelect(dateKey)}
                disabled={isFuture}
                activeOpacity={0.7}
              >
                <Text style={[cg.dayNum, isToday && cg.dayNumToday]}>{day}</Text>
                {!isFuture && (
                  entry ? (
                    <>
                      <Text style={[cg.statusText, { color: statusColor }]}>{statusText}</Text>
                      {entry.set && <Text style={cg.metaText}>Set {entry.set}</Text>}
                      {entry.drops && <Text style={cg.metaText}>{entry.drops} drop{entry.drops !== 1 ? 's' : ''}</Text>}
                      {notesSnippet ? <Text style={cg.notesText}>{notesSnippet}</Text> : null}
                    </>
                  ) : (
                    <Text style={cg.emptyText}>Tap to{'\n'}enter</Text>
                  )
                )}
              </TouchableOpacity>
            );
          })}
          {/* Fill trailing empty cells in last row */}
          {row.length < 7 && Array(7 - row.length).fill(null).map((_, i) => (
            <View key={`trail-${i}`} style={cg.cell} />
          ))}
        </View>
      ))}
    </View>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f0f4ff' },
  content: { padding: 14, gap: 14 },
  center: { justifyContent: 'center', alignItems: 'center' },
  muted: { color: '#555', fontSize: 15 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    elevation: 3, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  cardDateLabel: { fontSize: 16, fontWeight: '800', color: '#1a1a2e', marginBottom: 6 },

  statusBadge: { marginBottom: 12 },
  statusBadgeText: { fontSize: 18, fontWeight: '700' },
  statusMeta: { fontSize: 13, color: '#555', marginTop: 2 },

  fieldLabel: { fontSize: 13, color: '#444', marginBottom: 6, marginTop: 10, fontWeight: '600' },
  input: {
    borderWidth: 1.5, borderColor: '#dde4ff', borderRadius: 10,
    padding: 12, fontSize: 14, color: '#222', minHeight: 76,
    backgroundColor: '#fafbff',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  switchLabel: { fontSize: 15, color: '#333', fontWeight: '500' },
  saveBtn: { backgroundColor: '#4f8ef7', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 14 },
  saveBtnOff: { backgroundColor: '#b3ceff' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  calCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14,
    elevation: 3, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthArrow: { padding: 8 },
  monthArrowText: { fontSize: 28, color: '#4f8ef7', fontWeight: '600', lineHeight: 32 },
  monthArrowOff: { color: '#ccc' },
  monthTitle: { fontSize: 17, fontWeight: '800', color: '#1a1a2e' },

  dowRow: { flexDirection: 'row', marginBottom: 4 },
  dowLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#555', letterSpacing: 0.3 },

  exportBtn: {
    backgroundColor: '#fff', borderRadius: 12, padding: 15, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#b3ceff', elevation: 1,
  },
  exportBtnOff: { opacity: 0.5 },
  exportBtnText: { color: '#1a3a6b', fontWeight: '700', fontSize: 15 },
});

// Calendar grid cell styles
const CELL_SIZE = 48;

const cg = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 3 },
  cell: {
    flex: 1, minHeight: CELL_SIZE, borderRadius: 8, padding: 3,
    margin: 1, backgroundColor: '#f8f9ff', alignItems: 'flex-start',
  },
  cellSelected: { borderWidth: 2, borderColor: '#4f8ef7', backgroundColor: '#eef3ff' },
  cellToday: { borderWidth: 2, borderColor: '#1a3a6b' },
  cellFuture: { backgroundColor: '#f3f4f6', opacity: 0.5 },

  dayNum: { fontSize: 11, fontWeight: '700', color: '#444', lineHeight: 14 },
  dayNumToday: { color: '#1a3a6b' },

  statusText: { fontSize: 9, fontWeight: '800', marginTop: 1, lineHeight: 12 },
  metaText: { fontSize: 8, color: '#444', lineHeight: 11 },
  notesText: { fontSize: 7, color: '#555', lineHeight: 10, fontStyle: 'italic' },
  emptyText: { fontSize: 8, color: '#888', marginTop: 2, lineHeight: 11, textAlign: 'center', width: '100%' },
});
