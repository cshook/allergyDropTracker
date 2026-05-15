import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Animated, AppState, ToastAndroid, TextInput, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { loadData, saveData, todayKey as storageTodayKey, BUILDUP_SETS } from '../utils/storage';

// Show notifications even when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function sendNotification(title, body) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null, // immediate
  });
}

// Pre-dose checklist items
const CHECKLIST_ITEMS = [
  'No food or drink in the last 10 minutes',
  'No teeth brushing in the last 10 minutes',
];

// Flow states: idle → checklist → t2 → t30 → done | skipped | quickLog
export default function HomeScreen() {
  const [data, setData] = useState(null);
  const [flow, setFlow] = useState('idle');
  const [checked, setChecked] = useState([false, false]);
  const [t2Rem, setT2Rem] = useState(120);
  const [t30Rem, setT30Rem] = useState(1800);
  const [showEarlyStop, setShowEarlyStop] = useState(false);
  const [earlyStopNotes, setEarlyStopNotes] = useState('');
  const [earlyStopReaction, setEarlyStopReaction] = useState(false);
  const [quickLogStatus, setQuickLogStatus] = useState('taken');
  const [quickLogNotes, setQuickLogNotes] = useState('');
  const [quickLogReaction, setQuickLogReaction] = useState(false);
  const [sheetDrops, setSheetDrops] = useState(2);
  const [sheetDate, setSheetDate] = useState('');
  const [sheetDatePickerOpen, setSheetDatePickerOpen] = useState(false);
  const timerRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const t2StartRef = useRef(null);      // epoch ms when t2 started
  const t2NotifIdRef = useRef(null);    // pre-scheduled t2 completion notification ID
  const t30StartRef = useRef(null);     // epoch ms when t30 started
  const t30NotifIdRef = useRef(null);   // pre-scheduled t30 completion notification ID
  const dataRef = useRef(data);         // mirrors data for stale-closure-safe callbacks

  useEffect(() => {
    loadData().then(setData);
    Notifications.requestPermissionsAsync();
    return () => clearTimer();
  }, []);

  useEffect(() => { dataRef.current = data; }, [data]);

  // On app resume during t2 or t30: recalculate remaining time from wall-clock start
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;

      if (t30StartRef.current) {
        const elapsed = Math.floor((Date.now() - t30StartRef.current) / 1000);
        const newRem = Math.max(0, 1800 - elapsed);
        clearTimer();
        if (newRem <= 0) {
          t30StartRef.current = null;
          t30NotifIdRef.current = null;
          completeDose(dataRef.current);
        } else {
          setT30Rem(newRem);
          let rem = newRem;
          timerRef.current = setInterval(() => {
            rem -= 1;
            setT30Rem(rem);
            if (rem <= 0) {
              clearTimer();
              if (t30NotifIdRef.current) {
                Notifications.cancelScheduledNotificationAsync(t30NotifIdRef.current);
                t30NotifIdRef.current = null;
              }
              t30StartRef.current = null;
              sendNotification('💊 Dose complete!', "Monitoring period over — you're all done for today.");
              completeDose(dataRef.current);
            }
          }, 1000);
        }

      } else if (t2StartRef.current) {
        const elapsed = Math.floor((Date.now() - t2StartRef.current) / 1000);
        const newRem = Math.max(0, 120 - elapsed);
        clearTimer();
        if (newRem <= 0) {
          // t2 expired while backgrounded — anchor t30 clock to when t2 ended so the
          // wall-clock math in startT30 (and any later AppState resume) stays accurate
          t30StartRef.current = t2StartRef.current + 120_000;
          t2StartRef.current = null;
          t2NotifIdRef.current = null;
          startT30(); // t30StartRef and t30NotifIdRef already set — no re-scheduling
        } else {
          setT2Rem(newRem);
          let rem = newRem;
          timerRef.current = setInterval(() => {
            rem -= 1;
            setT2Rem(rem);
            if (rem <= 0) {
              clearTimer();
              if (t2NotifIdRef.current) {
                Notifications.cancelScheduledNotificationAsync(t2NotifIdRef.current);
                t2NotifIdRef.current = null;
              }
              t2StartRef.current = null;
              sendNotification('✅ Hold time complete', 'Starting 30-minute monitoring period — no food or drink.');
              startT30();
            }
          }, 1000);
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Pulse animation for active timers
  useEffect(() => {
    if (flow === 't2' || flow === 't30') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.04, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [flow]);

  function advanceSet4Week(d) {
    if (d.currentSet !== 4 || d.currentWeek < 3) return d;
    const weekDoses = Object.values(d.log || {}).filter(
      e => e.set === 4 && e.week === d.currentWeek && (e.status === 'taken' || e.status === 'manual')
    ).length;
    if (weekDoses >= 7) return { ...d, currentWeek: d.currentWeek + 1 };
    return d;
  }

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function getDropCount() {
    if (!data) return 0;
    if (data.currentSet === 5) return data.maintenanceDrops;
    return Math.min(data.currentWeek, 3); // continuation weeks 4+ stay at 3 drops
  }

  function startChecklist() {
    setChecked([false, false]);
    setFlow('checklist');
  }

  function startT2() {
    clearTimer();
    t2StartRef.current = Date.now();
    setT2Rem(120);
    setFlow('t2');
    // Pre-schedule t2 completion notification
    Notifications.scheduleNotificationAsync({
      content: { title: '✅ Hold time complete', body: 'Starting 30-minute monitoring period — no food or drink.', sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 120 },
    }).then(id => { t2NotifIdRef.current = id; });
    // Pre-schedule t30 completion at t2Start + 32 min so it fires correctly even if both
    // phases are backgrounded — startT30 will reuse this ID instead of scheduling a new one
    Notifications.scheduleNotificationAsync({
      content: { title: '💊 Dose complete!', body: "Monitoring period over — you're all done for today.", sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1920 },
    }).then(id => { t30NotifIdRef.current = id; });
    let rem = 120;
    timerRef.current = setInterval(() => {
      rem -= 1;
      setT2Rem(rem);
      if (rem <= 0) {
        clearTimer();
        if (t2NotifIdRef.current) {
          Notifications.cancelScheduledNotificationAsync(t2NotifIdRef.current);
          t2NotifIdRef.current = null;
        }
        t2StartRef.current = null;
        sendNotification('✅ Hold time complete', 'Starting 30-minute monitoring period — no food or drink.');
        startT30(); // t30NotifIdRef.current already set — startT30 won't re-schedule
      }
    }, 1000);
  }

  function startT30() {
    clearTimer();
    // Anchor the t30 clock only if not already set — the AppState t2-expiry branch
    // pre-sets this to t2StartTime + 120s so the wall-clock math stays accurate
    if (!t30StartRef.current) t30StartRef.current = Date.now();
    const elapsed = Math.floor((Date.now() - t30StartRef.current) / 1000);
    const startRem = 1800 - elapsed;

    // Both phases expired while backgrounded — pre-scheduled notification already fired,
    // don't show the timer or send a duplicate; just complete the dose silently
    if (startRem <= 0) {
      t30NotifIdRef.current = null;
      t30StartRef.current = null;
      completeDose(dataRef.current);
      return;
    }

    setT30Rem(startRem);
    setFlow('t30');
    // Only schedule if not already pre-scheduled from startT2 (which fires at t2Start + 1920s)
    if (!t30NotifIdRef.current) {
      Notifications.scheduleNotificationAsync({
        content: { title: '💊 Dose complete!', body: "Monitoring period over — you're all done for today.", sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: startRem },
      }).then(id => { t30NotifIdRef.current = id; });
    }
    let rem = startRem;
    timerRef.current = setInterval(() => {
      rem -= 1;
      setT30Rem(rem);
      if (rem <= 0) {
        clearTimer();
        if (t30NotifIdRef.current) {
          Notifications.cancelScheduledNotificationAsync(t30NotifIdRef.current);
          t30NotifIdRef.current = null;
        }
        t30StartRef.current = null;
        sendNotification('💊 Dose complete!', "Monitoring period over — you're all done for today.");
        completeDose(dataRef.current);
      }
    }, 1000);
  }

  async function confirmEarlyStop() {
    clearTimer();
    if (t30NotifIdRef.current) {
      Notifications.cancelScheduledNotificationAsync(t30NotifIdRef.current);
      t30NotifIdRef.current = null;
    }
    t30StartRef.current = null;
    const today = storageTodayKey();
    const drops = getDropCount();
    const updated = {
      ...data,
      consecutiveSkips: 0,
      log: {
        ...data.log,
        [today]: {
          status: 'taken',
          notes: earlyStopNotes.trim(),
          reaction: earlyStopReaction,
          set: data.currentSet, week: data.currentWeek, drops,
        },
      },
    };
    const advanced = advanceSet4Week(updated);
    setData(advanced);
    await saveData(advanced);
    setShowEarlyStop(false);
    setFlow('done');
    checkWeek9Reminder(advanced);
  }

  async function confirmQuickLog() {
    const today = storageTodayKey();
    const drops = getDropCount();
    const isSkip = quickLogStatus === 'skipped';
    const newSkips = isSkip ? (data.consecutiveSkips || 0) + 1 : 0;
    const updated = {
      ...data,
      consecutiveSkips: newSkips,
      log: {
        ...data.log,
        [today]: {
          status: quickLogStatus,
          notes: quickLogNotes.trim(),
          reaction: isSkip ? false : quickLogReaction,
          set: data.currentSet, week: data.currentWeek, drops,
        },
      },
    };
    const advanced = isSkip ? updated : advanceSet4Week(updated);
    setData(advanced);
    await saveData(advanced);
    setFlow('idle');
    if (isSkip && newSkips >= 3) {
      Alert.alert(
        '⚠️ Contact Your Doctor',
        `You've skipped ${newSkips} doses in a row. Please contact your allergist before resuming treatment.`,
        [{ text: 'Got it' }]
      );
    }
    if (!isSkip) checkWeek9Reminder(advanced);
  }

  // d param lets AppState/stale-closure callers pass dataRef.current explicitly
  async function completeDose(d = data) {
    setFlow('done');
    const today = storageTodayKey();
    const drops = d.currentSet === 5 ? d.maintenanceDrops : Math.min(d.currentWeek, 3);
    let updated = {
      ...d,
      consecutiveSkips: 0,
      log: {
        ...d.log,
        [today]: {
          status: 'taken', notes: '', reaction: false,
          set: d.currentSet, week: d.currentWeek, drops,
        },
      },
    };
    updated = advanceSet4Week(updated);
    setData(updated);
    await saveData(updated);
    checkWeek9Reminder(updated);
  }

  async function confirmNewSheet() {
    const isMaintTransition = data.currentSet === 4;

    const conflicting = Object.entries(data.log || {}).filter(([date, entry]) =>
      date >= sheetDate && (entry.set !== 5 || entry.drops !== sheetDrops)
    );

    async function doSave(updateExisting) {
      let updatedLog = { ...data.log };
      if (updateExisting) {
        Object.keys(updatedLog).forEach(date => {
          if (date >= sheetDate) {
            updatedLog[date] = { ...updatedLog[date], set: 5, drops: sheetDrops, week: 1 };
          }
        });
      }
      const updated = {
        ...data,
        maintenanceDrops: sheetDrops,
        dosageSheetDate: sheetDate,
        log: updatedLog,
        ...(isMaintTransition
          ? { currentSet: 5, currentWeek: 1 }
          : { currentWeek: 1, orderReminders: { week9Dismissed: false, week10CheckDone: false } }
        ),
      };
      setData(updated);
      await saveData(updated);
      setFlow('idle');
    }

    if (conflicting.length > 0) {
      const formattedDate = new Date(sheetDate + 'T00:00:00').toLocaleDateString();
      Alert.alert(
        `${conflicting.length} dose${conflicting.length !== 1 ? 's' : ''} already logged`,
        `Doses from ${formattedDate} forward don't match the new schedule. What would you like to do?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change Start Date', onPress: () => { setSheetDate(''); setSheetDatePickerOpen(true); } },
          { text: `Update to ${sheetDrops} Drop${sheetDrops !== 1 ? 's' : ''}`, onPress: () => doSave(true) },
        ]
      );
      return;
    }

    await doSave(false);
  }

  async function skipDose() {
    clearTimer();
    if (t30NotifIdRef.current) {
      Notifications.cancelScheduledNotificationAsync(t30NotifIdRef.current);
      t30NotifIdRef.current = null;
    }
    t30StartRef.current = null;
    const today = storageTodayKey();
    const drops = getDropCount();
    const newSkips = (data.consecutiveSkips || 0) + 1;
    const updated = {
      ...data,
      consecutiveSkips: newSkips,
      log: {
        ...data.log,
        [today]: {
          status: 'skipped', notes: '', reaction: false,
          set: data.currentSet, week: data.currentWeek, drops,
        },
      },
    };
    setData(updated);
    await saveData(updated);
    setFlow('skipped');
    if (newSkips >= 3) {
      Alert.alert(
        '⚠️ Contact Your Doctor',
        `You've skipped ${newSkips} doses in a row. Please contact your allergist before resuming treatment.`,
        [{ text: 'Got it' }]
      );
    }
  }

  function checkWeek9Reminder(updated) {
    // Week 9 = set #3, week 3 (last week of 3-drop ramp-up set)
    // Also fires for maintenance week 9
    if (!updated.orderReminders?.week9Dismissed && updated.currentWeek === 3) {
      const isWeek9Set = [3, 5].includes(updated.currentSet);
      if (isWeek9Set) {
        Alert.alert(
          '📦 Time to Reorder Drops',
          'You\'ve completed week 9 of this cycle. Contact your allergist to reorder your next set of drops.',
          [{ text: 'Got it', onPress: async () => {
            const r = { ...updated, orderReminders: { ...updated.orderReminders, week9Dismissed: true } };
            setData(r);
            await saveData(r);
          }}]
        );
      }
    }
  }

  function fmt(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function toggleCheck(i) {
    const next = [...checked];
    next[i] = !next[i];
    setChecked(next);
  }

  if (!data) {
    return (
      <View style={[s.container, s.center]}>
        <Text style={s.muted}>Loading...</Text>
      </View>
    );
  }

  const drops = getDropCount();
  const today = storageTodayKey();
  const todayLog = data.log?.[today];
  const allChecked = checked.every(Boolean);
  const hour = new Date().getHours();
  const friendlyName = data.userName ? ` ${data.userName.split(' ')[0]}` : '';
  
  const greeting = hour < 12 ? `Good Morning${friendlyName}` : hour < 17 ? `Good Afternoon${friendlyName}` : `Good Evening${friendlyName}`;


  // Set 4 Week 3 complete = 7 logged doses in that week (currentWeek may have advanced past 3)
  const set4Week3Done = data.currentSet === 4 &&
    Object.values(data.log || {}).filter(e =>
      e.set === 4 && e.week === 3 && (e.status === 'taken' || e.status === 'manual')
    ).length >= 7;

  const orderPlaced = isMaintenance && data.orderReminders?.week9Dismissed;

  // Progress bar
  const isMaintenance = data.currentSet === 5;
  const currentSetIdx = BUILDUP_SETS.indexOf(data.currentSet);
  const progressSlots = isMaintenance ? 8 : 7;
  const progressFilled = isMaintenance
    ? Math.min(data.currentWeek - 1, 8)
    : Math.min(Object.values(data.log || {}).filter(e => e.set === data.currentSet && e.week === data.currentWeek && (e.status === 'taken' || e.status === 'manual')).length, 7);
  const progressLeftLabel = isMaintenance ? null : `Set ${data.currentSet}`;
  const progressRightLabel = isMaintenance
    ? 'Reorder'
    : (data.currentSet === 4 ? 'Maint.' : `Set ${BUILDUP_SETS[currentSetIdx + 1]}`);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View><Text style={s.greeting}>{greeting}</Text></View>
      {/* Dose Info Card */}
      <View style={s.card}>
        <Text style={s.cardLabel}>TODAY'S DOSE</Text>
        <View style={s.doseRow}>
          <View style={s.doseStat}>
            <Text style={s.doseValue}>{data.currentSet === 5 ? 'MD' : data.currentSet}</Text>
            <Text style={s.doseStatLabel}>Set</Text>
          </View>
          <View style={s.divider} />
          <View style={s.doseStat}>
            <Text style={s.doseValue}>{data.currentSet === 5 ? '—' : data.currentWeek}</Text>
            <Text style={s.doseStatLabel}>Week</Text>
          </View>
          <View style={s.divider} />
          <View style={s.doseStat}>
            <Text style={s.doseValue}>{drops}</Text>
            <Text style={s.doseStatLabel}>Drops</Text>
          </View>
        </View>
      </View>

      {/* Progress bar or Order Placed */}
      {orderPlaced ? (
        <View style={s.card}>
          <Text style={s.orderPlacedText}>Order Placed</Text>
          <TouchableOpacity onPress={() => {
            setSheetDrops(data.maintenanceDrops || 2);
            setSheetDate('');
            setSheetDatePickerOpen(false);
            setFlow('newSheet');
          }}>
            <Text style={s.dropsReceivedLink}>Drops Received →</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.card}>
          <View style={s.progressRow}>
            {progressLeftLabel
              ? <Text style={s.progressLabel}>{progressLeftLabel}</Text>
              : <View style={s.progressLabelSpacer} />}
            <View style={s.progressTrack}>
              {Array.from({ length: progressSlots }).map((_, i) => (
                <View key={i} style={[s.progressSlot, i < progressFilled && s.progressSlotFilled]} />
              ))}
            </View>
            <Text style={s.progressLabel}>{progressRightLabel}</Text>
          </View>
          <Text style={s.progressCaption}>
            {isMaintenance ? 'each slot = 1 week' : 'each slot = 1 dose'}
          </Text>
        </View>
      )}

      {/* ── IDLE ── */}
      {flow === 'idle' && (
        <View style={s.card}>
          {todayLog?.status === 'taken' && (
            <Text style={s.successMsg}>✅ Dose taken today — great job!</Text>
          )}
          {todayLog?.status === 'skipped' && (
            <Text style={s.skipMsg}>⏭ Dose skipped today</Text>
          )}
          {!todayLog && (
            <>
              <TouchableOpacity style={s.primaryBtn} onPress={startChecklist}>
                <Text style={s.primaryBtnText}>Start Dose</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.ghostBtn} onPress={() => {
                setQuickLogStatus('taken');
                setQuickLogNotes('');
                setQuickLogReaction(false);
                setFlow('quickLog');
              }}>
                <Text style={s.ghostBtnText}>Log Without Timer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.ghostBtn} onPress={skipDose}>
                <Text style={s.ghostBtnText}>Skip Today</Text>
              </TouchableOpacity>
              {data.consecutiveSkips > 0 && (
                <Text style={s.skipWarning}>
                  ⚠️ {data.consecutiveSkips} consecutive skip{data.consecutiveSkips !== 1 ? 's' : ''}
                </Text>
              )}
            </>
          )}
        </View>
      )}
      {/* New dosage sheet link — Set 4 Week 3 completion only */}
      {flow === 'idle' && set4Week3Done && (
        <TouchableOpacity style={s.sheetLink} onPress={() => {
          setSheetDrops(data.maintenanceDrops || 2);
          setSheetDate('');
          setSheetDatePickerOpen(false);
          setFlow('newSheet');
        }}>
          <Text style={s.sheetLinkText}>+ Start New Dosage Sheet</Text>
        </TouchableOpacity>
      )}

      {/* ── NEW DOSAGE SHEET ── */}
      {flow === 'newSheet' && (
        <View style={s.card}>
          <Text style={s.cardTitle}>
            {data.currentSet === 4 ? 'Start Maintenance Phase' : 'New Dosage Sheet'}
          </Text>
          <Text style={s.cardSub}>
            {data.currentSet === 4
              ? 'Your maintenance drops have arrived. Confirm your schedule below.'
              : 'Your replacement drops have arrived. Update your schedule below.'}
          </Text>

          <Text style={s.fieldLabel}>Drops per day</Text>
          <View style={s.stepperRow}>
            <TouchableOpacity style={s.stepperBtn} onPress={() => setSheetDrops(d => Math.max(1, d - 1))}>
              <Text style={s.stepperBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={s.stepperValue}>{sheetDrops}</Text>
            <TouchableOpacity style={s.stepperBtn} onPress={() => setSheetDrops(d => Math.min(3, d + 1))}>
              <Text style={s.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.fieldLabel}>Dosage sheet date</Text>
          <TouchableOpacity style={s.datePill} onPress={() => setSheetDatePickerOpen(true)}>
            <Text style={s.datePillText}>
              {sheetDate
                ? new Date(sheetDate + 'T00:00:00').toLocaleDateString()
                : 'Select date'}
            </Text>
          </TouchableOpacity>
          {sheetDatePickerOpen && (
            <DateTimePicker
              value={sheetDate ? new Date(sheetDate + 'T00:00:00') : new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              maximumDate={new Date()}
              onChange={(_, date) => {
                setSheetDatePickerOpen(Platform.OS === 'ios');
                if (date) {
                  const d = date;
                  setSheetDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                }
              }}
            />
          )}

          <TouchableOpacity
            style={[s.primaryBtn, !sheetDate && s.primaryBtnDisabled]}
            onPress={confirmNewSheet}
            disabled={!sheetDate}
          >
            <Text style={s.primaryBtnText}>
              {data.currentSet === 4 ? 'Start Maintenance' : 'Save New Sheet'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={() => setFlow('idle')}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── CHECKLIST ── */}
      {flow === 'checklist' && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Pre-Dose Checklist</Text>
          <Text style={s.cardSub}>Confirm before applying drops:</Text>
          {CHECKLIST_ITEMS.map((item, i) => (
            <TouchableOpacity key={i} style={s.checkRow} onPress={() => toggleCheck(i)} activeOpacity={0.7}>
              <View style={[s.checkBox, checked[i] && s.checkBoxChecked]}>
                {checked[i] && <Text style={s.checkMark}>✓</Text>}
              </View>
              <Text style={s.checkLabel}>{item}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[s.primaryBtn, !allChecked && s.primaryBtnDisabled]}
            onPress={startT2}
            disabled={!allChecked}
          >
            <Text style={s.primaryBtnText}>Apply Drops & Start Timer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={() => setFlow('idle')}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 2-MINUTE TIMER ── */}
      {flow === 't2' && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Hold Under Tongue</Text>
          <Text style={s.cardSub}>Keep drops in place until timer ends</Text>
          <Animated.Text style={[s.timer, { transform: [{ scale: pulseAnim }] }]}>
            {fmt(t2Rem)}
          </Animated.Text>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${((120 - t2Rem) / 120) * 100}%` }]} />
          </View>
        </View>
      )}

      {/* ── 30-MINUTE TIMER ── */}
      {flow === 't30' && !showEarlyStop && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Monitoring Period</Text>
          <Text style={s.cardSub}>No food or drink · Watch for reactions</Text>
          <Animated.Text style={[s.timer, { transform: [{ scale: pulseAnim }] }]}>
            {fmt(t30Rem)}
          </Animated.Text>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${((1800 - t30Rem) / 1800) * 100}%` }]} />
          </View>
          <TouchableOpacity style={s.ghostBtn} onPress={() => {
            setEarlyStopNotes('');
            setEarlyStopReaction(false);
            setShowEarlyStop(true);
          }}>
            <Text style={s.ghostBtnText}>End Monitoring Early</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.minimizeBtn} onPress={() =>
            ToastAndroid.show(
              "Press your Home button to background the app. You'll get a notification when the monitoring period ends.",
              ToastAndroid.LONG
            )
          }>
            <Text style={s.minimizeBtnText}>Minimize App</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── EARLY STOP FORM ── */}
      {flow === 't30' && showEarlyStop && (
        <View style={s.card}>
          <Text style={s.cardTitle}>End Monitoring Early?</Text>
          <Text style={s.cardSub}>Your dose is already counted as taken — this just stops the timer.</Text>
          <TextInput
            style={s.notesInput}
            placeholder="Reason / notes (optional)"
            placeholderTextColor="#bbb"
            value={earlyStopNotes}
            onChangeText={setEarlyStopNotes}
            multiline
          />
          <TouchableOpacity style={s.reactionRow} onPress={() => setEarlyStopReaction(!earlyStopReaction)}>
            <View style={[s.checkBox, earlyStopReaction && s.checkBoxChecked]}>
              {earlyStopReaction && <Text style={s.checkMark}>✓</Text>}
            </View>
            <Text style={s.checkLabel}>Adverse reaction observed</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.primaryBtn} onPress={confirmEarlyStop}>
            <Text style={s.primaryBtnText}>Confirm — End Monitoring</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={() => setShowEarlyStop(false)}>
            <Text style={s.ghostBtnText}>Keep Monitoring</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── QUICK LOG ── */}
      {flow === 'quickLog' && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Log Dose</Text>
          <View style={s.toggleRow}>
            <TouchableOpacity
              style={[s.toggleBtn, quickLogStatus === 'taken' && s.toggleBtnActive]}
              onPress={() => setQuickLogStatus('taken')}
            >
              <Text style={[s.toggleBtnText, quickLogStatus === 'taken' && s.toggleBtnTextActive]}>Taken</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.toggleBtn, quickLogStatus === 'skipped' && s.toggleBtnActive]}
              onPress={() => setQuickLogStatus('skipped')}
            >
              <Text style={[s.toggleBtnText, quickLogStatus === 'skipped' && s.toggleBtnTextActive]}>Skipped</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={s.notesInput}
            placeholder="Notes (optional)"
            placeholderTextColor="#bbb"
            value={quickLogNotes}
            onChangeText={setQuickLogNotes}
            multiline
          />
          {quickLogStatus === 'taken' && (
            <TouchableOpacity style={s.reactionRow} onPress={() => setQuickLogReaction(!quickLogReaction)}>
              <View style={[s.checkBox, quickLogReaction && s.checkBoxChecked]}>
                {quickLogReaction && <Text style={s.checkMark}>✓</Text>}
              </View>
              <Text style={s.checkLabel}>Adverse reaction observed</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.primaryBtn} onPress={confirmQuickLog}>
            <Text style={s.primaryBtnText}>Save Log Entry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={() => setFlow('idle')}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── DONE ── */}
      {flow === 'done' && (
        <View style={s.card}>
          <Text style={s.successMsg}>✅ Dose complete — great job!</Text>
          <TouchableOpacity style={s.ghostBtn} onPress={() => setFlow('idle')}>
            <Text style={s.ghostBtnText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── SKIPPED ── */}
      {flow === 'skipped' && (
        <View style={s.card}>
          <Text style={s.skipMsg}>⏭ Dose skipped for today</Text>
          <TouchableOpacity style={s.ghostBtn} onPress={() => setFlow('idle')}>
            <Text style={s.ghostBtnText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      )}

    </ScrollView>
  );
}

const BLUE = '#4f8ef7';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4ff' },
  content: { padding: 16, gap: 14 },
  center: { justifyContent: 'center', alignItems: 'center' },
  muted: { color: '#aaa', fontSize: 15 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: '#aaa', marginBottom: 12 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#222', marginBottom: 4 },
  cardSub: { fontSize: 13, color: '#888', marginBottom: 16 },

  greeting: { fontSize: 17, fontWeight: '700', color: '#000', marginBottom: 4 },

  // Dose stat row
  doseRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  doseStat: { alignItems: 'center', flex: 1 },
  doseValue: { fontSize: 28, fontWeight: '800', color: BLUE },
  doseStatLabel: { fontSize: 12, color: '#aaa', marginTop: 2 },
  divider: { width: 1, height: 40, backgroundColor: '#eee' },

  // Buttons
  primaryBtn: {
    backgroundColor: BLUE,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnDisabled: { backgroundColor: '#b3ceff' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghostBtn: {
    borderWidth: 1.5,
    borderColor: BLUE,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  ghostBtnText: { color: BLUE, fontWeight: '600', fontSize: 15 },

  // Checklist
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  checkBox: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 2, borderColor: '#ccc',
    alignItems: 'center', justifyContent: 'center',
  },
  checkBoxChecked: { backgroundColor: BLUE, borderColor: BLUE },
  checkMark: { color: '#fff', fontWeight: '700', fontSize: 14 },
  checkLabel: { flex: 1, fontSize: 14, color: '#444', lineHeight: 20 },

  // Timer
  timer: {
    fontSize: 64,
    fontWeight: '800',
    color: BLUE,
    textAlign: 'center',
    marginVertical: 16,
    fontVariant: ['tabular-nums'],
  },
  progressBar: {
    height: 6, backgroundColor: '#e8eeff', borderRadius: 3, overflow: 'hidden', marginBottom: 8,
  },
  progressFill: { height: '100%', backgroundColor: BLUE, borderRadius: 3 },

  minimizeBtn: {
    borderWidth: 1.5,
    borderColor: '#ccc',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  minimizeBtnText: { color: '#888', fontWeight: '600', fontSize: 15 },

  // Quick log / early stop form
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  toggleBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#ccc',
    borderRadius: 10, padding: 12, alignItems: 'center',
  },
  toggleBtnActive: { backgroundColor: BLUE, borderColor: BLUE },
  toggleBtnText: { color: '#888', fontWeight: '600', fontSize: 15 },
  toggleBtnTextActive: { color: '#fff' },
  notesInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10,
    padding: 12, fontSize: 14, color: '#333',
    minHeight: 72, textAlignVertical: 'top',
    marginBottom: 12,
  },
  reactionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },

  // Status messages
  // successMsg #1b5e20 on white = 13.7:1 ✓  skipMsg #7f0000 on white = 14.8:1 ✓  skipWarning #7f0000 ✓
  successMsg: { fontSize: 16, color: '#1b5e20', fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
  skipMsg: { fontSize: 16, color: '#7f0000', fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
  skipWarning: { color: '#7f0000', fontSize: 13, textAlign: 'center', marginTop: 10 },

  // Week 10 reorder banner — #7a4f00 on #fffbea = 8.1:1 ✓
  bannerCard: {
    backgroundColor: '#fffbea', borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: '#f59e0b', elevation: 2,
  },
  bannerTitle: { fontSize: 15, fontWeight: '800', color: '#7a4f00', marginBottom: 4 },
  bannerBody: { fontSize: 13, color: '#7a4f00', lineHeight: 19, marginBottom: 12 },
  bannerBtn: { backgroundColor: '#7a4f00', borderRadius: 10, padding: 11, alignItems: 'center' },
  bannerBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Order placed / drops received
  orderPlacedText: { fontSize: 16, fontWeight: '700', color: '#1a3a6b', marginBottom: 8 },
  dropsReceivedLink: { fontSize: 14, fontWeight: '600', color: BLUE, textDecorationLine: 'underline' },

  // New dosage sheet link — #1a3a6b on transparent = renders on #f0f4ff bg = 9.2:1 ✓
  sheetLink: { alignItems: 'center', paddingVertical: 10 },
  sheetLinkText: { color: '#1a3a6b', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  // New dosage sheet wizard
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#aaa', letterSpacing: 0.6, marginBottom: 8, marginTop: 16 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepperBtn: {
    width: 40, height: 40, borderRadius: 10,
    borderWidth: 1.5, borderColor: BLUE,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnText: { color: BLUE, fontSize: 22, fontWeight: '700', lineHeight: 26 },
  stepperValue: { fontSize: 24, fontWeight: '800', color: '#222', minWidth: 30, textAlign: 'center' },
  datePill: {
    borderWidth: 1.5, borderColor: '#ddd', borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  datePillText: { fontSize: 15, color: '#333', fontWeight: '500' },

  // Progress bar
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTrack: { flex: 1, flexDirection: 'row', gap: 3 },
  progressSlot: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#e8eeff' },
  progressSlotFilled: { backgroundColor: BLUE },
  progressLabel: { fontSize: 11, fontWeight: '700', color: '#aaa', minWidth: 40, textAlign: 'center' },
  progressLabelSpacer: { minWidth: 40 },
  progressCaption: { fontSize: 10, color: '#ccc', textAlign: 'center', marginTop: 5 },
});
