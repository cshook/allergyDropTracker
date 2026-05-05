# Allergy Drop Tracker — Setup Guide (Android First)

## 1. Install Prerequisites

### Node.js
Download from https://nodejs.org (LTS version)
Verify: `node -v` and `npm -v`

### Expo CLI
```bash
npm install -g expo-cli
```

### Android Setup (for device testing without Play Store)
- Install **Android Studio** → https://developer.android.com/studio
- OR enable **USB Debugging** on your Android phone:
  Settings → About Phone → tap "Build Number" 7 times → Developer Options → Enable USB Debugging

---

## 2. Create the Project

```bash
npx create-expo-app AllergyDropTracker --template blank
cd AllergyDropTracker
```

---

## 3. Install Dependencies

```bash
npx expo install @react-navigation/native @react-navigation/bottom-tabs
npx expo install react-native-screens react-native-safe-area-context
npx expo install @react-native-async-storage/async-storage
npx expo install expo-notifications
npx expo install @expo/vector-icons
```

---

## 4. Copy Project Files

Replace the generated files with the files in this scaffold:

```
AllergyDropTracker/
├── App.js                    ← replace generated one
├── screens/
│   ├── HomeScreen.js
│   ├── ScheduleScreen.js
│   ├── LogScreen.js
│   └── SettingsScreen.js
└── utils/
    └── storage.js
```

---

## 5. Run on Device

### Via Expo Go app (easiest — no build needed)
```bash
npx expo start
```
Install **Expo Go** on your Android phone → scan the QR code.

### Build a standalone APK (sideload, no Play Store)
```bash
npm install -g eas-cli
eas login          # create free Expo account
eas build:configure
eas build -p android --profile preview
```
This produces a `.apk` you can install directly on your phone.

---

## 6. Git Setup (recommended)

```bash
git init
git checkout -b react-native    # per your project plan
git add .
git commit -m "Initial React Native scaffold"
```

---

## Notes
- Storage key is `allergyDrops_v2` — matches the web app schema
- Notifications require `expo-notifications` setup in `app.json` (see Expo docs for Android channel config)
- For EAS builds, you'll need a free Expo account at expo.dev
