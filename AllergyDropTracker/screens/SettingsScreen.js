import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Calendar from 'expo-calendar';
import { loadData, saveData, getDefaultData } from '../utils/storage';

// ── Reminder helpers (module-level, no stale closure risk) ──────────────────

async function scheduleAppNotif(time) {
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: '💊 Time for your allergy drops',
      body: "Tap to open the app and log today's dose.",
      sound: true,
    },
    trigger: { hour: h, minute: m, repeats: true },
  });
}

async function cancelAppNotif(id) {
  if (!id) return;
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
}

async function createCalendarEvent(time) {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission required', 'Calendar access is needed to add a reminder event.');
    return null;
  }
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.find(c => c.allowsModifications);
  if (!writable) {
    Alert.alert('No calendar found', "Couldn't find a writable calendar on this device.");
    return null;
  }
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const start = new Date();
  start.setHours(h, m, 0, 0);
  if (start < new Date()) start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 30);
  try {
    return await Calendar.createEventAsync(writable.id, {
      title: '💊 Take allergy drops',
      startDate: start,
      endDate: end,
      recurrenceRule: { frequency: Calendar.Frequency.DAILY },
      alarms: [{ relativeOffset: 0 }],
    });
  } catch (e) {
    Alert.alert('Calendar error', 'Could not create the calendar event.');
    return null;
  }
}

async function deleteCalendarEvent(id) {
  if (!id) return;
  try { await Calendar.deleteEventAsync(id, { futureEvents: true }); } catch {}
}

// ────────────────────────────────────────────────────────────────────────────

function isValidTime(str) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
}

