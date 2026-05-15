import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Switch, Alert,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
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

function buildPDFFilename(data) {
  const parts = (data.userName || '').trim().split(/\s+/);
  const fi = parts[0]?.[0]?.toUpperCase() || 'X';
  const last = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || 'User');
  const d = data.dosageSheetDate || new Date().toISOString().slice(0, 10);
  const [y, m, day] = d.split('-');
  return `${fi}_${last}_${m}${day}${y}.pdf`;
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

  const isMD = data.currentSet === 5;
  const hasMinusOne = Object.values(log).some(e => e.set === -1);
  const ruSets = hasMinusOne ? [-1, 1, 2, 3, 4] : [1, 2, 3, 4];
  const HEADER_STYLE = 'background:#1a3a6b;color:#fff;font-weight:700;font-size:11px;padding:5px 8px;letter-spacing:1px;text-align:left';

  function fmtDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function buildWeekRow(weekDates, weekLabel, drops, accent) {
    const lightBg = accent + '18';
    const takenDates = [];
    const weekNotes = [];

    for (const dateStr of weekDates) {
      const e = log[dateStr];
      if (!e) continue;
      if (e.status === 'taken' || e.status === 'manual') takenDates.push(fmtDate(dateStr));
      const parts = [];
      if (e.status === 'skipped') parts.push('SKIPPED');
      if (e.reaction) parts.push('⚠ Adverse reaction');
      if (e.notes) parts.push(e.notes.replace(/</g, '&lt;'));
      if (e.status === 'skipped' || parts.length > 0) {
        weekNotes.push(`${fmtDate(dateStr)}: ${parts.join(' — ')}`);
      }
    }

    let rows = `
      <tr>
        <td style="border-left:4px solid ${accent};background:${lightBg};text-align:left;padding:5px 8px;white-space:nowrap;font-weight:700">${weekLabel}</td>
        <td style="text-align:left;padding:5px 10px;color:#1b5e20;font-weight:600">${takenDates.join(', ') || '—'}</td>
        <td style="border-right:4px solid ${accent};background:${lightBg};font-weight:700;color:${accent};white-space:nowrap;font-size:10px;text-align:center">${drops ? `${drops} DROP${drops !== 1 ? 'S' : ''}` : '—'}</td>
      </tr>`;
    if (weekNotes.length > 0) {
      rows += `<tr><td colspan="3" style="background:#fffbea;border-left:4px solid ${accent};padding:4px 10px;font-size:10px;color:#555;text-align:left">${weekNotes.map(n => `• ${n}`).join('<br>')}</td></tr>`;
    }
    return rows;
  }

  let tableBody = '';

  if (!isMD && data.dosageSheetDate) {
    let calendarWeekIdx = 0;
    ruSets.forEach(setId => {
      const accent = setColors[setId] || '#4f8ef7';
      const headerLabel = setId === -1 ? 'SET -1' : `SET ${setId}`;
      tableBody += `<tr><td colspan="3" style="${HEADER_STYLE}">${headerLabel}</td></tr>`;
      [1, 2, 3].forEach(weekNum => {
        const weekStartDate = addDays(data.dosageSheetDate, calendarWeekIdx * 7);
        const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
        tableBody += buildWeekRow(weekDates, `Wk #${weekNum}`, weekNum, accent);
        calendarWeekIdx++;
      });
    });

  } else if (entries.length > 0) {
    const startDate = new Date(entries[0][0] + 'T12:00:00');
    const endDate = new Date(entries[entries.length - 1][0] + 'T12:00:00');
    const allDates = [];
    const cur = new Date(startDate);
    while (cur <= endDate) { allDates.push(keyFromDate(cur)); cur.setDate(cur.getDate() + 1); }
    const weeks = [];
    for (let i = 0; i < allDates.length; i += 7) weeks.push(allDates.slice(i, i + 7));

    let currentWeekSet = null;
    let groupWeekNum = 0;
    weeks.forEach(weekDates => {
      let weekSet = null, weekDrops = null;
      for (const dateStr of weekDates) {
        const e = log[dateStr];
        if (e) {
          if (weekSet == null && e.set != null) weekSet = e.set;
          if (!weekDrops && e.drops) weekDrops = e.drops;
        }
      }
      const accent = (weekSet != null && setColors[weekSet]) ? setColors[weekSet] : '#4f8ef7';
      if (weekSet !== currentWeekSet) {
        currentWeekSet = weekSet;
        groupWeekNum = 0;
        const headerLabel = weekSet === 5 ? 'MAINTENANCE' : weekSet != null ? `SET ${weekSet}` : '';
        if (headerLabel) tableBody += `<tr><td colspan="3" style="${HEADER_STYLE}">${headerLabel}</td></tr>`;
      }
      groupWeekNum++;
      tableBody += buildWeekRow(weekDates, `Wk #${groupWeekNum}`, weekDrops, accent);
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
    th{background:#1a3a6b;color:#fff;padding:5px 8px;text-align:left;font-size:9px}
    td{padding:4px 2px;border:1px solid #ddd;vertical-align:middle}
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
        <th style="width:60px">Week</th>
        <th>Dates Taken</th>
        <th style="width:60px;text-align:center">Drops</th>
      </tr></thead>
      <tbody>${tableBody || '<tr><td colspan="3" style="text-align:center;color:#aaa;padding:16px">No entries yet</td></tr>'}</tbody>
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
  const [editStatus, setEditStatus] = useState(null);
  const [editSet, setEditSet] = useState(null);
  const [editDrops, setEditDrops] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef(null);

  useFocusEffect(useCallback(() => {
    loadData().then(d => { setData(d); fillFields(d, selectedDate); });
  }, [selectedDate]));

  function fillFields(d, date) {
    const entry = d?.log?.[date];
    setNotes(entry?.notes || '');
    setReaction(entry?.reaction || false);
    setEditStatus(entry?.status || null);
    setEditSet(entry?.set ?? d?.currentSet ?? null);
    setEditDrops(entry?.drops ?? (d?.currentSet === 5 ? d?.maintenanceDrops : Math.min(d?.currentWeek ?? 1, 3)));
    setDirty(false);
  }

  function selectDate(date) {
    setSelectedDate(date);
    setEditMode(false);
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
    const resolvedStatus = editStatus || existing.status || 'manual';
    const resolvedSet = editSet ?? existing.set ?? data.currentSet;
    const resolvedDrops = editDrops ?? existing.drops ?? Math.min(data.currentWeek, 3);
    // Infer week: MD always week 1 if changing to MD; otherwise keep existing or use drops as proxy
    const resolvedWeek = resolvedSet === 5
      ? (existing.set === 5 ? existing.week : 1)
      : existing.week || resolvedDrops;
    const updated = {
      ...data,
      log: {
        ...data.log,
        [selectedDate]: {
          ...existing,
          status: resolvedStatus,
          set: resolvedSet,
          week: resolvedWeek,
          drops: resolvedDrops,
          notes,
          reaction,
        },
      },
    };
    setData(updated);
    await saveData(updated);
    setDirty(false);
    setEditMode(false);
  }

  async function exportPDF() {
    try {
      setExporting(true);
      const html = buildPDFHtml(data);
      const filename = buildPDFFilename(data).replace('.pdf', '');
      const { uri } = await Print.printToFileAsync({ html, base64: false, filename });
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
  const hasMinusOne = Object.values(data.log || {}).some(e => e.set === -1);
  const availableSets = [...(hasMinusOne ? [-1] : []), 1, 2, 3, 4, 5];

  return (
    <ScrollView ref={scrollRef} style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* ── DAY CARD ── */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Text style={s.cardDateLabel}>{formatDisplayDate(selectedDate)}</Text>
          <TouchableOpacity onPress={() => setEditMode(m => !m)} style={s.editToggle}>
            <Ionicons name={editMode ? 'close-outline' : 'create-outline'} size={22} color={editMode ? '#999' : COLOR.blue} />
          </TouchableOpacity>
        </View>

        {/* ── READ MODE ── */}
        {!editMode && (
          <>
            {entry ? (
              <>
                <Text style={[s.statusBadgeText, { color: entry.status === 'taken' ? COLOR.taken : entry.status === 'skipped' ? COLOR.skipped : COLOR.empty }]}>
                  {entry.status === 'taken' ? '✓ Taken' : entry.status === 'skipped' ? '✗ Skipped' : '— Manual'}
                </Text>
                <Text style={s.statusMeta}>
                  {entry.set === 5 ? 'MD' : `Set ${entry.set}`}  ·  {entry.drops} drop{entry.drops !== 1 ? 's' : ''}
                </Text>
                {entry.notes ? <Text style={s.readNotes}>{entry.notes}</Text> : null}
                {entry.reaction && <Text style={s.readReaction}>⚠ Adverse reaction noted</Text>}
              </>
            ) : (
              <Text style={s.readEmpty}>No entry — tap <Ionicons name="create-outline" size={14} color="#aaa" /> to add</Text>
            )}
          </>
        )}

        {/* ── EDIT MODE ── */}
        {editMode && (
          <>
            {/* Status */}
            <Text style={s.fieldLabel}>Status</Text>
            <View style={s.statusRow}>
              {['taken', 'skipped'].map(st => (
                <TouchableOpacity
                  key={st}
                  style={[s.statusBtn, editStatus === st && { backgroundColor: st === 'taken' ? COLOR.taken : COLOR.skipped }]}
                  onPress={() => { setEditStatus(st); setDirty(true); }}
                >
                  <Text style={[s.statusBtnText, editStatus === st && s.statusBtnTextActive]}>
                    {st === 'taken' ? '✓ Taken' : '✗ Skipped'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Set selector */}
            <Text style={s.fieldLabel}>Set</Text>
            <View style={s.setRow}>
              {availableSets.map(set => (
                <TouchableOpacity
                  key={set}
                  style={[s.setChip, editSet === set && s.setChipActive]}
                  onPress={() => {
                    setEditSet(set);
                    if (set === 5) setEditDrops(data.maintenanceDrops || 2);
                    setDirty(true);
                  }}
                >
                  <Text style={[s.setChipText, editSet === set && s.setChipTextActive]}>
                    {set === 5 ? 'MD' : `S${set}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Drops stepper */}
            <Text style={s.fieldLabel}>Drops</Text>
            <View style={s.dropsStepper}>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => { setEditDrops(d => Math.max(1, (d ?? 1) - 1)); setDirty(true); }}
              >
                <Text style={s.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={s.stepsValue}>{editDrops ?? 1}</Text>
              <TouchableOpacity
                style={s.stepBtn}
                onPress={() => { setEditDrops(d => Math.min(3, (d ?? 1) + 1)); setDirty(true); }}
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>

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
          </>
        )}
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardDateLabel: { fontSize: 16, fontWeight: '800', color: '#1a1a2e' },
  editToggle: { padding: 4 },

  statusBadgeText: { fontSize: 18, fontWeight: '700' },
  statusMeta: { fontSize: 13, color: '#555', marginTop: 2 },
  readNotes: { fontSize: 14, color: '#555', marginTop: 8, lineHeight: 20 },
  readReaction: { fontSize: 13, color: '#b45309', fontWeight: '600', marginTop: 6 },
  readEmpty: { fontSize: 14, color: '#aaa' },

  statusRow: { flexDirection: 'row', gap: 8, marginBottom: 10, marginTop: 4 },
  statusBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#dde4ff', alignItems: 'center' },
  statusBtnText: { fontSize: 14, fontWeight: '700', color: '#555' },
  statusBtnTextActive: { color: '#fff' },

  setRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  setChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1.5, borderColor: '#dde4ff', alignItems: 'center' },
  setChipActive: { backgroundColor: COLOR.blue, borderColor: COLOR.blue },
  setChipText: { fontSize: 13, fontWeight: '700', color: '#555' },
  setChipTextActive: { color: '#fff' },

  dropsStepper: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1.5, borderColor: '#dde4ff', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 20, fontWeight: '700', color: COLOR.blue, lineHeight: 24 },
  stepsValue: { fontSize: 22, fontWeight: '800', color: '#222', minWidth: 24, textAlign: 'center' },

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
