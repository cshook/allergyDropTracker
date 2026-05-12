import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Platform, Linking,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import * as Calendar from 'expo-calendar';
import { useFocusEffect } from '@react-navigation/native';
import { loadData, saveData, getDefaultData, formatDisplayDate } from '../utils/storage';

// ── Reminder helpers (module-level, no stale closure risk) ──────────────────

async function scheduleAppNotif(time) {
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Daily reminders',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '💊 Time for your allergy drops',
        body: "Tap to open the app and log today's dose.",
        sound: true,
        ...(Platform.OS === 'android' && { channelId: 'default' }),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: h, minute: m },
    });
  } catch (e) {
    console.error('scheduleAppNotif failed:', e);
    return null;
  }
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
  const [datePickerFor, setDatePickerFor] = useState(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    loadData().then(setData);
  }, []));

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
        Alert.alert(
          'Permission required',
          'Notification permission was denied. Enable it in your device settings to use this feature.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      dailyNotifId = await scheduleAppNotif(data.notificationTime);
      if (!dailyNotifId) {
        Alert.alert('Could not schedule reminder', 'There was a problem setting up your notification. Try restarting the app.');
        return;
      }
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

  async function handleTimeChange(date) {
    if (!date) return;
    const h = date.getHours();
    const m = date.getMinutes();
    const newTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (newTime === data.notificationTime) return;

    let dailyNotifId = data.dailyNotifId;
    let calendarEventId = data.calendarEventId;

    if (data.notificationsEnabled) {
      await cancelAppNotif(dailyNotifId);
      dailyNotifId = await scheduleAppNotif(newTime);
    }
    if (data.calendarEnabled) {
      await deleteCalendarEvent(calendarEventId);
      calendarEventId = await createCalendarEvent(newTime);
    }

    await persist({ ...data, notificationTime: newTime, dailyNotifId, calendarEventId });
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

        {/* Time picker — shown when either option is active */}
        {eitherReminderOn && (
          <View style={{ marginTop: 18 }}>
            <Text style={s.fieldLabel}>Reminder time</Text>
            <TouchableOpacity style={s.datePill} onPress={() => setTimePickerOpen(true)}>
              <Text style={s.datePillText}>
                {(() => {
                  const [h, m] = (data.notificationTime || '09:00').split(':').map(Number);
                  const d = new Date();
                  d.setHours(h, m, 0, 0);
                  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                })()}
              </Text>
            </TouchableOpacity>
            {timePickerOpen && (
              <DateTimePicker
                value={(() => {
                  const [h, m] = (data.notificationTime || '09:00').split(':').map(Number);
                  const d = new Date();
                  d.setHours(h, m, 0, 0);
                  return d;
                })()}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_, date) => {
                  setTimePickerOpen(Platform.OS === 'ios');
                  handleTimeChange(date);
                }}
              />
            )}
          </View>
        )}
      </View>

      {/* Patient Info */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Patient Info</Text>
        <Text style={s.fieldLabel}>Doctor name</Text>
        <TextInput
          style={s.input}
          value={data.doctorName || ''}
          onChangeText={v => persist({ ...data, doctorName: v })}
          placeholder="e.g. Dr. Smith"
          placeholderTextColor="#ccc"
          autoCapitalize="words"
        />
        <Text style={[s.fieldLabel, { marginTop: 12 }]}>Date of birth</Text>
        <TouchableOpacity style={s.datePill} onPress={() => setDatePickerFor('dob')}>
          <Text style={s.datePillText}>
            {data.patientDOB ? formatDisplayDate(data.patientDOB) : 'Select date of birth'}
          </Text>
        </TouchableOpacity>
        {datePickerFor === 'dob' && (
          <DateTimePicker
            value={data.patientDOB ? new Date(data.patientDOB + 'T12:00:00') : new Date(1985, 0, 1)}
            mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(_, date) => {
              setDatePickerFor(null);
              if (date) {
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                persist({ ...data, patientDOB: key });
              }
            }} />
        )}
        <Text style={[s.fieldLabel, { marginTop: 12 }]}>Dosage sheet date</Text>
        <TouchableOpacity style={s.datePill} onPress={() => setDatePickerFor('sheetDate')}>
          <Text style={s.datePillText}>
            {data.dosageSheetDate ? formatDisplayDate(data.dosageSheetDate) : 'Select sheet date'}
          </Text>
        </TouchableOpacity>
        {datePickerFor === 'sheetDate' && (
          <DateTimePicker
            value={data.dosageSheetDate ? new Date(data.dosageSheetDate + 'T12:00:00') : new Date()}
            mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            onChange={(_, date) => {
              setDatePickerFor(null);
              if (date) {
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                persist({ ...data, dosageSheetDate: key });
              }
            }} />
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
  datePill: { borderWidth: 1.5, borderColor: '#e8eeff', borderRadius: 10, padding: 12, backgroundColor: '#fafbff' },
  datePillText: { fontSize: 14, color: '#333' },

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
