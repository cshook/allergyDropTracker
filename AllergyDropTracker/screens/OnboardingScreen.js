import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Animated, Alert, Switch, Platform,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import * as Calendar from 'expo-calendar';
import { saveData, getDefaultData } from '../utils/storage';

const BLUE = '#4f8ef7';
const SETS = [-1, 1, 2, 3, 4];

// ── HELPERS ──────────────────────────────────────────────────────────

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localToday() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

function formatDisplayDate(key) {
  if (!key) return '';
  const d = new Date(key + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getSetsForFlow(startedFromMinusOne) {
  return startedFromMinusOne ? SETS : SETS.slice(1);
}

// Calculate treatment start date from current wizard state
function calcStartDateFromWizard(ws) {
  if (!ws.treatmentStarted) {
    return ws.notStartedDate || dateKey(localToday());
  }
  if (ws.maintenanceStarted) {
    return ws.maintenanceStartDate || dateKey(localToday());
  }
  // Buildup started flow
  const sets = getSetsForFlow(ws.startedFromMinusOne);
  let completedWeekCount = 0;
  outer:
  for (const setId of sets) {
    for (let w = 1; w <= 3; w++) {
      if (ws.completedWeeks[setId]?.[`w${w}`]) { completedWeekCount++; }
      else break outer;
    }
  }
  const totalCalendarDays = (completedWeekCount * 7) + (ws.partialDays || 0) + (ws.skips?.length || 0);
  if (totalCalendarDays === 0) return dateKey(localToday());
  return addDays(dateKey(localToday()), -totalCalendarDays);
}

function initWizardState() {
  return {
    firstName: '',
    lastName: '',
    epipenLot: '',
    epipenExpiry: '',
    treatmentStarted: null,
    maintenanceStarted: null,
    // NOT STARTED
    notStartedDate: null,
    hasMinusOneSet: null,
    // STARTED
    startedFromMinusOne: null,
    completedWeeks: {},   // { 1: { w1: bool, w2: bool, w3: bool }, ... }
    partialDays: 0,
    todayDoseTaken: null,
    hasSkips: null,
    maintenanceDose: 2,
    // MAINTENANCE
    maintenanceStartDate: null,
    // SHARED SKIPS
    skips: [],            // [{ date, notes, reaction }]
    skipReturnStep: null,
    currentSkipDate: null,
    currentSkipNotes: '',
    currentSkipReaction: false,
    // REMINDER
    reminderAppEnabled: false,
    reminderCalendarEnabled: false,
    reminderTime: null,
    // PROFILE
    doctorName: '',
    patientDOB: '',       // YYYY-MM-DD
    dosageSheetDate: '',  // YYYY-MM-DD — date printed on physical sheet
    setColors: {},  // { 1: '#e57373', 5: '#00897b', ... }
  };
}

// ── BACKFILL LOGIC ────────────────────────────────────────────────────

function buildLogFromStartedFlow(ws) {
  const sets = getSetsForFlow(ws.startedFromMinusOne);

  // Find first unchecked week to determine current position
  let currentSetId = sets[sets.length - 1];
  let currentWeek = 3;
  let completedWeekCount = 0;

  outer:
  for (let si = 0; si < sets.length; si++) {
    const setId = sets[si];
    for (let w = 1; w <= 3; w++) {
      if (ws.completedWeeks[setId]?.[`w${w}`]) {
        completedWeekCount++;
      } else {
        currentSetId = setId;
        currentWeek = w;
        break outer;
      }
    }
  }

  const totalCalendarDays = (completedWeekCount * 7) + ws.partialDays + ws.skips.length;
  const todayStr = dateKey(localToday());
  const lastDoseDateStr = ws.todayDoseTaken ? todayStr : addDays(todayStr, -1);

  if (totalCalendarDays === 0) {
    return { log: {}, currentSet: currentSetId, currentWeek };
  }

  // Build ordered dose slots with correct set/week/drops for each dose
  const doseSlots = [];
  let done = false;
  for (let si = 0; si < sets.length && !done; si++) {
    const setId = sets[si];
    for (let w = 1; w <= 3 && !done; w++) {
      const isCurrentWeek = setId === currentSetId && w === currentWeek;
      const count = isCurrentWeek ? ws.partialDays : (ws.completedWeeks[setId]?.[`w${w}`] ? 7 : 0);
      for (let d = 0; d < count; d++) doseSlots.push({ set: setId, week: w, drops: w });
      if (isCurrentWeek) done = true;
    }
  }

  // Walk calendar days, assigning historically correct slot to each day
  const skipMap = Object.fromEntries(ws.skips.map(s => [s.date, s]));
  const startDateStr = addDays(lastDoseDateStr, -(totalCalendarDays - 1));
  const log = {};
  let doseIdx = 0;
  let cursorStr = startDateStr;

  while (cursorStr <= lastDoseDateStr) {
    const slot = doseSlots[doseIdx] || { set: currentSetId, week: currentWeek, drops: currentWeek };
    if (skipMap[cursorStr]) {
      const skip = skipMap[cursorStr];
      log[cursorStr] = { status: 'skipped', notes: skip.notes, reaction: skip.reaction, set: slot.set, week: slot.week, drops: slot.drops };
    } else {
      log[cursorStr] = { status: 'taken', notes: '', reaction: false, set: slot.set, week: slot.week, drops: slot.drops };
      doseIdx++;
    }
    cursorStr = addDays(cursorStr, 1);
  }

  if (!ws.todayDoseTaken) delete log[todayStr];

  return { log, currentSet: currentSetId, currentWeek };
}

function buildLogFromMaintenanceFlow(ws) {
  const todayStr = dateKey(localToday());
  const yesterdayStr = addDays(todayStr, -1);
  const log = {};

  if (ws.maintenanceStartDate) {
    let cursorStr = ws.maintenanceStartDate;
    while (cursorStr <= yesterdayStr) {
      log[cursorStr] = { status: 'taken', notes: '', reaction: false, set: 5, week: 1, drops: ws.maintenanceDose || 2 };
      cursorStr = addDays(cursorStr, 1);
    }
    for (const skip of ws.skips) {
      if (log[skip.date] !== undefined) {
        log[skip.date] = { status: 'skipped', notes: skip.notes, reaction: skip.reaction, set: 5, week: 1, drops: ws.maintenanceDose || 2 };
      }
    }
  }

  if (ws.todayDoseTaken) {
    log[todayStr] = { status: 'taken', notes: '', reaction: false, set: 5, week: 1, drops: ws.maintenanceDose || 2 };
  }

  return { log, currentSet: 5, currentWeek: 1 };
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────

export default function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState('splash');
  const [history, setHistory] = useState([]);
  const [ws, setWs] = useState(initWizardState());
  const [datePickerFor, setDatePickerFor] = useState(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  function update(key, value) {
    setWs(prev => ({ ...prev, [key]: value }));
  }

  function goTo(nextStep) {
    Animated.timing(slideAnim, { toValue: -420, duration: 200, useNativeDriver: true }).start(() => {
      setHistory(h => [...h, step]);
      setStep(nextStep);
      slideAnim.setValue(420);
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    });
  }

  function goBack() {
    if (history.length === 0) return;
    Animated.timing(slideAnim, { toValue: 420, duration: 200, useNativeDriver: true }).start(() => {
      const prev = history[history.length - 1];
      setHistory(h => h.slice(0, -1));
      setStep(prev);
      slideAnim.setValue(-420);
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    });
  }

  async function finish() {
    let logData = { log: {}, currentSet: 1, currentWeek: 1 };

    if (!ws.treatmentStarted) {
      logData.currentSet = ws.hasMinusOneSet ? -1 : 1;
      logData.currentWeek = 1;
      logData.log = {};
    } else if (ws.maintenanceStarted) {
      logData = buildLogFromMaintenanceFlow(ws);
    } else {
      logData = buildLogFromStartedFlow(ws);
    }

    const time = ws.reminderTime || '09:00';
    const [h, m] = time.split(':').map(Number);

    let dailyNotifId = null;
    if (ws.reminderAppEnabled && ws.reminderTime) {
      try {
        dailyNotifId = await Notifications.scheduleNotificationAsync({
          content: { title: '💊 Time for your allergy drops', body: "Tap to open the app and log today's dose.", sound: true },
          trigger: { hour: h, minute: m, repeats: true },
        });
      } catch {}
    }

    let calendarEventId = null;
    if (ws.reminderCalendarEnabled && ws.reminderTime) {
      try {
        const { status } = await Calendar.requestCalendarPermissionsAsync();
        if (status === 'granted') {
          const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
          const writable = calendars.find(c => c.allowsModifications);
          if (writable) {
            const start = new Date();
            start.setHours(h, m, 0, 0);
            if (start < new Date()) start.setDate(start.getDate() + 1);
            const end = new Date(start);
            end.setMinutes(end.getMinutes() + 30);
            calendarEventId = await Calendar.createEventAsync(writable.id, {
              title: '💊 Take allergy drops',
              startDate: start,
              endDate: end,
              recurrenceRule: { frequency: Calendar.Frequency.DAILY },
              alarms: [{ relativeOffset: 0 }],
            });
          }
        }
      } catch {}
    }

    const finalData = {
      ...getDefaultData(),
      ...logData,
      userName: `${ws.firstName.trim()} ${ws.lastName.trim()}`.trim(),
      doctorName: ws.doctorName.trim(),
      patientDOB: ws.patientDOB || '',
      dosageSheetDate: ws.dosageSheetDate || '',
      epipenLot: ws.epipenLot,
      epipenExpiry: ws.epipenExpiry,
      maintenanceDrops: ws.maintenanceDose,
      notificationsEnabled: ws.reminderAppEnabled,
      calendarEnabled: ws.reminderCalendarEnabled,
      notificationTime: time,
      dailyNotifId,
      calendarEventId,
      setColors: ws.setColors || {},
      consecutiveSkips: 0,
      onboardingComplete: true,
    };

    await saveData(finalData);
    onComplete();
  }

  const showBack = history.length > 0 && step !== 'complete';
  const stepNum = history.length;

  // ── STEP RENDERS ────────────────────────────────────────────────────

  function renderSplash() {
    return (
      <Shell title="Allergy Drop Tracker" hideProgress>
        <View style={s.disclaimerBox}>
          <Text style={s.disclaimerTitle}>Before you begin</Text>
          <Text style={s.disclaimerText}>
            This app helps you track your sublingual immunotherapy. It is not a medical device and does not provide medical advice.
          </Text>
          <Text style={s.disclaimerText}>
            All data is stored locally on your device only. Nothing is shared with anyone — including your doctor.
          </Text>
          <View style={s.notifBox}>
            <Text style={s.notifIcon}>🔔</Text>
            <Text style={s.notifText}>
              Notification permission is required for dose timers and daily reminders. You'll be prompted when you tap Continue.
            </Text>
          </View>
        </View>
        <View style={s.footer}>
          <Btn label="Continue — Set Up My Schedule" onPress={async () => {
            const { status } = await Notifications.requestPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert(
                'Notifications Blocked',
                'Timers and reminders require notifications. Please enable them in your device Settings.',
                [{ text: 'OK' }]
              );
            }
            goTo('name');
          }} />
        </View>
      </Shell>
    );
  }

  function renderName() {
    const valid = ws.firstName.trim().length > 0 && ws.lastName.trim().length > 0;
    return (
      <Shell title="Personal Info" subtitle="Used for your home screen greeting and on exported reports." step={stepNum} scrollable>
        <Text style={s.fieldLabel}>Your name</Text>
        <TextInput style={s.input} placeholder="First name" placeholderTextColor="#bbb"
          value={ws.firstName} onChangeText={v => update('firstName', v)} autoCapitalize="words" autoFocus />
        <TextInput style={[s.input, { marginTop: 12 }]} placeholder="Last name" placeholderTextColor="#bbb"
          value={ws.lastName} onChangeText={v => update('lastName', v)} autoCapitalize="words" />
        <Text style={s.fieldLabel}>Date of birth <Text style={s.optional}>(optional — appears on PDF export)</Text></Text>
        <TouchableOpacity style={s.datePill} onPress={() => setDatePickerFor('dob')}>
          <Text style={[s.datePillText, !ws.patientDOB && s.placeholder]}>
            {ws.patientDOB ? formatDisplayDate(ws.patientDOB) : 'Select date of birth'}
          </Text>
        </TouchableOpacity>
        {datePickerFor === 'dob' && (
          <DateTimePicker
            value={ws.patientDOB ? new Date(ws.patientDOB + 'T12:00:00') : new Date(1985, 0, 1)}
            mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(_, date) => { setDatePickerFor(null); if (date) update('patientDOB', dateKey(date)); }} />
        )}
        <Text style={s.fieldLabel}>Doctor name <Text style={s.optional}>(optional)</Text></Text>
        <TextInput style={s.input} placeholder="e.g. Smith" placeholderTextColor="#bbb"
          value={ws.doctorName} onChangeText={v => update('doctorName', v)} autoCapitalize="words" />
        <View style={s.footer}>
          <Btn label="Continue" onPress={() => goTo('epipen')} disabled={!valid} />
        </View>
      </Shell>
    );
  }

function renderSheetDateConfirm() {
    // Auto-populate with calculated start date if not yet set
    const calculated = calcStartDateFromWizard(ws);
    const displayDate = ws.dosageSheetDate || calculated;
    const userChangedDate = ws.dosageSheetDate && ws.dosageSheetDate !== calculated;
    return (
      <Shell title="Confirm your sheet start date"
        subtitle="This is the first date on your dosage sheet. We've calculated it from your entries — edit if needed."
        step={stepNum}>
        <View style={s.calcBadge}>
          <Text style={s.calcBadgeText}>📅 Calculated: {formatDisplayDate(calculated)}</Text>
        </View>
        <Text style={s.fieldLabel}>Sheet start date</Text>
        <TouchableOpacity style={s.datePill} onPress={() => setDatePickerFor('sheetDate')}>
          <Text style={s.datePillText}>{formatDisplayDate(displayDate)}</Text>
        </TouchableOpacity>
        {datePickerFor === 'sheetDate' && (
          <DateTimePicker
            value={new Date((ws.dosageSheetDate || calculated) + 'T12:00:00')}
            mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(_, date) => { setDatePickerFor(null); if (date) update('dosageSheetDate', dateKey(date)); }} />
        )}
        <View style={s.footer}>
          <View style={s.rowBtns}>
            <GhostBtn label="Use calculated" disabled={!userChangedDate} onPress={() => { update('dosageSheetDate', calculated); goTo('color_picker'); }} />
            <Btn label="Confirm" onPress={() => { if (!ws.dosageSheetDate) update('dosageSheetDate', calculated); goTo('color_picker'); }} flex />
          </View>
        </View>
      </Shell>
    );
  }

  function renderEpipen() {
    const hasData = ws.epipenLot.trim().length > 0 && ws.epipenExpiry.length > 0;
    return (
      <Shell title="EpiPen / Neffy Information"
        subtitle="Optional — handy for reordering drops. Can be added later in Settings."
        step={stepNum}>
        <TextInput style={s.input} placeholder="Lot number" placeholderTextColor="#bbb"
          value={ws.epipenLot} onChangeText={v => update('epipenLot', v)} autoCapitalize="characters" />
        <Text style={s.fieldLabel}>Expiration date</Text>
        <TouchableOpacity style={s.datePill} onPress={() => setDatePickerFor('epipen')}>
          <Text style={[s.datePillText, !ws.epipenExpiry && s.placeholder]}>
            {ws.epipenExpiry ? formatDisplayDate(ws.epipenExpiry) : 'Select date'}
          </Text>
        </TouchableOpacity>
        {datePickerFor === 'epipen' && (
          <DateTimePicker value={ws.epipenExpiry ? new Date(ws.epipenExpiry + 'T12:00:00') : new Date()}
            mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, date) => { setDatePickerFor(null); if (date) update('epipenExpiry', dateKey(date)); }} />
        )}
        <View style={s.footer}>
          <View style={s.rowBtns}>
            <GhostBtn label="Skip" onPress={() => goTo('treatment_started')} />
            <Btn label="Continue" onPress={() => goTo('treatment_started')} disabled={!hasData} flex />
          </View>
        </View>
      </Shell>
    );
  }

  function renderTreatmentStarted() {
    return (
      <Shell title="Have you started treatment yet?" step={stepNum}>
        <View style={s.footer}>
          <View style={s.ynRow}>
            <YNBtn label="No" onPress={() => { update('treatmentStarted', false); goTo('not_started_date'); }} />
            <YNBtn label="Yes" primary onPress={() => { update('treatmentStarted', true); goTo('maintenance_started'); }} />
          </View>
        </View>
      </Shell>
    );
  }

  function renderMaintenanceStarted() {
    return (
      <Shell title="Have you started your maintenance dose?" step={stepNum}>
        <View style={s.footer}>
          <View style={s.ynRow}>
            <YNBtn label="No" onPress={() => { update('maintenanceStarted', false); goTo('started_minus1'); }} />
            <YNBtn label="Yes" primary onPress={() => { update('maintenanceStarted', true); goTo('maintenance_start_date'); }} />
          </View>
        </View>
      </Shell>
    );
  }

  // ── NOT STARTED FLOW ──────────────────────────────────────────────

  function renderNotStartedDate() {
    return (
      <Shell title="When do you plan to start?" subtitle="Enter your first scheduled dose date." step={stepNum}>
        <TouchableOpacity style={s.datePill} onPress={() => setDatePickerFor('notStarted')}>
          <Text style={[s.datePillText, !ws.notStartedDate && s.placeholder]}>
            {ws.notStartedDate ? formatDisplayDate(ws.notStartedDate) : 'Select start date'}
          </Text>
        </TouchableOpacity>
        {datePickerFor === 'notStarted' && (
          <DateTimePicker value={ws.notStartedDate ? new Date(ws.notStartedDate + 'T12:00:00') : new Date()}
            mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onChange={(_, date) => { setDatePickerFor(null); if (date) update('notStartedDate', dateKey(date)); }} />
        )}
        <View style={s.footer}>
          <Btn label="Continue" onPress={() => goTo('not_started_minus1')} disabled={!ws.notStartedDate} />
        </View>
      </Shell>
    );
  }

  function renderNotStartedMinus1() {
    return (
      <Shell title="Were you given a set labeled '-1'?"
        subtitle="Not all patients receive this introductory set. Check your dosage sheet."
        step={stepNum}>
        <View style={s.footer}>
          <View style={s.ynRow}>
            <YNBtn label="No" onPress={() => { update('hasMinusOneSet', false); goTo('sheet_date_confirm'); }} />
            <YNBtn label="Yes" primary onPress={() => { update('hasMinusOneSet', true); goTo('sheet_date_confirm'); }} />
          </View>
        </View>
      </Shell>
    );
  }

  // ── STARTED FLOW ──────────────────────────────────────────────────

  function renderStartedMinus1() {
    const selected = ws.startedFromMinusOne;
    return (
      <Shell title="Which set did your therapy begin with?" step={stepNum}>
        <RadioOpt selected={selected === true} onPress={() => update('startedFromMinusOne', true)}>
          <View style={s.radioSetLabel}>
            <Text style={s.radioSetText}>Set</Text>
            <View style={s.setBadge}><Text style={s.setBadgeText}>-1</Text></View>
            <Text style={s.radioSetDesc}>— started with the introductory set</Text>
          </View>
        </RadioOpt>
        <RadioOpt selected={selected === false} onPress={() => update('startedFromMinusOne', false)}>
          <View style={s.radioSetLabel}>
            <Text style={s.radioSetText}>Set</Text>
            <View style={s.setBadge}><Text style={s.setBadgeText}>1</Text></View>
            <Text style={s.radioSetDesc}>— started directly with set 1</Text>
          </View>
        </RadioOpt>
        <View style={s.footer}>
          <Btn label="Continue" onPress={() => goTo('started_sets')} disabled={selected === null} />
        </View>
      </Shell>
    );
  }

  function renderStartedSets() {
    const sets = getSetsForFlow(ws.startedFromMinusOne);

    function applyUncheck(setId, w) {
      const prev = ws.completedWeeks[setId] || {};
      const cascadedSet = {};
      for (let i = 1; i < w; i++) cascadedSet[`w${i}`] = prev[`w${i}`] || false;

      const orderedSets = getSetsForFlow(ws.startedFromMinusOne);
      const futureChecked = orderedSets
        .filter(s => s > setId)
        .some(s => Object.values(ws.completedWeeks[s] || {}).some(Boolean));

      const applyUpdate = () => {
        const newCompletedWeeks = Object.fromEntries(
          orderedSets
            .filter(s => s <= setId)
            .map(s => [s, s === setId ? cascadedSet : ws.completedWeeks[s]])
            .filter(([, val]) => Object.keys(val || {}).length > 0)
        );
        update('completedWeeks', newCompletedWeeks);
      };

      if (futureChecked) {
        Alert.alert(
          'Clear future sets?',
          'Unchecking this week will also clear all completed weeks in later sets.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue', onPress: applyUpdate },
          ]
        );
      } else {
        applyUpdate();
      }
    }

    return (
      <Shell title="Which weeks have you completed?"
        subtitle="Only check a week if you completed all 7 doses for that week."
        step={stepNum} scrollable>
        {sets.map(setId => {
          const idx = sets.indexOf(setId);
          const prevSetComplete = idx === 0 || [1, 2, 3].every(wk => ws.completedWeeks[sets[idx - 1]]?.[`w${wk}`]);
          const setAllChecked = [1, 2, 3].every(wk => ws.completedWeeks[setId]?.[`w${wk}`]);
          const showLink = setAllChecked || prevSetComplete;
          return (
          <View key={setId} style={s.setBlock}>
            <View style={s.setBlockHeader}>
              {setId === 5
                ? <Text style={s.setBlockTitle}>Maintenance</Text>
                : (<><Text style={s.setBlockTitle}>Set</Text>
                    <View style={s.setBadge}><Text style={s.setBadgeText}>{setId}</Text></View></>)
              }
              {showLink && (
                <TouchableOpacity style={s.setCompleteLinkWrap} onPress={() => {
                  if (setAllChecked) {
                    applyUncheck(setId, 1);
                  } else {
                    update('completedWeeks', { ...ws.completedWeeks, [setId]: { w1: true, w2: true, w3: true } });
                  }
                }}>
                  <Text style={s.setCompleteLink}>{setAllChecked ? 'Clear Set' : 'Set Complete'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {[1, 2, 3].map(w => {
              const key = `w${w}`;
              const checked = ws.completedWeeks[setId]?.[key] || false;
              const setIndex = sets.indexOf(setId);
              const prevSetComplete = setIndex === 0 || [1, 2, 3].every(wk => ws.completedWeeks[sets[setIndex - 1]]?.[`w${wk}`]);
              const prevWeekChecked = w === 1 ? prevSetComplete : ws.completedWeeks[setId]?.[`w${w - 1}`];
              return (
                <TouchableOpacity key={w} style={s.weekRow} activeOpacity={0.7}
                  disabled={!checked && !prevWeekChecked}
                  onPress={() => {
                    const prev = ws.completedWeeks[setId] || {};
                    if (!checked) {
                      update('completedWeeks', { ...ws.completedWeeks, [setId]: { ...prev, [key]: true } });
                    } else {
                      applyUncheck(setId, w);
                    }
                  }}>
                  <View style={[s.checkbox, checked && s.checkboxOn, !checked && !prevWeekChecked && s.checkboxDisabled]}>
                    {checked && <Text style={s.checkmark}>✓</Text>}
                  </View>
                  <Text style={[s.weekRowLabel, !checked && !prevWeekChecked && s.weekRowLabelDisabled]}>Week {w} — {w} drop{w > 1 ? 's' : ''} · 7 doses</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          );
        })}
        <View style={s.footer}>
          <Btn label="Continue" onPress={() => goTo('started_partial')} />
        </View>
      </Shell>
    );
  }

  function renderStartedPartial() {
    const sets = getSetsForFlow(ws.startedFromMinusOne);
    let firstUnchecked = null;
    outer:
    for (const setId of sets) {
      for (let w = 1; w <= 3; w++) {
        if (!ws.completedWeeks[setId]?.[`w${w}`]) {
          firstUnchecked = { setId, week: w, drops: w };
          break outer;
        }
      }
    }

    // All weeks complete — skip straight ahead
    if (!firstUnchecked) {
      goTo('started_today');
      return null;
    }

    return (
      <Shell
        title={`How many days of Set ${firstUnchecked.setId} — ${firstUnchecked.drops} drop${firstUnchecked.drops > 1 ? 's' : ''} have you completed?`}
        subtitle="Enter 0 if you haven't started this step yet. Maximum 6 — if you've done 7, check the box on the previous screen."
        step={stepNum}>
        <NumPicker value={ws.partialDays} min={0} max={6} onChange={v => update('partialDays', v)} />
        <View style={s.footer}>
          <Btn label="Continue" onPress={() => goTo('started_today')} />
        </View>
      </Shell>
    );
  }

  function renderStartedToday() {
    return (
      <Shell title="Have you taken today's dose yet?" step={stepNum}>
        <View style={s.footer}>
          <View style={s.ynRow}>
            <YNBtn label="No" onPress={() => { update('todayDoseTaken', false); goTo('started_skips_yn'); }} />
            <YNBtn label="Yes" primary onPress={() => { update('todayDoseTaken', true); goTo('started_skips_yn'); }} />
          </View>
        </View>
      </Shell>
    );
  }

  function renderStartedSkipsYN() {
    return (
      <Shell title="Have you skipped any doses?"
        subtitle="We'll backfill your log so your history is accurate."
        step={stepNum}>
        <View style={s.footer}>
          <View style={s.ynRow}>
            <YNBtn label="No" onPress={() => { update('hasSkips', false); goTo('started_maintenance_dose'); }} />
            <YNBtn label="Yes" primary onPress={() => {
              update('hasSkips', true);
              update('skipReturnStep', 'started_maintenance_dose');
              goTo('skip_date');
            }} />
          </View>
        </View>
      </Shell>
    );
  }

  function renderStartedMaintenanceDose() {
    return (
      <Shell title="What will your maintenance dose be?"
        subtitle="Has your doctor told you? The typical maintenance dose is 2 drops. This can be changed later in Settings."
        step={stepNum}>
        <NumPicker value={ws.maintenanceDose} min={1} max={3} onChange={v => update('maintenanceDose', v)} />
        <View style={s.footer}>
          <Btn label="Continue" onPress={() => goTo('sheet_date_confirm')} />
        </View>
      </Shell>
    );
  }

  // ── PREVIOUS SKIPS FLOW ───────────────────────────────────────────

  function renderSkipDate() {
    return (
      <Shell title="When was the skipped dose?" subtitle="Enter the date from your dosage sheet." step={stepNum}>
        <TouchableOpacity style={s.datePill} onPress={() => setDatePickerFor('skip')}>
          <Text style={[s.datePillText, !ws.currentSkipDate && s.placeholder]}>
            {ws.currentSkipDate ? formatDisplayDate(ws.currentSkipDate) : 'Select date'}
          </Text>
        </TouchableOpacity>
        {datePickerFor === 'skip' && (
          <DateTimePicker value={ws.currentSkipDate ? new Date(ws.currentSkipDate + 'T12:00:00') : new Date()}
            mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(_, date) => { setDatePickerFor(null); if (date) update('currentSkipDate', dateKey(date)); }} />
        )}
        <View style={s.footer}>
          <View style={s.rowBtns}>
            <GhostBtn label="Skip" onPress={() => goTo(ws.skipReturnStep)} />
            <Btn label="Continue" onPress={() => goTo('skip_reason')} disabled={!ws.currentSkipDate} flex />
          </View>
        </View>
      </Shell>
    );
  }

  function renderSkipReason() {
    return (
      <Shell title="Why was this dose skipped?" subtitle="Add any notes about this missed dose." step={stepNum}>
        <TextInput style={[s.input, s.textArea]} placeholder="Reason for skipping..."
          placeholderTextColor="#bbb" value={ws.currentSkipNotes}
          onChangeText={v => update('currentSkipNotes', v)} multiline numberOfLines={4}
          textAlignVertical="top" />
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Adverse reaction?</Text>
          <Switch value={ws.currentSkipReaction}
            onValueChange={v => update('currentSkipReaction', v)}
            trackColor={{ true: '#ffb300', false: '#ddd' }} />
        </View>
        <View style={s.footer}>
          <Btn label="Continue" onPress={() => goTo('skip_another')} />
        </View>
      </Shell>
    );
  }

  function renderSkipAnother() {
    const savedCount = ws.skips.length + 1; // +1 for the current one not yet saved
    return (
      <Shell title="Add another skipped dose?"
        subtitle={`${savedCount} skipped dose${savedCount !== 1 ? 's' : ''} recorded so far.`}
        step={stepNum}>
        <View style={s.footer}>
          <View style={s.ynRow}>
            <YNBtn label="No" onPress={() => {
              setWs(prev => ({
                ...prev,
                skips: [...prev.skips, { date: prev.currentSkipDate, notes: prev.currentSkipNotes, reaction: prev.currentSkipReaction }],
                currentSkipDate: null, currentSkipNotes: '', currentSkipReaction: false,
              }));
              goTo(ws.skipReturnStep);
            }} />
            <YNBtn label="Yes" primary onPress={() => {
              setWs(prev => ({
                ...prev,
                skips: [...prev.skips, { date: prev.currentSkipDate, notes: prev.currentSkipNotes, reaction: prev.currentSkipReaction }],
                currentSkipDate: null, currentSkipNotes: '', currentSkipReaction: false,
              }));
              goTo('skip_date');
            }} />
          </View>
        </View>
      </Shell>
    );
  }

  // ── MAINTENANCE FLOW ──────────────────────────────────────────────

  function renderMaintenanceStartDate() {
    return (
      <Shell title="When did you start your current maintenance doses?"
        subtitle="Enter the first date from your dosage sheet. Tap Skip to start your log from today."
        step={stepNum}>
        <TouchableOpacity style={s.datePill} onPress={() => setDatePickerFor('maintStart')}>
          <Text style={[s.datePillText, !ws.maintenanceStartDate && s.placeholder]}>
            {ws.maintenanceStartDate ? formatDisplayDate(ws.maintenanceStartDate) : 'Select date'}
          </Text>
        </TouchableOpacity>
        {datePickerFor === 'maintStart' && (
          <DateTimePicker value={ws.maintenanceStartDate ? new Date(ws.maintenanceStartDate + 'T12:00:00') : new Date()}
            mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(_, date) => { setDatePickerFor(null); if (date) update('maintenanceStartDate', dateKey(date)); }} />
        )}
        <View style={s.footer}>
          <View style={s.rowBtns}>
            <GhostBtn label="Skip" onPress={() => { update('maintenanceStartDate', null); goTo('maintenance_skips_yn'); }} />
            <Btn label="Continue" onPress={() => goTo('maintenance_skips_yn')} disabled={!ws.maintenanceStartDate} flex />
          </View>
        </View>
      </Shell>
    );
  }

  function renderMaintenanceSkipsYN() {
    return (
      <Shell title="Have you skipped any maintenance doses?" step={stepNum}>
        <View style={s.footer}>
          <View style={s.ynRow}>
            <YNBtn label="No" onPress={() => { update('hasSkips', false); goTo('maintenance_today'); }} />
            <YNBtn label="Yes" primary onPress={() => {
              update('hasSkips', true);
              update('skipReturnStep', 'maintenance_today');
              goTo('skip_date');
            }} />
          </View>
        </View>
      </Shell>
    );
  }

  function renderMaintenanceToday() {
    return (
      <Shell title="Have you taken today's dose?" step={stepNum}>
        <View style={s.footer}>
          <View style={s.ynRow}>
            <YNBtn label="No" onPress={() => { update('todayDoseTaken', false); goTo('sheet_date_confirm'); }} />
            <YNBtn label="Yes" primary onPress={() => { update('todayDoseTaken', true); goTo('sheet_date_confirm'); }} />
          </View>
        </View>
      </Shell>
    );
  }

  // ── REMINDER ─────────────────────────────────────────────────────

  function renderReminder() {
    const eitherEnabled = ws.reminderAppEnabled || ws.reminderCalendarEnabled;
    const canContinue = !eitherEnabled || !!ws.reminderTime;
    return (
      <Shell title="Set a daily reminder?" subtitle="You can enable one or both. Change anytime in Settings." step={stepNum} scrollable>

        <TouchableOpacity style={s.reminderRow} onPress={() => update('reminderAppEnabled', !ws.reminderAppEnabled)} activeOpacity={0.7}>
          <View style={[s.checkbox, ws.reminderAppEnabled && s.checkboxOn]}>
            {ws.reminderAppEnabled && <Text style={s.checkmark}>✓</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.reminderLabel}>App notification</Text>
            <Text style={s.reminderDesc}>Easiest to set up. May not fire after a phone restart or if Android's battery optimization is aggressive.</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={[s.reminderRow, { marginTop: 16 }]} onPress={() => update('reminderCalendarEnabled', !ws.reminderCalendarEnabled)} activeOpacity={0.7}>
          <View style={[s.checkbox, ws.reminderCalendarEnabled && s.checkboxOn]}>
            {ws.reminderCalendarEnabled && <Text style={s.checkmark}>✓</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.reminderLabel}>Calendar event</Text>
            <Text style={s.reminderDesc}>More reliable — your calendar app manages the alarm, so it fires after restarts and screen locks. Requires calendar permission.</Text>
          </View>
        </TouchableOpacity>

        {eitherEnabled && (
          <View style={{ marginTop: 24 }}>
            <Text style={s.fieldLabel}>Reminder time</Text>
            <TouchableOpacity style={s.datePill} onPress={() => setShowTimePicker(true)}>
              <Text style={[s.datePillText, !ws.reminderTime && s.placeholder]}>
                {ws.reminderTime
                  ? (() => {
                      const [h, m] = ws.reminderTime.split(':');
                      const d = new Date(); d.setHours(+h, +m);
                      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    })()
                  : 'Select time'}
              </Text>
            </TouchableOpacity>
            {showTimePicker && (
              <DateTimePicker
                value={(() => { const d = new Date(); if (ws.reminderTime) { const [h,m] = ws.reminderTime.split(':'); d.setHours(+h,+m,0,0); } return d; })()}
                mode="time" is24Hour={false} display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, date) => {
                  setShowTimePicker(false);
                  if (date) update('reminderTime', `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`);
                }} />
            )}
          </View>
        )}

        <View style={s.footer}>
          <View style={s.rowBtns}>
            <GhostBtn label="Skip" onPress={() => goTo('complete')} />
            <Btn label="Continue" onPress={() => goTo('complete')} disabled={!canContinue} flex />
          </View>
        </View>
      </Shell>
    );
  }

  // ── COMPLETE ──────────────────────────────────────────────────────

  function renderComplete() {
    return (
      <Shell title={`You're all set, ${ws.firstName}! 🎉`}
        subtitle="Your schedule has been configured. Head to Today to take your first dose."
        hideProgress>
        <View style={s.completeList}>
          <Text style={s.completeItem}>✅  Schedule configured</Text>
          {ws.epipenLot ? <Text style={s.completeItem}>✅  EpiPen info saved</Text> : null}
          {(ws.reminderAppEnabled || ws.reminderCalendarEnabled) && ws.reminderTime
            ? <Text style={s.completeItem}>✅  Daily reminder set</Text> : null}
          <Text style={s.completeItem}>✅  All data stays on your device</Text>
        </View>
        <View style={s.footer}>
          <Btn label="Go to Today's Dose →" onPress={finish} />
        </View>
      </Shell>
    );
  }

  // ── COLOR PICKER ─────────────────────────────────────────────────

  function renderColorPicker() {
    const SWATCHES = [
      '#c0392b', '#e53935', '#e91e63', '#f06292',
      '#ff9800', '#fbc02d', '#7cb342', '#00897b',
      '#1e88e5', '#5e35b1', '#795548', '#546e7a',
    ];
    // Determine which sets to show based on flow
    const showSets = [];
    if (ws.startedFromMinusOne || ws.hasMinusOneSet) showSets.push(-1);
    showSets.push(1, 2, 3, 4, 5);

    return (
      <Shell title="Color code your sets"
        subtitle="Optional — match the colors on your drop bottles. Each set can have its own color in your log and on PDF exports."
        step={stepNum} scrollable>
        {showSets.map(setId => {
          const selected = ws.setColors[setId];
          return (
            <View key={setId} style={cp.row}>
              <View style={[cp.setTag, selected && { backgroundColor: selected, borderColor: selected }]}>
                <Text style={[cp.setTagText, selected && { color: '#fff' }]}>
                  {setId === 5 ? 'Maint.' : `Set ${setId}`}
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cp.swatchRow}>
                {SWATCHES.map(color => (
                  <TouchableOpacity key={color}
                    style={[cp.swatch, { backgroundColor: color }, selected === color && cp.swatchSelected]}
                    onPress={() => update('setColors', { ...ws.setColors, [setId]: color })} />
                ))}
                {selected && (
                  <TouchableOpacity style={cp.clearBtn}
                    onPress={() => {
                      const next = { ...ws.setColors };
                      delete next[setId];
                      update('setColors', next);
                    }}>
                    <Text style={cp.clearTxt}>✕</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          );
        })}
        <View style={s.footer}>
          <View style={s.rowBtns}>
            <GhostBtn label="Skip" onPress={() => goTo('reminder')} />
            <Btn label="Continue" onPress={() => goTo('reminder')} flex />
          </View>
        </View>
      </Shell>
    );
  }

  // ── ROUTER ────────────────────────────────────────────────────────

  const stepMap = {
    splash: renderSplash,
    name: renderName,
    sheet_date_confirm: renderSheetDateConfirm,
    epipen: renderEpipen,
    treatment_started: renderTreatmentStarted,
    maintenance_started: renderMaintenanceStarted,
    not_started_date: renderNotStartedDate,
    not_started_minus1: renderNotStartedMinus1,
    started_minus1: renderStartedMinus1,
    started_sets: renderStartedSets,
    started_partial: renderStartedPartial,
    started_today: renderStartedToday,
    started_skips_yn: renderStartedSkipsYN,
    started_maintenance_dose: renderStartedMaintenanceDose,
    skip_date: renderSkipDate,
    skip_reason: renderSkipReason,
    skip_another: renderSkipAnother,
    maintenance_start_date: renderMaintenanceStartDate,
    maintenance_skips_yn: renderMaintenanceSkipsYN,
    maintenance_today: renderMaintenanceToday,
    color_picker: renderColorPicker,
    reminder: renderReminder,
    complete: renderComplete,
  };

  return (
    <View style={s.root}>
      {showBack && (
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={goBack}>
            <Text style={s.backBtnText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={s.headerStep}>STEP {stepNum}</Text>
        </View>
      )}
      <Animated.View style={[s.slide, { transform: [{ translateX: slideAnim }] }]}>
        {stepMap[step]?.()}
      </Animated.View>
    </View>
  );
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────

function Shell({ title, subtitle, children, hideProgress, scrollable, step }) {
  const inner = (
    <View style={ss.shell}>
      <Text style={ss.title}>{title}</Text>
      {subtitle ? <Text style={ss.subtitle}>{subtitle}</Text> : null}
      <View style={ss.body}>{children}</View>
    </View>
  );
  return scrollable
    ? <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" enableOnAndroid>{inner}</KeyboardAwareScrollView>
    : inner;
}

function Btn({ label, onPress, disabled, flex }) {
  return (
    <TouchableOpacity style={[b.primary, disabled && b.disabled, flex && { flex: 1 }]} onPress={onPress} disabled={!!disabled}>
      <Text style={b.primaryTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

function GhostBtn({ label, onPress, disabled }) {
  return (
    <TouchableOpacity style={b.ghost} onPress={onPress} disabled={!!disabled}>
      <Text style={[b.ghostTxt, disabled && b.ghostTxtDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

function YNBtn({ label, onPress, primary }) {
  return (
    <TouchableOpacity style={[b.yn, primary && b.ynPrimary]} onPress={onPress}>
      <Text style={[b.ynTxt, primary && b.ynTxtPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RadioOpt({ label, children, selected, onPress }) {
  return (
    <TouchableOpacity style={r.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[r.outer, selected && r.outerOn]}>
        {selected && <View style={r.inner} />}
      </View>
      {children ?? <Text style={r.label}>{label}</Text>}
    </TouchableOpacity>
  );
}

function NumPicker({ value, min, max, onChange }) {
  return (
    <View style={n.row}>
      <TouchableOpacity style={n.btn} onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        <Text style={[n.sym, value <= min && n.symOff]}>−</Text>
      </TouchableOpacity>
      <Text style={n.val}>{value}</Text>
      <TouchableOpacity style={n.btn} onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
        <Text style={[n.sym, value >= max && n.symOff]}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f0f4ff'},
  header: { position: 'absolute', top: 46, left: 0, right: 0, zIndex: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16},
  backBtn: { padding: 8 },
  backBtnText: { color: BLUE, fontSize: 20, fontWeight: '700' },
  headerStep: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: '#000', paddingRight: 16 },
  slide: { flex: 1 },

  disclaimerBox: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12, elevation: 2 },
  disclaimerTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 2 },
  disclaimerText: { fontSize: 14, color: '#555', lineHeight: 22 },
  notifBox: { flexDirection: 'row', gap: 10, backgroundColor: '#fffbea', borderRadius: 12, padding: 12, marginTop: 6 },
  notifIcon: { fontSize: 20 },
  notifText: { flex: 1, fontSize: 13, color: '#7a6000', lineHeight: 19 },

  calcBadge: { backgroundColor: '#f0f4ff', borderRadius: 10, padding: 12, marginBottom: 8 },
  calcBadgeText: { fontSize: 13, color: '#1a3a6b', fontWeight: '600' },

  input: { borderWidth: 1.5, borderColor: '#e0e8ff', borderRadius: 12, padding: 14, fontSize: 16, color: '#222', backgroundColor: '#fff' },
  textArea: { minHeight: 110, textAlignVertical: 'top' },
  fieldLabel: { fontSize: 13, color: '#444', marginTop: 16, marginBottom: 6, fontWeight: '600' },
  optional: { fontSize: 12, color: '#888', fontWeight: '400' },
  placeholder: { color: '#ccc' },

  datePill: { borderWidth: 1.5, borderColor: '#e0e8ff', borderRadius: 12, padding: 14, backgroundColor: '#fff' },
  datePillText: { fontSize: 16, color: '#222' },

  footer: { marginTop: 24 },
  rowBtns: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  ynRow: { flexDirection: 'row', gap: 14 },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  switchLabel: { fontSize: 16, color: '#333', fontWeight: '500' },
  reminderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  reminderLabel: { fontSize: 15, color: '#333', fontWeight: '600', marginBottom: 4 },
  reminderDesc: { fontSize: 13, color: '#888', lineHeight: 18 },

  setBlock: { marginBottom: 22 },
  setBlockHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  setCompleteLinkWrap: { marginLeft: 'auto', paddingLeft: 16 },
  setCompleteLink: { fontSize: 13, color: BLUE, fontWeight: '600' },
  checkboxDisabled: { borderColor: '#e0e0e0', backgroundColor: '#f5f5f5' },
  weekRowLabelDisabled: { color: '#bbb' },
  setBlockTitle: { fontSize: 15, fontWeight: '800', color: BLUE },
  setBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#777', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  setBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  radioSetLabel: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },
  radioSetText: { fontSize: 15, color: '#333', fontWeight: '700' },
  radioSetDesc: { fontSize: 15, color: '#555', flex: 1 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f4ff' },
  weekRowLabel: { fontSize: 14, color: '#444' },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: BLUE, borderColor: BLUE },
  checkmark: { color: '#fff', fontWeight: '800', fontSize: 13 },

  completeList: { gap: 16, marginTop: 8 },
  completeItem: { fontSize: 16, color: '#444', lineHeight: 24 },
});

const ss = StyleSheet.create({
  shell: { flex: 1, paddingHorizontal: 24, paddingTop: 110, paddingBottom: 24 },
  title: { fontSize: 26, fontWeight: '800', color: '#1a1a2e', lineHeight: 34, marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', lineHeight: 21, marginBottom: 20 },
  body: { flex: 1 },
});

const b = StyleSheet.create({
  primary: { backgroundColor: BLUE, borderRadius: 14, padding: 16, alignItems: 'center' },
  disabled: { backgroundColor: '#b3ceff' },
  primaryTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghost: { padding: 16, alignItems: 'center', justifyContent: 'center' },
  ghostTxt: { color: BLUE, fontWeight: '600', fontSize: 15 },
  ghostTxtDisabled: { color: '#bbb' },
  yn: { flex: 1, borderWidth: 2, borderColor: '#e0e8ff', borderRadius: 14, padding: 20, alignItems: 'center', backgroundColor: '#fff' },
  ynPrimary: { backgroundColor: BLUE, borderColor: BLUE },
  ynTxt: { fontSize: 20, fontWeight: '800', color: '#aaa' },
  ynTxtPrimary: { color: '#fff' },
});

const r = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f4ff' },
  outer: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center' },
  outerOn: { borderColor: BLUE },
  inner: { width: 12, height: 12, borderRadius: 6, backgroundColor: BLUE },
  label: { flex: 1, fontSize: 15, color: '#333', lineHeight: 22 },
});

const n = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 36, marginTop: 24 },
  btn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#e8eeff', alignItems: 'center', justifyContent: 'center' },
  sym: { fontSize: 30, color: BLUE, fontWeight: '700', lineHeight: 34 },
  symOff: { color: '#ccc' },
  val: { fontSize: 56, fontWeight: '800', color: '#1a1a2e', minWidth: 70, textAlign: 'center' },
});

const cp = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#f0f4ff' },
  setTag: {
    borderWidth: 2, borderColor: '#dde4ff', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, minWidth: 60, alignItems: 'center', backgroundColor: '#f0f4ff',
  },
  setTagText: { fontSize: 12, fontWeight: '800', color: '#1a3a6b' },
  swatchRow: { flex: 1 },
  swatch: {
    width: 30, height: 30, borderRadius: 15, marginRight: 8,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  swatchSelected: { borderWidth: 3, borderColor: '#1a1a2e' },
  clearBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#eee',
    alignItems: 'center', justifyContent: 'center', marginLeft: 4,
  },
  clearTxt: { fontSize: 12, color: '#555', fontWeight: '700' },
});