export default function SettingsScreen() {
  const [data, setData] = useState(null);
  const [timeInput, setTimeInput] = useState('');
  const [timeError, setTimeError] = useState('');

  useEffect(() => {
    loadData().then(d => {
      setData(d);
      setTimeInput(d.notificationTime);
    });
  }, []);

  async function persist(updated) {
    setData(updated);
    await saveData(updated);
  }

  // ── Reminder toggle handlers ──────────────────────────────────────────────

  async function toggleAppNotif(enabled) {
    await cancelAppNotif(data.dailyNotifId);
    let dailyNotifId = null;
    if (enabled) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Notification permission is needed to send daily reminders.');
        return;
      }
      dailyNotifId = await scheduleAppNotif(data.notificationTime);
    }
    await persist({ ...data, notificationsEnabled: enabled, dailyNotifId });
  }

  async function toggleCalendar(enabled) {
    await deleteCalendarEvent(data.calendarEventId);
    let calendarEventId = null;
    if (enabled) {
      calendarEventId = await createCalendarEvent(data.notificationTime);
      if (!calendarEventId) return; // permission denied or error, stay unchecked
    }
    await persist({ ...data, calendarEnabled: enabled, calendarEventId });
  }

  async function handleTimeBlur() {
    if (!isValidTime(timeInput)) {
      setTimeError('Use HH:MM format, e.g. 09:00');
      setTimeInput(data.notificationTime);
      return;
    }
    setTimeError('');
    if (timeInput === data.notificationTime) return;

    // Reschedule anything that's active
    let dailyNotifId = data.dailyNotifId;
    let calendarEventId = data.calendarEventId;

    if (data.notificationsEnabled) {
      await cancelAppNotif(dailyNotifId);
      dailyNotifId = await scheduleAppNotif(timeInput);
    }
    if (data.calendarEnabled) {
      await deleteCalendarEvent(calendarEventId);
      calendarEventId = await createCalendarEvent(timeInput);
    }

    await persist({ ...data, notificationTime: timeInput, dailyNotifId, calendarEventId });
  }

  // ── Other helpers ─────────────────────────────────────────────────────────

  function epipenStatus() {
    if (!data?.epipenExpiry) return { color: '#aaa', label: 'Not set' };
    const exp = new Date(data.epipenExpiry + 'T12:00:00');
    const now = new Date();
    const days = Math.floor((exp - now) / (1000 * 60 * 60 * 24));
    if (days < 0) return { color: '#c62828', label: 'EXPIRED' };
    if (days < 90) return { color: '#b45309', label: `Expires in ${days} days` };
    return { color: '#2e7d32', label: `Valid · expires ${data.epipenExpiry}` };
  }

  async function resetAll() {
    Alert.alert(
      'Reset All Data',
      'This will permanently erase all your dose history and settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Everything',
          style: 'destructive',
          onPress: async () => {
            // Clean up any active reminders before wiping
            await cancelAppNotif(data.dailyNotifId);
            await deleteCalendarEvent(data.calendarEventId);
            const fresh = getDefaultData();
            setData(fresh);
            await saveData(fresh);
          },
        },
      ]
    );
  }

  if (!data) {
    return (
      <View style={[s.container, s.center]}>
        <Text style={s.muted}>Loading...</Text>
      </View>
    );
  }

  const epi = epipenStatus();
  const eitherReminderOn = data.notificationsEnabled || data.calendarEnabled;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* Reminders */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Reminders</Text>

        {/* App notification */}
        <TouchableOpacity
          style={s.checkRow}
          onPress={() => toggleAppNotif(!data.notificationsEnabled)}
          activeOpacity={0.7}
        >
          <View style={[s.checkBox, data.notificationsEnabled && s.checkBoxOn]}>
            {data.notificationsEnabled && <Text style={s.checkMark}>✓</Text>}
          </View>
          <View style={s.checkBody}>
            <Text style={s.checkLabel}>App notification</Text>
            <Text style={s.checkDesc}>
              Easiest to set up — no extra permissions needed. May stop working if your phone restarts or Android's battery optimization is aggressive.
            </Text>
          </View>
        </TouchableOpacity>

        {/* Calendar event */}
        <TouchableOpacity
          style={[s.checkRow, { marginTop: 14 }]}
          onPress={() => toggleCalendar(!data.calendarEnabled)}
          activeOpacity={0.7}
        >
          <View style={[s.checkBox, data.calendarEnabled && s.checkBoxOn]}>
            {data.calendarEnabled && <Text style={s.checkMark}>✓</Text>}
          </View>
          <View style={s.checkBody}>
            <Text style={s.checkLabel}>Calendar event</Text>
            <Text style={s.checkDesc}>
              More reliable — your calendar app manages the alarm, so it fires after phone restarts and screen locks. Adds a daily event to your calendar. Requires calendar permission.
            </Text>
          </View>
        </TouchableOpacity>

        {/* Time input — shown when either option is active */}
        {eitherReminderOn && (
          <View style={{ marginTop: 18 }}>
            <Text style={s.fieldLabel}>Reminder time (24-hour format)</Text>
            <TextInput
              style={[s.input, timeError ? s.inputError : null]}
              value={timeInput}
              onChangeText={setTimeInput}
              onBlur={handleTimeBlur}
              placeholder="09:00"
              placeholderTextColor="#ccc"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
            {timeError ? <Text style={s.errorText}>{timeError}</Text> : null}
            <Text style={s.fieldHint}>Changes apply when you leave this field.</Text>
          </View>
        )}
      </View>

      {/* EpiPen */}
      <View style={s.card}>
        <View style={s.cardHeaderRow}>
          <Text style={s.cardTitle}>EpiPen Info</Text>
          <View style={[s.epiStatus, { backgroundColor: epi.color + '20' }]}>
            <Text style={[s.epiStatusText, { color: epi.color }]}>● {epi.label}</Text>
          </View>
        </View>

        <Text style={s.fieldLabel}>Lot number</Text>
        <TextInput
          style={s.input}
          value={data.epipenLot}
          onChangeText={v => persist({ ...data, epipenLot: v })}
          placeholder="e.g. AB12345"
          placeholderTextColor="#ccc"
        />

        <Text style={s.fieldLabel}>Expiry date (YYYY-MM-DD)</Text>
        <TextInput
          style={s.input}
          value={data.epipenExpiry}
          onChangeText={v => persist({ ...data, epipenExpiry: v })}
          placeholder="e.g. 2026-06-30"
          placeholderTextColor="#ccc"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
      </View>

      {/* Maintenance Phase */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Maintenance Phase</Text>
        <Text style={s.fieldLabel}>Drops per day</Text>
        <TextInput
          style={s.input}
          value={String(data.maintenanceDrops)}
          onChangeText={v => {
            const n = parseInt(v);
            if (!isNaN(n) && n > 0) persist({ ...data, maintenanceDrops: n });
          }}
          keyboardType="number-pad"
          maxLength={2}
        />
        <Text style={s.rowSub}>Applied once you complete all build-up sets</Text>
      </View>

      {/* About */}
      <View style={s.card}>
        <Text style={s.cardTitle}>About</Text>
        <Text style={s.aboutText}>
          Allergy Drop Tracker stores all data locally on this device. No account or internet connection required. No data is ever sent to any server.
        </Text>
        <Text style={[s.aboutText, { marginTop: 6 }]}>Storage key: <Text style={s.mono}>allergyDrops_v4</Text></Text>
      </View>

      {/* Danger Zone */}
      <TouchableOpacity style={s.dangerBtn} onPress={resetAll}>
        <Text style={s.dangerBtnText}>⚠️ Reset All Data</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const BLUE = '#4f8ef7';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4ff' },
  content: { padding: 16, gap: 12 },
  center: { justifyContent: 'center', alignItems: 'center' },
  muted: { color: '#aaa' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    elevation: 3,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 14 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },

  // Reminder checkboxes
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: '#ccc',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2, flexShrink: 0,
  },
  checkBoxOn: { backgroundColor: BLUE, borderColor: BLUE },
  checkMark: { color: '#fff', fontWeight: '700', fontSize: 13 },
  checkBody: { flex: 1 },
  checkLabel: { fontSize: 15, color: '#333', fontWeight: '500', marginBottom: 3 },
  checkDesc: { fontSize: 12, color: '#888', lineHeight: 17 },

  rowSub: { fontSize: 12, color: '#aaa', marginTop: 6 },

  fieldLabel: { fontSize: 13, color: '#888', marginBottom: 6, marginTop: 2 },
  fieldHint: { fontSize: 11, color: '#bbb', marginTop: 5 },
  input: {
    borderWidth: 1.5,
    borderColor: '#e8eeff',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fafbff',
  },
  inputError: { borderColor: '#c62828' },
  errorText: { fontSize: 12, color: '#c62828', marginTop: 4 },

  epiStatus: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  epiStatusText: { fontSize: 12, fontWeight: '700' },

  aboutText: { fontSize: 13, color: '#777', lineHeight: 19 },
  mono: { fontFamily: 'monospace', color: '#555' },

  dangerBtn: {
    borderWidth: 1.5,
    borderColor: '#c62828',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  dangerBtnText: { color: '#c62828', fontWeight: '700', fontSize: 15 },
});
