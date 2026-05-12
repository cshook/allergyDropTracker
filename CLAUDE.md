# AllergyDropTracker — Claude Code Instructions

## Project Overview
Personal sublingual immunotherapy (allergy drop) tracking app. React Native via Expo SDK 54. All data stored locally — no backend, no accounts, no analytics. Intentional design decision.

**HIPAA constraint:** Any future sync or remote storage feature requires HIPAA-compliant infrastructure before implementation. Never suggest cloud sync without flagging this first.

## Tech Stack
- React Native (Expo SDK 54)
- `@react-navigation/native` + `@react-navigation/bottom-tabs`
- `@react-native-async-storage/async-storage` — key: `allergyDrops_v3`
- `expo-notifications` — local only, no push/remote
- `expo-print` + `expo-sharing` — PDF export
- `expo-file-system`
- `@react-native-community/datetimepicker`
- `@expo/vector-icons` (Ionicons)

## Running the App
```bash
npx expo start
```
Scan QR with Expo Go on Android. Press `r` to reload after file changes.

**`__DEV__` wipe:** `App.js` wipes storage on every reload in dev. This is intentional for onboarding testing. `__DEV__` is automatically `false` in production builds — no manual change needed before building the APK.

## File Structure
```
AllergyDropTracker/
├── App.js                   — Root: onboarding gate + tab navigator
├── screens/
│   ├── HomeScreen.js        — Dose flow: checklist → 2min → 30min timer
│   ├── ScheduleScreen.js    — Build-up set/week progress display
│   ├── LogScreen.js         — Calendar view + day editor + PDF export
│   ├── SettingsScreen.js    — EpiPen, notifications, reset
│   └── OnboardingScreen.js  — Full wizard (all flows)
└── utils/
    └── storage.js           — AsyncStorage wrapper + schema + date/set helpers
```

## Storage Schema (`allergyDrops_v3`)
Set IDs are **numbers**: `-1, 1, 2, 3, 4` for build-up sets, `5` for maintenance. Old string format (`'#1'`, `'maintenance'`) was migrated in v3→v4; `migrateData()` handles legacy data. Display format is derived at render time, not stored.

Dates stored as `YYYY-MM-DD` strings. Always display using device locale (`toLocaleDateString()` with no hardcoded locale), not a fixed format.

```javascript
{
  currentSet: 1,             // -1|1|2|3|4|5 (5 = maintenance)
  currentWeek: 1,            // 1|2|3
  consecutiveSkips: 0,
  maintenanceDrops: 2,       // 1-3

  userName: '',              // Full name — home greeting + PDF header
  doctorName: '',
  patientDOB: '',            // YYYY-MM-DD, display via device locale
  dosageSheetDate: '',       // YYYY-MM-DD, display via device locale

  epipenLot: '',
  epipenExpiry: '',          // YYYY-MM-DD, display via device locale

  notificationTime: '09:00',
  notificationsEnabled: false,
  snoozeUntil: null,

  setColors: {},             // keyed by set number e.g. { 1: '#e53935', 5: '#00897b' }

  log: {
    'YYYY-MM-DD': {
      status: 'taken',       // 'taken'|'skipped'|'manual'
      notes: '',
      reaction: false,
      set: 1,                // set number at time of dose
      week: 2,
      drops: 2,
    }
  },

  dosageSheets: [],           // multi-sheet history (partially implemented)

  orderReminders: {
    week9Dismissed: false,
    week10CheckDone: false,
  },

  onboardingComplete: false,
}
```

Storage key is versioned. Increment (`allergyDrops_v4`, etc.) on breaking schema changes. `migrateData()` in `storage.js` handles forward migration.

## Onboarding Wizard Flow
```
splash → name → epipen → treatment_started?
  ├─ No  → not_started_date → not_started_minus1 → sheet_date_confirm → color_picker → reminder → complete
  └─ Yes → maintenance_started?
       ├─ Yes → maintenance_start_date → maintenance_skips_yn → [PREV_SKIPS] → maintenance_today → sheet_date_confirm → color_picker → reminder → complete
       └─ No  → started_minus1 → started_sets → started_partial → started_today → started_skips_yn → [PREV_SKIPS] → started_maintenance_dose → sheet_date_confirm → color_picker → reminder → complete

PREV_SKIPS: skip_date → skip_reason → skip_another → (loop or return)
```

## Key Business Rules
- **Build-up:** Sets #-1 (optional), #1–#4. Each set = 3 weeks. Week 1=1 drop, Week 2=2 drops, Week 3=3 drops.
- **Set #-1** — not all patients receive it. Only shown if user indicates they have it.
- **Maintenance:** Configurable drop count (1–3, default 2). Follows all 4 build-up sets.
- **Week 9 alert:** After 30-min timer completes on Set #3 Week 3 or maintenance Week 9. Reminder to reorder.
- **Week 10 banner:** Shows on Home after week 9 dose until user taps "drops received."
- **Consecutive skips:** Counter resets on successful dose. Alert at 3+ consecutive skips.
- **Skip logic:** 7 *doses* (not calendar days) = 1 complete week. Skips consume calendar days, not dose count.
- **Set #4 continuation:** User may continue Set #4 while waiting for mail-order maintenance drops. `currentWeek` increments past 3 (4, 5, …). Drops/day stays at 3 for all continuation weeks — always use `Math.min(currentWeek, 3)` for drop count display. MD switch button and "Start New Dosage Sheet" link appear at `currentWeek >= 4` (second week of 3-drop dosing).

## Dose Timer Flow (HomeScreen)
```
idle → checklist (2 items checked) → t2 (2-min timer) → t30 (30-min timer) → done
                                                                             ↘ skipped (any point)
```
Timer uses `useRef` interval with local `rem` variable to avoid stale state. Notifications fire at t2 end and t30 end.

## WCAG AA Compliance
All text must pass 4.5:1 contrast ratio against its background. `passesAA(hexColor)` helper in `storage.js` checks contrast vs white.

Verified colors:
- Taken: `#1b5e20` on white — 13.7:1 ✓
- Skipped: `#7f0000` on white — 14.8:1 ✓
- Muted/empty: `#555555` on white — 7.0:1 ✓
- Banner: `#7a4f00` on `#fffbea` — 8.1:1 ✓
- EpiPen warning: `#b45309` on white — 6.1:1 ✓

## What Is NOT Yet Built
1. **SettingsScreen set colors** — set color picker not editable post-onboarding. (Doctor name, DOB, dosage sheet date now editable in Settings.)
2. **~~ScheduleScreen MD switch / Set 4 continuation~~** — done.
3. **~~New Dosage Sheet wizard~~** — done. Build-up→maintenance: sets currentSet=5, currentWeek=1, maintenanceDrops, dosageSheetDate. Maintenance renewal: resets orderReminders, updates maintenanceDrops and dosageSheetDate. Link gated: Set 4 Week 2+ or maintenance post-reorder.
4. **~~Home greeting~~** — done.
5. **Historical PDF export** — exports entire log as one sheet; needs per-sheet selection when multiple sheets exist.
6. **~~HomeScreen dose progress bar~~** — done.

## Known Issues (Craig to Fix)
- **ScheduleScreen week chip contrast** — completed/past week chips use `weekChipDone: { backgroundColor: '#e8f5e9' }` with white text (`weekChipTextActive`). White on `#e8f5e9` fails WCAG AA. Fix: darken the background or switch to a dark text color for done chips.
