import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'allergyDrops_v4';

export async function loadData() {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    return json ? migrateData(JSON.parse(json)) : getDefaultData();
  } catch (e) {
    console.error('Failed to load data:', e);
    return getDefaultData();
  }
}

export async function saveData(data) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

const SET_ID_MIGRATION = { '#-1': -1, '#1': 1, '#2': 2, '#3': 3, '#4': 4, 'maintenance': 5 };

// Migrate older schema versions forward gracefully
function migrateData(data) {
  const defaults = getDefaultData();
  let log = data.log || {};
  let setColors = data.setColors || {};

  // v3 → v4: set IDs changed from '#1'/'maintenance' strings to numbers
  if (typeof data.currentSet === 'string') {
    log = Object.fromEntries(
      Object.entries(log).map(([date, entry]) => [
        date,
        { ...entry, set: SET_ID_MIGRATION[entry.set] ?? entry.set },
      ])
    );
    setColors = Object.fromEntries(
      Object.entries(setColors).map(([k, v]) => [SET_ID_MIGRATION[k] ?? k, v])
    );
  }

  return {
    ...defaults,
    ...data,
    currentSet: SET_ID_MIGRATION[data.currentSet] ?? data.currentSet ?? defaults.currentSet,
    log,
    setColors,
    dosageSheets: data.dosageSheets || [],
    orderReminders: data.orderReminders || defaults.orderReminders,
  };
}

export function getDefaultData() {
  return {
    // Core progress
    currentSet: 1,
    currentWeek: 1,
    consecutiveSkips: 0,
    maintenanceDrops: 2,

    // User info
    userName: '',
    doctorName: '',
    patientDOB: '',           // YYYY-MM-DD
    dosageSheetDate: '',      // YYYY-MM-DD — date printed on physical sheet

    // EpiPen
    epipenLot: '',
    epipenExpiry: '',         // YYYY-MM-DD

    // Notifications
    notificationTime: '09:00',
    notificationsEnabled: false,
    snoozeUntil: null,

    // Set colors — keyed by set number e.g. { 1: '#f06292', 5: '#00897b' }
    setColors: {},

    // Log entries keyed by YYYY-MM-DD date string
    // Each entry: { status: 'taken'|'skipped', notes: '', reaction: false, set: 1, week: 2, drops: 2 }
    // set values: -1 | 1 | 2 | 3 | 4 | 5  (5 = maintenance)
    log: {},

    // Dosage sheets array — ordered oldest first
    // Each sheet: {
    //   id: string (uuid-ish),
    //   type: 'buildup' | 'md',
    //   startDate: 'YYYY-MM-DD',
    //   endDate: 'YYYY-MM-DD' | null (null = current active sheet),
    //   dosageSheetDate: 'YYYY-MM-DD' | null,  // date printed on the physical sheet
    //   startSet: -1 | 1 | 2 | 3 | 4 | 5,
    //   startWeek: 1|2|3,
    // }
    dosageSheets: [],

    // Order reminders
    // { week9Dismissed: false, week10CheckDone: false }
    orderReminders: {
      week9Dismissed: false,
      week10CheckDone: false,
    },

    // Reminders
    dailyNotifId: null,       // ID of the scheduled repeating app notification
    calendarEnabled: false,   // whether a calendar event reminder is active
    calendarEventId: null,    // ID of the created calendar event

    // Onboarding
    onboardingComplete: false,
  };
}

// ── SHEET HELPERS ─────────────────────────────────────────────────────

export function makeSheetId() {
  return `sheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getActiveSheet(data) {
  return data.dosageSheets?.find(s => s.endDate === null) || null;
}

export function getSheetLabel(sheet) {
  if (!sheet) return 'Current Sheet';
  if (sheet.type === 'md') return `Maintenance — started ${formatSheetDate(sheet.startDate)}`;
  return `Build-up — started ${formatSheetDate(sheet.startDate)}`;
}

function formatSheetDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── DATE HELPERS (exported for use across screens) ─────────────────────

export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDisplayDate(key) {
  if (!key) return '';
  const d = new Date(key + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ── SET HELPERS ───────────────────────────────────────────────────────

export const BUILDUP_SETS = [-1, 1, 2, 3, 4];

export function getDropsForWeek(week) {
  return week; // week 1 = 1 drop, week 2 = 2 drops, week 3 = 3 drops
}

export function getNextSetWeek(currentSet, currentWeek, hasMinusOne = true) {
  const sets = hasMinusOne ? BUILDUP_SETS : BUILDUP_SETS.slice(1);
  if (currentWeek < 3) {
    return { set: currentSet, week: currentWeek + 1 };
  }
  const idx = sets.indexOf(currentSet);
  if (idx < sets.length - 1) {
    return { set: sets[idx + 1], week: 1 };
  }
  return null; // end of buildup
}

// ── WCAG AA CONTRAST HELPERS ──────────────────────────────────────────
// Returns true if color passes 4.5:1 against white (#fff)
export function passesAA(hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16) / 255;
  const g = parseInt(hexColor.slice(3, 5), 16) / 255;
  const b = parseInt(hexColor.slice(5, 7), 16) / 255;
  const lum = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  const ratio = (1.05) / (L + 0.05);
  return ratio >= 4.5;
}
